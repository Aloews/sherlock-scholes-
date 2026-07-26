"""Build cards.descriptions (JSONB) for NON-PLAYER cards from Wikipedia.

WHY: player cards carry their career in facts / career_stats / legend_career,
so the end-of-game history shows them properly. Non-player cards have NO such
source — «Барселона», «Олд Траффорд», «Пьерлуиджи Коллина» render as a bare
name with nothing under it. The `descriptions` column + its frontend renderer
(TrainingScreen: interface language -> en -> ru) already exist and are used by
the `term` / `position` cards; this script fills the remaining categories.

SOURCE — Wikipedia/Wikidata ONLY, exactly like the rest of the pipeline. No
LLM, no invented text: the blurb is the article's own lead sentence, trimmed.
A card we cannot resolve to a confidently-correct article is SKIPPED and
reported, never guessed.

  name -> ruwiki title variants (run.cards_photos_candidates: clubs try
          "<name> (футбольный клуб)" FIRST, stadiums "(стадион)", …)
       -> QID via prop=pageprops, disambiguations skipped
          (run.resolve_card_qid, incl. the list=search last resort)
       -> P31 GUARD (see DESC_P31_ALLOW): the entity must be the right KIND
          of thing, so «Краснодар» the city / «Сантьяго Бернабеу» the person
          can never take a club/stadium card
       -> ruwiki lead (prop=extracts&exintro&explaintext)
       -> FOOTBALL GUARD: the lead must actually be about football
       -> blurb (definition shape, subject stripped, <= MAX_CHARS)
  enwiki blurb: the QID's enwiki sitelink, same shaping. Optional — a card
  with only a Russian blurb is still written (the frontend falls back to ru).

WRITE: descriptions = {"ru": "...", "en": "..."} — PATCHed only when the card
has no descriptions yet (IS NULL / {}), so a hand-written blurb is never
overwritten and a re-run is a no-op.

Budget: shared photos_budget.json (the same per-UTC-day Wikimedia cap the
photo/legend steps use), polite pauses, on-disk cache -> resumable: a run that
hits the wall simply continues the next day from the cache.

DRY-RUN BY DEFAULT — prints a BEFORE/AFTER table and writes nothing.

  python docs/cards_descriptions_build.py                      # dry-run, all
  python docs/cards_descriptions_build.py --limit 5            # test batch
  python docs/cards_descriptions_build.py --categories club --limit 50
  APPLY=1 python docs/cards_descriptions_build.py --limit 50   # write
  python docs/cards_descriptions_build.py --names "Барселона,Уэмбли"
"""
import argparse
import json
import os
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import requests
from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.join(os.path.dirname(HERE), "football_scraper")
sys.path.insert(0, SCRAPER)

# Load run.py as a module (same trick every other docs/cards_*.py uses) so the
# card->article resolution is the pipeline's, not a second implementation.
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location("run", os.path.join(SCRAPER, "run.py"))
run = importlib.util.module_from_spec(_spec)
sys.modules["run"] = run
_spec.loader.exec_module(run)

from scraper.cache import FileCache  # noqa: E402
from scraper.pageviews import WikimediaBudget, WikiPagePropsClient  # noqa: E402
from scraper.wikidata import WikidataEnricher  # noqa: E402

APPLY = os.environ.get("APPLY") == "1"

# Categories this script owns: everything that is NOT a person-with-a-career.
# `term` and `position` are already filled by hand — the "no descriptions yet"
# guard drops them anyway, they are listed so --categories can target them.
TARGET_CATEGORIES = (
    "club", "coach", "referee", "commentator", "stadium",
    "derby", "trophy", "club_nickname", "era",
)
# Player cards are NOT in scope: their data lives in facts/career_stats and a
# wiki lead would duplicate it (and player mononyms resolve badly — «Данте»
# lands on the poet). Enforced, not just documented.
EXCLUDED_CATEGORIES = ("player", "woman")

MAX_CHARS = 180          # blurb cap; the frontend renders it as one small line
MIN_CHARS = 20           # shorter than this is not a description, skip
SHORT_SENTENCE = 60      # a first sentence under this gets the second appended

