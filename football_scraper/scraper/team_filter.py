"""Match an explicit club list (config teams_filter) against the team names
API-Football returns. READ-ONLY name matching — no network, no DB.

Why fuzzy: the config lists clubs the way a human writes them ("Real Betis",
"Bayern Munich"), while API-Football may return "Betis" or "Bayern München".
A plain == would silently drop those clubs. We therefore match on three rungs,
loosest acceptable wins:

  1. exact match of the normalized full name;
  2. token-subset — every word of the shorter name appears in the longer one,
     so "Betis" matches "Real Betis" and "Monaco" matches "AS Monaco" — but
     "Real Madrid" never matches "Real Betis" (madrid != betis);
  3. difflib similarity >= RATIO on the normalized full string, catching
     spelling/diacritic variants ("Bayern Munich" vs "Bayern Munchen").

Normalization folds case, strips diacritics and punctuation, and collapses
whitespace, so "Atlético", "Atletico" and "ATLETICO" are the same token.
"""
import unicodedata
from difflib import SequenceMatcher

# Similarity floor for rung 3. High enough that only genuine spelling/diacritic
# variants pass, not two different clubs that share a word.
RATIO = 0.85

# Punctuation dropped during normalization; everything else that is not a
# letter/digit/space is also removed by _normalize's filter below.
_PUNCT = set("-‐‑‒–—_.,()[]{}'\"`«»·•/\\|&")


def _strip_diacritics(text):
    """Drop combining marks so 'München' -> 'Munchen', 'Atlético' -> 'Atletico'."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def _tokens(name):
    """Lower-case, diacritic-free word tokens of a club name. Punctuation is a
    separator, so 'Paris Saint-Germain' -> ['paris', 'saint', 'germain']."""
    if not name:
        return []
    folded = _strip_diacritics(name).casefold()
    cleaned = "".join(" " if ch in _PUNCT else ch for ch in folded)
    return cleaned.split()


def team_names_match(wanted, api_name):
    """True if `wanted` (config spelling) refers to the same club as `api_name`
    (API-Football spelling). See module docstring for the three rungs."""
    w_tokens = _tokens(wanted)
    a_tokens = _tokens(api_name)
    if not w_tokens or not a_tokens:
        return False

    w_join = "".join(w_tokens)
    a_join = "".join(a_tokens)
    if w_join == a_join:
        return True

    # Token-subset either direction: the shorter name's words all appear in the
    # longer one ("Betis" in "Real Betis", "Monaco" in "AS Monaco").
    w_set, a_set = set(w_tokens), set(a_tokens)
    if w_set <= a_set or a_set <= w_set:
        return True

    # Spelling / diacritic variants on the full string.
    return SequenceMatcher(None, w_join, a_join).ratio() >= RATIO


def select_teams(api_teams, wanted_names):
    """Pick the API teams that match an explicit club list. READ-ONLY.

    `api_teams` is the list of team dicts from API-Football (each has at least
    `id` and `name`); `wanted_names` is the configured club list for the
    league. Returns (selected_teams, missing_names):

      * selected_teams — the matching API team dicts, in config order, each
        included at most once (deduped by team id);
      * missing_names  — configured names that matched no API team, so the
        caller can warn and continue instead of crashing.
    """
    selected = []
    seen_ids = set()
    missing = []
    for wanted in wanted_names:
        match = next(
            (t for t in api_teams if team_names_match(wanted, t.get("name", ""))),
            None,
        )
        if match is None:
            missing.append(wanted)
            continue
        tid = match.get("id")
        if tid not in seen_ids:
            seen_ids.add(tid)
            selected.append(match)
    return selected, missing
