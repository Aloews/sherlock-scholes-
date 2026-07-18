"""Fuzzy duplicate finder for the `cards` deck (READ-ONLY helper).

Why this exists: the deck was filled in two waves. Old cards were typed by
hand in Russian; new ones (e.g. from --to-cards) arrive auto-translated. The
same person can end up twice under slightly different spellings — "Холанд" vs
"Холланд", or a Latin "Xavi" next to a Cyrillic "Хави". Postgres sees those as
different strings, so a plain GROUP BY never catches them.

This module finds *probable* duplicate pairs so a human can decide what to
delete. It NEVER writes anything. The matching is deliberately loose (recall
over precision): better to show a few false pairs the user dismisses than to
miss a real duplicate.

Pipeline for each card name:
  1. normalize()  — case-fold, strip spaces/hyphens/brackets/commas/dots.
  2. translit_latin_to_cyrillic() — fold any Latin into Cyrillic so a Latin
     spelling and a Cyrillic one collapse onto a comparable alphabet.
The result is the card's "canonical key". Two cards are flagged when the
difflib similarity ratio of their canonical keys is >= the threshold (0.85).
"""
import re
from difflib import SequenceMatcher

DEFAULT_RATIO = 0.85

# Disambiguation suffixes: "Андре (футболист, 2001)", "Гомес [вратарь]".
_PAREN_RE = re.compile(r"\s*[\(\[][^)\]]*[\)\]]")


# Patronymic endings, Cyrillic + transliterated Latin. Checked ONLY on the
# MIDDLE word of an exactly-three-word name, so a Serbian "-ич" SURNAME at
# the end of a name is never touched ("Милинкович-Савич" is one hyphenated
# token anyway).
_PATRONYMIC_ENDINGS = ("ич", "вна", "инична", "vich", "vna", "ichna")


def strip_patronymic(name):
    """Drop the patronymic from a Russian three-word name:
    "Артём Сергеевич Дзюба" -> "Артём Дзюба" (the manual deck format, so
    the canonical_key dedup matches the existing card). Only an
    exactly-three-word name whose MIDDLE word ends like a patronymic is
    touched; everything else passes through unchanged. Works on
    transliterated names too ("Artem Sergeyevich Dzyuba" -> "Artem Dzyuba").
    """
    words = (name or "").split()
    if len(words) == 3 and words[1].lower().endswith(_PATRONYMIC_ENDINGS):
        return words[0] + " " + words[2]
    return name


def normalize_display_name(name):
    """Scraped name -> the deck's manual-card format. Idempotent on
    already-clean names. Shared by --to-cards (insert-time) and
    docs/cards_normalize_preview.py (backfill of older inserts):
        "Андре (футболист, 2001)" -> "Андре"          (drop "(...)" / "[...]")
        "Лукаку, Ромелу"          -> "Ромелу Лукаку"  (flip "Surname, Given")
        "Дзюба, Артём Сергеевич"  -> "Артём Дзюба"    (drop the patronymic)
        stray commas / double spaces collapsed.
    """
    if not name:
        return name
    s = _PAREN_RE.sub("", name)                  # 1. drop "(...)" / "[...]"
    if "," in s:                                 # 2. flip "Surname, Given"
        surname, _, given = s.partition(",")
        surname, given = surname.strip(), given.strip()
        if surname and given:
            s = given + " " + surname
    s = re.sub(r"[\s,]+", " ", s).strip()        # 3. collapse spaces + commas
    return strip_patronymic(s)                   # 4. "Имя ОТЧЕСТВО Фамилия"

# Characters dropped during normalization: spacing and the punctuation that
# differs between "Холанд, Эрлинг" and "Эрлинг Холанд" or "ШальерООО (вратарь)".
_STRIP_CHARS = set(" \t\n\r-‐‑‒–—_.,()[]{}'\"`«»·•/\\|")

# Latin -> Cyrillic, longest sequences first so digraphs win over single
# letters (e.g. "shch" before "sh" before "s"). This is a heuristic meant only
# to make a Latin spelling *comparable* to a Russian one — it is not a faithful
# transliteration. difflib's ratio absorbs the small mismatches that remain.
_TRANSLIT = [
    ("shch", "щ"),
    ("sch", "щ"),
    ("zh", "ж"),
    ("kh", "х"),
    ("ch", "ч"),
    ("sh", "ш"),
    ("ts", "ц"),
    ("ya", "я"),
    ("yu", "ю"),
    ("yo", "ё"),
    ("ye", "е"),
    ("ph", "ф"),
    ("th", "т"),
    ("ck", "к"),
    ("ee", "и"),
    ("oo", "у"),
    ("ou", "у"),
    ("a", "а"), ("b", "б"), ("c", "к"), ("d", "д"), ("e", "е"),
    ("f", "ф"), ("g", "г"), ("h", "х"), ("i", "и"), ("j", "ж"),
    ("k", "к"), ("l", "л"), ("m", "м"), ("n", "н"), ("o", "о"),
    ("p", "п"), ("q", "к"), ("r", "р"), ("s", "с"), ("t", "т"),
    ("u", "у"), ("v", "в"), ("w", "в"), ("x", "кс"), ("y", "й"),
    ("z", "з"),
]
_MAX_SEQ = max(len(src) for src, _ in _TRANSLIT)
_TRANSLIT_MAP = {src: dst for src, dst in _TRANSLIT}


