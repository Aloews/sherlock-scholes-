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
PAUSE_S = 1.1          # stay below one Wikimedia request per second

LINK = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]")
COUNT = re.compile(r"\(\s*'{0,3}(\d+)'{0,3}\s*\)\s*$")


def strip_markup(s: str) -> str:
    s = LINK.sub(r"\1", s)
    # Wikimedia pages sometimes end a citation template mid-line or mid-response.
    # Remove the incomplete trailing citation but preserve the actual award title.
    s = re.sub(r"\{\{\s*(?:cite|citation|ref|web)\b.*$", "", s, flags=re.I | re.S)
    # MediaWiki citation templates can contain nested templates. Remove innermost
    # templates repeatedly instead of leaving fragments such as "{{cite web |url=...".
    for _ in range(10):
        cleaned = re.sub(r"\{\{[^{}]*\}\}", "", s)
        if cleaned == s:
            break
        s = cleaned
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("'''", "").replace("''", "")
    s = re.sub(r"\s+", " ", s)
    # Keep a trailing colon: it separates an explicit repeat count from its year list.
    return s.strip(" .;—–-*")


def fetch_wikitext(title: str, session: requests.Session) -> str | None:
    params = {
        "action": "parse", "page": title, "prop": "wikitext",
        "format": "json", "formatversion": "2", "redirects": "1",
    }
    transient_statuses = {429, 500, 502, 503, 504}
    max_attempts = 5
    for attempt in range(max_attempts):
        try:
            response = session.get(API, params=params, timeout=30)
        except requests.RequestException:
            if attempt == max_attempts - 1:
                raise
            time.sleep(min(30, 2 ** (attempt + 1)))
            continue

        if response.status_code == 404:
            return None
        if response.status_code in transient_statuses and attempt < max_attempts - 1:
            retry_after = response.headers.get("Retry-After")
            try:
                delay = max(1.0, min(60.0, float(retry_after)))
            except (TypeError, ValueError):
                delay = min(30, 2 ** (attempt + 1))
            time.sleep(delay)
            continue

        response.raise_for_status()
        payload = response.json()
        if payload.get("error"):
            return None
        return payload.get("parse", {}).get("wikitext")
    return None


# ru-wiki does not use one heading for this. Real examples from the deck:
# «Достижения» (Iniesta), «Титулы» (Pelé), «Награды и достижения» (Beckham),
# and Zidane has TWO — «Достижения в качестве игрока» and «…в качестве
# тренера» — so every matching section is read, not just the first.
HONOUR_HEADING = re.compile(r"^==\s*([^=]*(?:достижени|титул|награ)[^=]*?)\s*==\s*$",
                            re.M | re.I)


def _sections(wikitext: str) -> list[tuple[str, str]]:
    sections = []
    for head in HONOUR_HEADING.finditer(wikitext):
        rest = wikitext[head.end():]
        nxt = re.search(r"^==[^=]", rest, re.M)
        body = rest[:nxt.start()] if nxt else rest
        sections.append((head.group(1).strip(), body))
    return sections


def _role_from_heading(heading: str) -> str | None:
    value = heading.casefold()
    if re.search(r"в качестве игрока|как игрок|as a player|player career", value):
        return "player"
    if re.search(r"в качестве (?:главного )?тренера|в качестве менеджера|as a coach|as a manager|manager career", value):
        return "manager"
    return None


def _canonicalize_golden_ball_variants(honours: list[dict]) -> list[dict]:
    """Combine the France Football and FIFA Ballon d'Or eras into one total."""
    result = []
    groups: dict[tuple[str, str | None], dict[str, int]] = {}
    for honour in honours:
        title = str(honour.get("title") or "")
        lower = title.casefold()
        is_ball = (
            (("золот" in lower and "мяч" in lower)
             or "ballon d'or" in lower or "ballon d’or" in lower or "ballon dor" in lower)
            and "клубного чемпионата мира" not in lower and "club world cup" not in lower
        )
        if not is_ball or honour.get("kind") != "personal":
            result.append(honour)
            continue
        role = honour.get("role")
        variant = "fifa" if "фифа" in lower or "fifa" in lower else (
            "france" if "france football" in lower else "generic"
        )
        key = (str(honour.get("kind") or "personal"), role)
        counts = groups.setdefault(key, {})
        counts[variant] = max(counts.get(variant, 0), max(1, int(honour.get("count") or 1)))

    for (kind, role), counts in groups.items():
        distinct_eras = counts.get("fifa", 0) + counts.get("france", 0)
        total = max(counts.get("generic", 0), distinct_eras,
                    counts.get("fifa", 0), counts.get("france", 0))
        record = {"title": "Обладатель «Золотого мяча»", "count": total, "kind": kind}
        if role:
            record["role"] = role
        result.append(record)
    return result