# ---------------------------------------------------------------------------
# guards — what makes a resolved article "confidently the right one"
# ---------------------------------------------------------------------------
# P31 (instance of) allow-sets. Clubs/stadiums reuse run.py's (they already
# encode the city/person namesake traps); people categories require Q5, which
# is what stops a coach card from taking the club named after him.
HUMAN_P31_ALLOW = frozenset(("Q5",))
DESC_P31_ALLOW = {
    "club":          run.CLUB_P31_ALLOW,
    "club_nickname": run.CLUB_P31_ALLOW,
    "stadium":       run.STADIUM_P31_ALLOW,
    "coach":         HUMAN_P31_ALLOW,
    "referee":       HUMAN_P31_ALLOW,
    "commentator":   HUMAN_P31_ALLOW,
    # derby / trophy / era: too varied for a P31 allow-set (an event, an
    # award, a rivalry, a nickname). The football guard below carries them.
}

# The lead must be about FOOTBALL. This is the guard that survives everything
# else: a city, a poet or a film that slipped through P31 does not describe
# itself with these words. Applied to every category, no exceptions.
FOOTBALL_RE = re.compile(
    r"футбол|soccer|мяч|дерби|чемпионат|лига|сборн|клуб|стадион|арена|турнир",
    re.I,
)
# ruwiki disambiguation/list pages that are not flagged as such.
NOT_AN_ARTICLE_RE = re.compile(
    r"^(список|перечень)\b|может (означать|относиться)|"
    r"(фамилия|имя|топоним)[\s,]*(—|-)|значения:",
    re.I,
)

# ---------------------------------------------------------------------------
# blurb shaping
# ---------------------------------------------------------------------------
COMBINING_ACUTE = "́"          # ruwiki stress marks: «Кра́снодар»
# Abbreviations whose trailing dot must NOT end a sentence.
ABBREV_RE = re.compile(
    r"\b(?:т\.\s*н|т\.\s*д|т\.\s*п|им|св|г|гг|в|вв|см|стр|ул|д|обл|р|тыс|млн|"
    r"млрд|мин|св|нач|кон|St|Mr|Mrs|Dr|vs|etc|i\.e|e\.g|U\.S|F\.C|A\.C)\.$",
    re.I,
)
# "«Барселона» — испанский клуб" / "Олд Траффорд — футбольный стадион" — the
# part before the dash is the subject the card name already shows.
SUBJECT_DASH_RE = re.compile(r"^(.{0,80}?)\s+[—–-]\s+(.+)$", re.S)


def strip_accents(text):
    """Drop ruwiki stress marks, keep every other character intact."""
    return unicodedata.normalize("NFC", (text or "").replace(COMBINING_ACUTE, ""))


def drop_parentheticals(text):
    """Remove top-level (...) and [...] groups — native spellings, IPA,
    footnote leftovers — collapsing the whitespace they leave behind."""
    out, depth = [], 0
    for ch in text or "":
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(ch)
    cleaned = "".join(out)
    cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned)
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def split_sentences(text):
    """Sentences of a plain-text lead. Splits on . ! ? followed by a space and
    an upper-case/quote start, keeping abbreviations ("им.", "т. д.") whole."""
    parts, buf = [], []
    tokens = re.split(r"(?<=[.!?])\s+", text or "")
    for token in tokens:
        buf.append(token)
        joined = " ".join(buf)
        if ABBREV_RE.search(joined):
            continue                      # abbreviation — the sentence goes on
        parts.append(joined.strip())
        buf = []
    if buf:
        parts.append(" ".join(buf).strip())
    return [p for p in parts if p]


def strip_subject(sentence):
    """"«Барселона» — испанский футбольный клуб" -> "Испанский футбольный
    клуб". The card already shows the name, so the definition alone reads
    better (and matches the hand-written term/position blurbs). Only strips
    when what precedes the dash is short enough to be a name, never when the
    dash separates real clauses."""
    match = SUBJECT_DASH_RE.match(sentence.strip())
    if not match:
        return sentence.strip()
    subject, definition = match.group(1), match.group(2).strip()
    # A long left side is a clause, not a title — keep the sentence whole.
    if not definition or len(subject) > 60:
        return sentence.strip()
    return definition[:1].upper() + definition[1:]


def trim(text, max_chars=MAX_CHARS):
    """Cut to max_chars on a word boundary, adding an ellipsis when cut."""
    text = (text or "").strip().rstrip(",;: ")
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars].rsplit(" ", 1)[0].rstrip(",;:.— ")
    return cut + "…"


def blurb_from_lead(lead, max_chars=MAX_CHARS):
    """Wikipedia lead -> a card blurb. Returns '' when nothing usable is left
    (too short, a list/disambiguation page, an empty lead)."""
    text = strip_accents(lead or "").strip()
    if not text or NOT_AN_ARTICLE_RE.search(text):
        return ""
    text = drop_parentheticals(text)
    sentences = split_sentences(text)
    if not sentences:
        return ""
    first = strip_subject(sentences[0])
    # A very short opener ("Испанский клуб.") gains from the next sentence.
    if len(first) < SHORT_SENTENCE and len(sentences) > 1:
        candidate = (first.rstrip() + " " + sentences[1].strip()).strip()
        if len(candidate) <= max_chars:
            first = candidate
    blurb = trim(first, max_chars).rstrip(".")
    return blurb if len(blurb) >= MIN_CHARS else ""