def tokens(name):
    """Case-fold and split a name into bare word tokens.

    Splits on any spacing/punctuation in _STRIP_CHARS, so "Холанд, Эрлинг" and
    "холанд эрлинг" both yield ["холанд", "эрлинг"]. Empty fragments (from
    runs of punctuation) are dropped. Returns [] for an empty/None name.
    ё is folded to е: the manual deck spells "Артем"/"Федор" without the
    dots while scraped wiki names carry them — same person, same key.
    """
    if not name:
        return []
    folded = name.casefold().replace("ё", "е")
    out = []
    word = []
    for ch in folded:
        if ch in _STRIP_CHARS:
            if word:
                out.append("".join(word))
                word = []
        else:
            word.append(ch)
    if word:
        out.append("".join(word))
    return out


def normalize(name):
    """Case-fold and drop spacing/punctuation, preserving letter order.

    "Холанд, Эрлинг" -> "холандэрлинг". A building block kept order-preserving;
    word-order invariance is handled in canonical_key by sorting tokens.
    """
    return "".join(tokens(name))


def translit_latin_to_cyrillic(text):
    """Replace Latin letters with an approximate Cyrillic equivalent.

    Greedy longest-match over _TRANSLIT (digraphs before single letters).
    Non-Latin characters (Cyrillic, digits) pass through untouched, so a name
    already in Russian comes back unchanged.
    """
    if not text:
        return ""
    out = []
    i = 0
    n = len(text)
    while i < n:
        matched = False
        # Try the longest possible sequence first so "sh" beats "s"+"h".
        for size in range(min(_MAX_SEQ, n - i), 0, -1):
            chunk = text[i:i + size]
            repl = _TRANSLIT_MAP.get(chunk)
            if repl is not None:
                out.append(repl)
                i += size
                matched = True
                break
        if not matched:
            out.append(text[i])
            i += 1
    return "".join(out)


def canonical_key(name):
    """Card name -> comparable key for duplicate detection.

    Each token is folded to Cyrillic (translit_latin_to_cyrillic) and the
    tokens are then SORTED before joining, so word order does not matter:
    "Холанд, Эрлинг" (old: surname, firstname) and "Эрлинг Холанд" (new:
    auto-translated firstname surname) collapse onto the same key. Two
    spellings of the same person land on nearly-identical keys regardless of
    alphabet, spacing, punctuation or name order.
    """
    parts = sorted(translit_latin_to_cyrillic(t) for t in tokens(name))
    return "".join(parts)


def _similarity(key_a, key_b):
    """difflib ratio in [0, 1] with cheap upper-bound prefilters.

    real_quick_ratio()/quick_ratio() are O(1)/O(n) upper bounds on ratio(); if
    either already falls below the threshold the full (more expensive) ratio()
    can't reach it, so we return the cheap bound and skip the real work. This
    keeps the O(n^2) sweep fast on a multi-thousand-card deck.
    """
    sm = SequenceMatcher(None, key_a, key_b)
    if sm.real_quick_ratio() < DEFAULT_RATIO:
        return sm.real_quick_ratio()
    if sm.quick_ratio() < DEFAULT_RATIO:
        return sm.quick_ratio()
    return sm.ratio()


def find_duplicate_pairs(cards, ratio=DEFAULT_RATIO):
    """Return probable duplicate pairs, most-similar first. READ-ONLY.

    `cards` is a list of dicts with at least `id` and `name` (extra fields such
    as `category` are carried through untouched for display). A pair is
    returned when the canonical keys of two different cards have a similarity
    >= `ratio`. Cards whose name normalizes to "" are skipped (nothing to
    compare). Output: list of (card_a, card_b, score) sorted by score desc.

    Comparison is symmetric and each unordered pair is considered once.
    """
    # Precompute keys once; drop cards with no comparable content.
    indexed = []
    for card in cards:
        key = canonical_key(card.get("name"))
        if key:
            indexed.append((key, card))

    pairs = []
    for i in range(len(indexed)):
        key_a, card_a = indexed[i]
        for j in range(i + 1, len(indexed)):
            key_b, card_b = indexed[j]
            score = _similarity(key_a, key_b)
            if score >= ratio:
                pairs.append((card_a, card_b, score))

    pairs.sort(key=lambda p: p[2], reverse=True)
    return pairs