PERSONAL_AWARD_TITLE_RE = re.compile(
    r"ballon\\s+d[’']or|золот(?:ой|ого)\\s+мяч|the\\s+best.*(?:player|footballer)|"
    r"игрок(?:иня)?\\s+года|футболистк?а?\\s+года|трофей\\s+копа|kopa\\s+trophy|"
    r"golden\\s+boy|золот(?:ой|ого)\\s+мальчик|трофей\\s+яшина|yashin\\s+trophy|"
    r"goalkeeper\\s+of\\s+the\\s+year|лучший\\s+вратар|герд\\s+мюллер|gerd\\s+m[üu]ller|"
    r"striker\\s+of\\s+the\\s+year|лучший\\s+нападающ|golden\\s+boot|"
    r"золот(?:ая|ой)\\s+бутс|сократес|socrates\\s+award|mvp|most\\s+valuable\\s+player|"
    r"лучший\\s+игрок|best\\s+player\\s+of\\s+the\\s+year",
    re.I,
)


def _kind_for_title(title: str, fallback: str | None = None) -> str:
    """Classify well-known individual awards as personal even on generic honours pages."""
    if PERSONAL_AWARD_TITLE_RE.search(strip_markup(title)):
        return "personal"
    return fallback if fallback in {"personal", "team"} else "team"


def parse_honours(wikitext: str) -> list[dict]:
    """Parse honours with role-aware, suffix-only counts."""
    out = []
    for section_heading, body in _sections(wikitext):
        kind = None
        role = _role_from_heading(section_heading)
        scope = None
        for line in body.splitlines():
            club_heading = re.match(r"^====\s*([^=]+?)\s*====", line)
            if club_heading:
                scope = club_heading.group(1).strip()
                continue
            sub = re.match(r"^===\s*([^=]+?)\s*===", line)
            if sub:
                heading = sub.group(1).strip()
                lower_heading = heading.casefold()
                detected_role = _role_from_heading(heading)
                if detected_role:
                    role = detected_role
                scope = None
                if "командн" in lower_heading or "team" in lower_heading:
                    kind = "team"
                elif "личн" in lower_heading or "individual" in lower_heading or "personal" in lower_heading:
                    kind = "personal"
                continue
            if not line.lstrip().startswith("*"):
                continue
            item = line.lstrip("* ").strip()
            if not item:
                continue

            item = strip_markup(item)
            award_text = item.split(":", 1)[0]
            # Only a count before a year list is a count; a parenthesized year is not.
            count = 1
            match = COUNT.search(award_text) if ":" in item else None
            if match:
                count = int(match.group(1))
                award_text = award_text[:match.start()] + award_text[match.end():]
            title = strip_markup(award_text)
            if len(title) < 3 or re.search(r"\{\{|\}\}|\|url\s*=|https?://", title, re.I):
                continue
            placeholder = title.lower().strip(" «»„“”\".,:;!?")
            if placeholder in {"награда", "награды", "награда «»"}:
                continue
            if title.count("«") != title.count("»"):
                continue
            if not re.search(r"[A-Za-zА-Яа-яЁё0-9]", title):
                continue
            record = {"title": title, "count": count, "kind": _kind_for_title(title, kind or "team")}
            if role:
                record["role"] = role
            if scope:
                record["_scope"] = scope
            out.append(record)

    # Repeated sections for the same club are duplicates; distinct club scopes
    # are additive (e.g. Ancelotti won 2 with Milan and 3 with Real Madrid).
    scoped_counts: dict[tuple, int] = {}
    unscoped_counts: dict[tuple, dict] = {}
    for honour in out:
        identity = (honour["title"], honour["kind"], honour.get("role"))
        scope = honour.get("_scope")
        if scope:
            key = (*identity, scope)
            scoped_counts[key] = max(scoped_counts.get(key, 0), honour["count"])
        else:
            if identity not in unscoped_counts or honour["count"] > unscoped_counts[identity]["count"]:
                unscoped_counts[identity] = honour

    identities = set(unscoped_counts)
    identities.update((key[0], key[1], key[2]) for key in scoped_counts)
    merged = []
    for identity in identities:
        matching_scopes = [count for key, count in scoped_counts.items() if key[:3] == identity]
        if matching_scopes:
            count = sum(matching_scopes)
            record = {"title": identity[0], "kind": identity[1], "count": count}
            if identity[2]:
                record["role"] = identity[2]
            merged.append(record)
        elif identity in unscoped_counts:
            merged.append(unscoped_counts[identity])
    return _canonicalize_golden_ball_variants(merged)

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
    # A year-specific win is a distinct legacy record from the player's career total.
    # Without this guard, updating "Золотой мяч ×2" to ×3 can replace and hide
    # the separately recorded "Золотой мяч 2026" entry.
    year_match = re.search(r"\b(20\d{2})$", normalized)
    year_suffix = " " + year_match.group(1) if year_match else ""
    award_name = normalized[:year_match.start()].strip() if year_match else normalized
    if "золотого мяча" in award_name or "золотой мяч" in award_name:
        return "золотой мяч" + year_suffix, count
    if "трофей копа" in award_name or "кубок копа" in award_name:
        return "трофей копа" + year_suffix, count
    if "трофей яшина" in award_name or "яшина" in award_name:
        return "трофей яшина" + year_suffix, count
    if "герда мюллера" in award_name or "герд мюллер" in award_name:
        return "трофей герда мюллера" + year_suffix, count
    if "сократес" in award_name:
        return "приз сократеса" + year_suffix, count
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
        title = title.strip()
        # Remove wrapping quotes only when they form a matched pair. A generic
        # strip("«»") also removes a valid trailing » from an internal quoted name.
        for opening, closing in (("«", "»"), ("„", "“"), ('"', '"')):
            if len(title) > 1 and title.startswith(opening) and title.endswith(closing):
                title = title[1:-1].strip()
                break
    count = max(1, int(honour.get("count") or 1))
    return title + (f" ×{count}" if count > 1 else "")


