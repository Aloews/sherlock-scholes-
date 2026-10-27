# -*- coding: utf-8 -*-
"""Build real trophies for player cards from the ru-Wikipedia «Достижения»
section — WITH counts, so a card can say «Чемпион Испании ×9».

WHY THIS EXISTS. The dossier originally mixed trophies won with tournaments
attended. The current active catalogue has more than 25,000 player cards, and
the source collector was only generating a SQL preview. It never wrote the
results to production; the dossier also ignored the structured `facts.honours`
field. The current sync writes verified data idempotently and the dossier now
renders it without confusing participation with an award.

WHY WIKIPEDIA AND NOT A STATS API. It is the source this project already uses
for curated honours. It is free and carries a human-edited list of trophies and
individual awards. Since the catalogue exceeds 25,000 players, the scheduled
workflow refreshes the 800 highest-fame cards daily plus an 800-card rolling
window. The high-profile cards are checked every day; the wider catalogue
rotates over roughly a month.

WHAT IT PARSES. ru-wiki wikitext, section «== Достижения ==», its «Командные»
and «Личные» subsections. Lines look like

    * [[Чемпионат Испании по футболу|Чемпион Испании]] ('''9'''): [[…|2004/05]], …

so the title, the count (bold or plain parens) and the kind all come out. Wiki
markup, templates, refs and HTML are stripped; a parenthetical that is not a
number — «Чемпион MLS (обладатель Кубка MLS)» — is left alone.

RESOLUTION. cards.name is passed straight to the API with redirects=1: ru-wiki
redirects «Садио Мане» to «Мане, Садио», so no separate title lookup is
needed. Verified on Mané, Ronaldo, Lunin, Seaman.

OUTPUT. Dry run by default: writes docs/cards_honours.sql without touching the
database. With --apply, it merges honours into cards.facts through the Supabase
REST API, preserving every unrelated facts key. Empty/failed source responses
never erase existing honours.

    python docs/cards_honours_build.py --limit 20                # dry run
    APPLY=1 python docs/cards_honours_build.py --limit 800 --apply
    APPLY=1 python docs/cards_honours_build.py --only-name "Гарри Кейн" --apply

The scheduled workflow uses the service-role key from GitHub Secrets. Never put
that key in the repository or client app.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

# Encoding is configured in main(), not on import, so parser tests can import this module.

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.join(os.path.dirname(HERE), "football_scraper")
OUT_SQL = os.path.join(HERE, "cards_honours.sql")

# Wikimedia asks for a real contact in the User-Agent and throttles anonymous
# scrapers hard without one. See players-db-methodology.md §6.
UA = "SherlockScholesBot/1.0 (giafreec@gmail.com)"
API = "https://ru.wikipedia.org/w/api.php"
PAUSE_S = 0.4          # polite: well under the 1 req/s ceiling for bursts

LINK = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]")
COUNT = re.compile(r"\(\s*'{0,3}(\d+)'{0,3}\s*\)")


def strip_markup(s: str) -> str:
    s = LINK.sub(r"\1", s)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("'''", "").replace("''", "")
    s = re.sub(r"\s+", " ", s)
    return s.strip(" .;:—–-*")


def fetch_wikitext(title: str, session: requests.Session) -> str | None:
    r = session.get(API, params={
        "action": "parse", "page": title, "prop": "wikitext",
        "format": "json", "formatversion": "2", "redirects": "1",
    }, timeout=30)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    payload = r.json()
    if payload.get("error"):
        return None
    return payload.get("parse", {}).get("wikitext")


# ru-wiki does not use one heading for this. Real examples from the deck:
# «Достижения» (Iniesta), «Титулы» (Pelé), «Награды и достижения» (Beckham),
# and Zidane has TWO — «Достижения в качестве игрока» and «…в качестве
# тренера» — so every matching section is read, not just the first.
HONOUR_HEADING = re.compile(r"^==\s*([^=]*(?:достижени|титул|награ)[^=]*?)\s*==\s*$",
                            re.M | re.I)


def _sections(wikitext: str) -> list[str]:
    bodies = []
    for head in HONOUR_HEADING.finditer(wikitext):
        rest = wikitext[head.end():]
        nxt = re.search(r"^==[^=]", rest, re.M)
        bodies.append(rest[:nxt.start()] if nxt else rest)
    return bodies


def parse_honours(wikitext: str) -> list[dict]:
    """[{title, count, kind}] from every honours-shaped section, in order."""
    out, kind = [], None
    for line in "\n".join(_sections(wikitext)).splitlines():
        sub = re.match(r"^===\s*([^=]+?)\s*===", line)
        if sub:
            k = sub.group(1).lower()
            kind = "team" if "командн" in k else ("personal" if "личн" in k else kind)
            continue
        if not line.lstrip().startswith("*"):
            continue
        item = line.lstrip("* ").strip()
        if not item:
            continue

        count, m = 1, COUNT.search(item)
        if m:
            count = int(m.group(1))
            item = item[:m.start()] + item[m.end():]

        # Everything before the first colon is the honour; after it are years.
        title = strip_markup(item.split(":", 1)[0])
        if len(title) < 3:
            continue
        out.append({"title": title, "count": count, "kind": kind or "team"})

    # Two honour sections can repeat an entry (player vs manager lists);
    # keep the higher count rather than showing the same trophy twice.
    merged: dict[tuple, dict] = {}
    for h in out:
        k = (h["title"], h["kind"])
        if k not in merged or h["count"] > merged[k]["count"]:
            merged[k] = h
    return list(merged.values())


def fetch_cards(url: str, key: str, limit: int, offset: int = 0,
                only_name: str | None = None) -> list[dict]:
    endpoint = url.rstrip("/") + "/rest/v1/cards"
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    rows, page_offset = [], max(0, offset)
    while True:
        page_size = 1000 if not limit else min(1000, limit - len(rows))
        params = {
            "select": "id,name,fame,facts,category",
            "category": "in.(player,woman)",
            "active": "eq.true",
            "order": "fame.desc.nullslast,id.asc",
            "limit": page_size,
            "offset": page_offset,
        }
        if only_name:
            params["name"] = "eq." + only_name
        r = requests.get(endpoint, headers=headers, params=params, timeout=60)
        r.raise_for_status()
        batch = r.json()
        rows.extend(batch)
        if only_name or len(batch) < page_size or (limit and len(rows) >= limit):
            break
        page_offset += len(batch)
    return rows[:limit] if limit else rows


def _legacy_title_identity(value: str) -> tuple[str, int]:
    """Canonical key/count for the legacy string list still read by old clients."""
    count_match = COUNT.search(value) or re.search(r"\s*(?:×|x)\s*(\d+)\s*$", value, re.I)
    count = int(count_match.group(1)) if count_match else 1
    title = value[:count_match.start()].strip() if count_match else value.strip()
    title = re.sub(r"\s*[×x]\s*\d+\s*$", "", title, flags=re.I).strip()
    title = re.sub(r"\s*\(\d+\)\s*$", "", title).strip()
    normalized = strip_markup(title).lower()
    if "золотого мяча" in normalized or "золотой мяч" in normalized:
        return "золотой мяч", count
    if "трофей копа" in normalized or "кубок копа" in normalized:
        return "трофей копа", count
    if "трофей яшина" in normalized or "яшина" in normalized:
        return "трофей яшина", count
    if "герда мюллера" in normalized or "герд мюллер" in normalized:
        return "трофей герда мюллера", count
    if "сократес" in normalized:
        return "приз сократеса", count
    normalized = re.sub(r"^обладатель\s+", "", normalized)
    normalized = re.sub(r"\s+по версии\s+.+$", "", normalized)
    normalized = re.sub(r"[«»„“”\".,:;!?]", "", normalized)
    return re.sub(r"\s+", " ", normalized).strip(), count


def legacy_title_label(honour: dict) -> str:
    """Produce a readable string for deployed clients that predate facts.honours."""
    title = strip_markup(str(honour.get("title") or ""))
    lower = title.lower()
    if "золотого мяча" in lower or "золотой мяч" in lower:
        title = "Золотой мяч"
    elif "трофей копа" in lower or "кубок копа" in lower:
        title = "Трофей Копа"
    elif "трофей яшина" in lower or "яшина" in lower:
        title = "Трофей Яшина"
    elif "герда мюллера" in lower or "герд мюллер" in lower:
        title = "Трофей Герда Мюллера"
    elif "сократес" in lower:
        title = "Приз Сократеса"
    else:
        title = re.sub(r"^обладатель\s+", "", title, flags=re.I)
        title = re.sub(r"\s+по версии\s+.+$", "", title, flags=re.I)
        title = title.strip(" «»„“”\"")
    count = max(1, int(honour.get("count") or 1))
    return title + (f" ×{count}" if count > 1 else "")


def merge_legacy_titles(existing: list | None, honours: list[dict]) -> list[str]:
    """Merge the new source into legacy facts.titles without losing curated entries."""
    source_titles = existing if isinstance(existing, list) else []
    titles = [item for item in source_titles if isinstance(item, str) and item.strip()]
    for honour in honours:
        label = legacy_title_label(honour)
        key, count = _legacy_title_identity(label)
        matches = [i for i, old in enumerate(titles) if _legacy_title_identity(old)[0] == key]
        if not matches:
            titles.append(label)
            continue
        best_index = max(matches, key=lambda i: _legacy_title_identity(titles[i])[1])
        if count > _legacy_title_identity(titles[best_index])[1]:
            titles[best_index] = label
        for i in reversed(matches):
            if i != best_index:
                titles.pop(i)
                if i < best_index:
                    best_index -= 1
    return titles


def apply_honours(url: str, key: str, card: dict, honours: list[dict]) -> bool:
    """Merge verified honours into one card without overwriting unrelated facts."""
    existing_facts = card.get("facts")
    facts = dict(existing_facts) if isinstance(existing_facts, dict) else {}
    legacy_titles = merge_legacy_titles(facts.get("titles"), honours)
    if facts.get("honours") == honours and facts.get("titles") == legacy_titles:
        return False

    facts["honours"] = honours
    facts["titles"] = legacy_titles
    facts["honours_source"] = "https://ru.wikipedia.org/wiki/" + urllib.parse.quote(
        card["name"].replace(" ", "_"), safe="()_,"
    )
    facts["honours_synced_at"] = datetime.now(timezone.utc).isoformat()
    endpoint = url.rstrip("/") + "/rest/v1/cards"
    response = requests.patch(
        endpoint,
        params={"id": "eq." + str(card["id"]), "active": "eq.true"},
        headers={
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        json={"facts": facts},
        timeout=60,
    )
    response.raise_for_status()
    return True


def sql_quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20, help="players to process (0 = all)")
    ap.add_argument("--offset", type=int, default=0, help="offset in fame-ordered active player catalogue")
    ap.add_argument("--only-name", help="process one exact active player card name")
    ap.add_argument("--apply", action="store_true", help="write changed honours to Supabase")
    args = ap.parse_args()

    if args.limit < 0 or args.offset < 0:
        raise SystemExit("--limit and --offset must be non-negative")
    if args.only_name and args.offset:
        raise SystemExit("--offset cannot be combined with --only-name")

    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env or environment)")
    if args.apply and os.environ.get("APPLY", "").strip() not in ("1", "true", "TRUE"):
        raise SystemExit("--apply requires APPLY=1 as a second explicit write guard")

    cards = fetch_cards(url, key, args.limit, args.offset, args.only_name)
    session = requests.Session()
    session.headers["User-Agent"] = UA

    lines = [
        "-- Real trophies parsed from ru-Wikipedia «Достижения»",
        "-- Generated by docs/cards_honours_build.py. Dry run unless --apply is used.",
        "-- Source failures and empty parses never clear previously stored honours.",
        "",
    ]
    found = missing = total_honours = updated = unchanged = failures = 0

    for i, card in enumerate(cards, 1):
        try:
            wikitext = fetch_wikitext(card["name"], session)
            time.sleep(PAUSE_S)
            if not wikitext:
                missing += 1
                print(f"  {i:4}/{len(cards)}  {card['name'][:34]:34}  source page/section unavailable; kept existing data")
                continue

            honours = parse_honours(wikitext)
            if not honours:
                missing += 1
                print(f"  {i:4}/{len(cards)}  {card['name'][:34]:34}  no parsed honours; kept existing data")
                continue

            found += 1
            total_honours += len(honours)
            team = [h for h in honours if h["kind"] == "team"]
            top = sorted(team, key=lambda h: -h["count"])[:3]
            print(f"  {i:4}/{len(cards)}  {card['name'][:34]:34}  {len(honours):3} "
                  + ", ".join(f"{h['title']}×{h['count']}" for h in top))

            legacy_titles = merge_legacy_titles(
                (card.get("facts") or {}).get("titles") if isinstance(card.get("facts"), dict) else [],
                honours,
            )
            lines.append(
                f"UPDATE cards SET facts = jsonb_set("
                f"jsonb_set(coalesce(facts, '{{}}'::jsonb), '{{honours}}', "
                f"{sql_quote(json.dumps(honours, ensure_ascii=False))}::jsonb, true), "
                f"'{{titles}}', {sql_quote(json.dumps(legacy_titles, ensure_ascii=False))}::jsonb, true) "
                f"WHERE id = '{card['id']}'; -- {card['name']}"
            )
            if args.apply:
                if apply_honours(url, key, card, honours):
                    updated += 1
                else:
                    unchanged += 1
        except (requests.RequestException, ValueError, KeyError, TypeError) as error:
            failures += 1
            print(f"  {i:4}/{len(cards)}  {card.get('name', '?')[:34]:34}  ERROR: {error}")

    with open(OUT_SQL, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print("\n" + "=" * 64)
    print(f"players selected      : {len(cards)}")
    print(f"with parsed honours   : {found}")
    print(f"source/no-honours     : {missing} (existing data preserved)")
    print(f"honours parsed        : {total_honours}")
    print(f"records changed       : {updated}")
    print(f"records unchanged     : {unchanged}")
    print(f"errors                : {failures}")
    print(f"SQL preview           : {OUT_SQL} (not executed)")
    if args.apply and failures:
        raise SystemExit(f"{failures} player record(s) failed; inspect the log and retry safely")


if __name__ == "__main__":
    main()