def lead_is_football(lead):
    """The hard guard: a lead that never mentions football is the wrong
    article, whatever the title matching said."""
    return bool(FOOTBALL_RE.search(lead or ""))


# ---------------------------------------------------------------------------
# Supabase I/O
# ---------------------------------------------------------------------------
SELECT_COLS = "id,name,name_en,category,category_ru,descriptions,pageviews"


def fetch_cards(url, key, categories, names, ids):
    """Active cards of the wanted categories that have NO descriptions yet,
    most popular first. --names / --ids override the emptiness filter so a
    specific card can be re-examined (the write guard still protects it).
    Paged like every other docs/cards_*.py reader, so a growing deck can
    never silently return only the first page."""
    base = {"select": SELECT_COLS, "active": "eq.true",
            "order": "pageviews.desc.nullslast,id.asc"}
    if names:
        base["name"] = "in.({})".format(
            ",".join('"{}"'.format(n.replace('"', "")) for n in names))
    elif ids:
        base["id"] = "in.({})".format(",".join(ids))
    else:
        base["category"] = "in.({})".format(",".join(categories))
        base["descriptions"] = "is.null"

    rows, offset = [], 0
    while True:
        params = dict(base, limit=1000, offset=offset)
        resp = requests.get(url.rstrip("/") + "/rest/v1/cards",
                            headers={"apikey": key,
                                     "Authorization": "Bearer " + key},
                            params=params, timeout=60)
        resp.raise_for_status()
        batch = resp.json()
        rows += batch
        if len(batch) < 1000:
            break
        offset += 1000
    # Player cards are never in scope, even when named explicitly.
    return [r for r in rows if r.get("category") not in EXCLUDED_CATEGORIES]


def patch_descriptions(url, key, card_id, descriptions):
    """PATCH one card. Guarded on `descriptions IS NULL` IN THE REQUEST, so a
    blurb written by a human (or a parallel run) between our SELECT and this
    write is never clobbered — the filter makes it a no-op."""
    resp = requests.patch(
        url.rstrip("/") + "/rest/v1/cards",
        headers={"apikey": key, "Authorization": "Bearer " + key,
                 "Content-Type": "application/json", "Prefer": "return=minimal"},
        params={"id": "eq." + str(card_id), "descriptions": "is.null"},
        json={"descriptions": descriptions}, timeout=30)
    resp.raise_for_status()


# ---------------------------------------------------------------------------
# per-card resolution
# ---------------------------------------------------------------------------
def make_validator(card, wikidata, cache, budget):
    """P31 callback for run.resolve_card_qid — see DESC_P31_ALLOW. Returns
    None (no validation) for the categories without an allow-set."""
    allow = DESC_P31_ALLOW.get(card.get("category"))
    if not allow:
        return None

    def _ok(qid):
        if cache.get("wikidata_p31", qid) is None:
            budget.consume()          # count only real network calls
        return bool(set(wikidata.instance_of_qids(qid)) & allow)

    return _ok


def build_for_card(card, resolver, en_resolver, wikidata, cache, budget):
    """(descriptions|None, note). `note` explains every outcome so the report
    can show WHY a card was skipped — a silent skip hides broken data."""
    titles = run.cards_photos_candidates(card)
    if not titles:
        return None, "нет названия"

    validate = make_validator(card, wikidata, cache, budget)
    qid, title, via_search = run.resolve_card_qid(resolver, card, titles, validate)
    if not qid:
        return None, "статья ruwiki не найдена (или отбракована P31-гардом)"

    lead = resolver.extract_for_title(title)
    if not lead:
        return None, "пустая преамбула ruwiki: " + title
    if not lead_is_football(lead):
        return None, "преамбула не про футбол — чужая статья: " + title

    ru = blurb_from_lead(lead)
    if not ru:
        return None, "преамбула не сворачивается в описание: " + title

    descriptions = {"ru": ru}
    # English blurb — best effort, never a reason to skip the card.
    en_title = (wikidata.titles_for_qid(qid) or {}).get("enwiki")
    if en_title:
        en_lead = en_resolver.extract_for_title(en_title)
        if en_lead and lead_is_football(en_lead):
            en = blurb_from_lead(en_lead)
            if en:
                descriptions["en"] = en

    note = "ruwiki: {}{}".format(title, " (через поиск)" if via_search else "")
    return descriptions, note


# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Заполнить cards.descriptions для неигровых карточек "
                    "из Википедии (dry-run по умолчанию, APPLY=1 — запись).")
    parser.add_argument("--limit", type=int, default=0,
                        help="обработать только N карточек (0 = все)")
    parser.add_argument("--categories", default=",".join(TARGET_CATEGORIES),
                        help="категории через запятую (по умолчанию все неигровые)")
    parser.add_argument("--names", default="",
                        help="конкретные карточки по имени, через запятую")
    parser.add_argument("--ids", default="",
                        help="конкретные карточки по id, через запятую")
    args = parser.parse_args()

    load_dotenv(os.path.join(SCRAPER, ".env"))
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("Нужны SUPABASE_URL и SUPABASE_KEY (env или .env).")

    cfg = json.load(open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))
    pv = cfg["pageviews"]
    cache = FileCache(os.path.join(SCRAPER, cfg["cache"]["dir"]),
                      cfg["cache"]["enabled"])
    # The SAME per-day Wikimedia cap the photo/legend steps share.
    budget = WikimediaBudget(
        cfg.get("photos", {}).get("daily_request_budget", 5000),
        os.path.join(SCRAPER, cfg["cache"]["dir"], "photos_budget.json"))
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget)
    en_resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget,
        api_url="https://en.wikipedia.org/w/api.php", cache_prefix="enwiki")

    categories = [c.strip() for c in args.categories.split(",") if c.strip()]
    names = [n.strip() for n in args.names.split(",") if n.strip()]
    ids = [i.strip() for i in args.ids.split(",") if i.strip()]

    cards = fetch_cards(url, key, categories, names, ids)
    if args.limit > 0:
        cards = cards[:args.limit]

    by_category = {}
    for c in cards:
        by_category[c.get("category")] = by_category.get(c.get("category"), 0) + 1

    print("=" * 72)
    print("CARDS DESCRIPTIONS — {}".format(
        "LIVE, запись cards.descriptions" if APPLY else "DRY RUN, без записи"))
    print("=" * 72)
    print("Источник        : ruwiki преамбула (prop=extracts) + enwiki по QID")
    print("Гарды           : P31 (клуб/стадион/человек) + «преамбула про футбол»")
    print("Карточек в работе: {}".format(len(cards)))
    for cat in sorted(by_category):
        print("  {:<14} : {}".format(cat, by_category[cat]))
    print("Бюджет Wikimedia : {}/{} использовано сегодня".format(
        budget.used, budget.limit))
    print("-" * 72, flush=True)

    written = skipped = resolved = 0
    skips = {}
    for i, card in enumerate(cards, 1):
        name = card.get("name")
        try:
            descriptions, note = build_for_card(
                card, resolver, en_resolver, wikidata, cache, budget)
        except RuntimeError as exc:      # daily budget wall — stop politely
            print("\n!!! {}".format(exc))
            print("!!! Прогресс сохранён в кеше, продолжите завтра.", flush=True)
            break
        except requests.RequestException as exc:
            descriptions, note = None, "сетевая ошибка: {}".format(exc)

        if not descriptions:
            skipped += 1
            reason = note.split(":")[0]
            skips[reason] = skips.get(reason, 0) + 1
            print("[{}/{}] — {:<28} ПРОПУСК: {}".format(
                i, len(cards), name, note), flush=True)
            continue

        resolved += 1
        print("[{}/{}] ✓ {:<28} {}".format(i, len(cards), name, note))
        print("      БЫЛО : {}".format(card.get("descriptions") or "—"))
        print("      СТАЛО: ru: {}".format(descriptions["ru"]))
        if "en" in descriptions:
            print("             en: {}".format(descriptions["en"]))
        if APPLY:
            patch_descriptions(url, key, card["id"], descriptions)
            written += 1
        print(flush=True)

    print("-" * 72)
    print("ИТОГО: {} {} | пропущено {} | бюджет Wikimedia {}/{}".format(
        written if APPLY else resolved,
        "записано" if APPLY else "готово к записи (dry-run)",
        skipped, budget.used, budget.limit))
    for reason in sorted(skips, key=lambda r: -skips[r]):
        print("  пропуск: {:<50} {}".format(reason, skips[reason]))
    if not APPLY:
        print("\nЗапись не выполнялась. Повторите с APPLY=1, чтобы применить.")


if __name__ == "__main__":
    main()