def merge_legacy_titles(existing: list | None, honours: list[dict]) -> list[str]:
    """Merge the new source into legacy facts.titles without losing curated entries."""
    source_titles = existing if isinstance(existing, list) else []
    titles = []
    for item in source_titles:
        if not isinstance(item, str) or not item.strip():
            continue
        # Salvage a valid title prefix when the old parser stored a truncated
        # trailing citation; do not throw away the award together with the markup.
        item = strip_markup(item)
        if not item or re.search(r"\{\{|\}\}|\|url\s*=|https?://", item, re.I):
            continue
        placeholder = item.strip().lower().strip(" «»„“”\".,:;!?")
        if placeholder in {"награда", "награды", "награда «»"}:
            continue
        if item.count("«") != item.count("»"):
            continue
        titles.append(item)
    for honour in honours:
        label = legacy_title_label(honour)
        if label.count("«") != label.count("»") or re.search(r"\{\{|\}\}|\|url\s*=|https?://", label, re.I):
            continue
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
    # Keep a year-specific win visible while suppressing only a duplicate generic
    # one-count label. A career total such as "Золотой мяч ×3" remains meaningful.
    year_specific_bases = set()
    for item in titles:
        identity, _count = _legacy_title_identity(item)
        year_match = re.search(r"\s(20\d{2})$", identity)
        if year_match:
            year_specific_bases.add(identity[:year_match.start()].strip())
    if year_specific_bases:
        filtered = []
        for item in titles:
            identity, count = _legacy_title_identity(item)
            if re.search(r"\s20\d{2}$", identity):
                filtered.append(item)
            elif identity in year_specific_bases and count <= 1:
                continue
            else:
                filtered.append(item)
        titles = filtered
    return titles


def merge_structured_honours(existing: list | None, incoming: list[dict]) -> list[dict]:
    """Merge source honours without deleting verified awards from another source."""
    merged: list[dict] = []
    positions: dict[tuple[str, str], int] = {}
    for item in list(existing or []) + list(incoming or []):
        if not isinstance(item, dict) or not str(item.get("title") or "").strip():
            continue
        key, parsed_count = _legacy_title_identity(legacy_title_label(item))
        kind = _kind_for_title(str(item.get("title") or ""), str(item.get("kind") or "team"))
        identity = (key, kind)
        try:
            count = max(1, int(item.get("count") or parsed_count or 1))
        except (TypeError, ValueError):
            count = max(1, parsed_count)
        normalized_item = dict(item)
        normalized_item["kind"] = kind
        normalized_item["count"] = count
        if identity not in positions:
            positions[identity] = len(merged)
            merged.append(normalized_item)
            continue
        index = positions[identity]
        previous = merged[index]
        previous_count = max(1, int(previous.get("count") or 1))
        # Prefer the record with the higher verified count, but retain source
        # metadata present on either record (e.g. official UEFA source/date).
        chosen = dict(previous if previous_count > count else normalized_item)
        other = normalized_item if previous_count > count else previous
        for field, value in other.items():
            if field not in chosen or chosen[field] in (None, "", [], {}):
                chosen[field] = value
        chosen["count"] = max(previous_count, count)
        merged[index] = chosen
    return merged


def apply_honours(url: str, key: str, card: dict, honours: list[dict]) -> bool:
    """Merge verified honours into one card without overwriting unrelated facts."""
    existing_facts = card.get("facts")
    facts = dict(existing_facts) if isinstance(existing_facts, dict) else {}
    merged_honours = merge_structured_honours(facts.get("honours"), honours)
    legacy_titles = merge_legacy_titles(facts.get("titles"), honours)
    if facts.get("honours") == merged_honours and facts.get("titles") == legacy_titles:
        return False

    facts["honours"] = merged_honours
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

            existing_facts = card.get("facts") if isinstance(card.get("facts"), dict) else {}
            merged_honours = merge_structured_honours(existing_facts.get("honours"), honours)
            legacy_titles = merge_legacy_titles(existing_facts.get("titles"), honours)
            lines.append(
                f"UPDATE cards SET facts = jsonb_set("
                f"jsonb_set(coalesce(facts, '{{}}'::jsonb), '{{honours}}', "
                f"{sql_quote(json.dumps(merged_honours, ensure_ascii=False))}::jsonb, true), "
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
