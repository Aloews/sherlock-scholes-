#!/usr/bin/env python3
"""Create auditable daily shortlists for major individual football awards.

Run dry by default:
  python docs/award_candidates_build.py --season 2026
Apply with SUPABASE_URL and SUPABASE_KEY (service role):
  python docs/award_candidates_build.py --season 2026 --apply

The output is a relative candidate index, not a calibrated win probability.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from typing import Any

import requests
from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "football_scraper"))
from award_analytics import aggregate_player_seasons, rank_candidates  # noqa: E402

PAGE_SIZE = 1000
AWARDS = ("ballon_dor", "ballon_dor_feminin", "the_best", "the_best_female", "golden_boy", "golden_boot")
YOUTH_COMPETITION = re.compile(r"\b(u\s*1[789]|u\s*2[013]|under\s*\d{2}|youth|junior|academy|reserve|primavera|jeugd|juvenil)\b", re.I)
RESERVE_CLUB = re.compile(r"\b(reserves?|u\s*2[13]|b team|ii|primavera|academy)\b", re.I)


def fetch_all(session: requests.Session, base: str, key: str, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    url = f"{base.rstrip('/')}/rest/v1/{table}"
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page_params = {**params, "limit": str(PAGE_SIZE), "offset": str(offset)}
        response = session.get(url, params=page_params, headers=headers, timeout=60)
        response.raise_for_status()
        batch = response.json()
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        offset += len(batch)


def write_snapshots(session: requests.Session, base: str, key: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    url = f"{base.rstrip('/')}/rest/v1/award_candidate_snapshot"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    # Small batches keep REST payloads well below gateway limits.
    normalized_rows = []
    for row in rows:
        normalized = dict(row)
        normalized["candidate_rank"] = normalized.pop("rank")
        normalized_rows.append(normalized)
    for start in range(0, len(normalized_rows), 100):
        response = session.post(
            url,
            params={"on_conflict": "award_key,season_id,snapshot_date,card_id"},
            headers=headers,
            json=normalized_rows[start:start + 100],
            timeout=60,
        )
        response.raise_for_status()


def build_candidates(base: str, key: str, season: int, snapshot_day: date,
                     limit: int, apply: bool) -> list[dict[str, Any]]:
    session = requests.Session()
    cards = fetch_all(session, base, key, "cards", {
        "select": "id,name,name_en,category,born_on,fame,fame_world,market_value_eur",
        "active": "eq.true",
        "category": "in.(player,woman)",
        "order": "id.asc",
    })
    raw_stats = fetch_all(session, base, key, "player_season_stat", {
        "select": "card_id,season_id,competition_id,club_id,apps,minutes,goals,assists,team_goals,opponent_goals,fetched_at",
        "season_id": f"eq.{season}",
        "card_id": "not.is.null",
        "order": "card_id.asc",
    })
    competitions = fetch_all(session, base, key, "tm_competition", {
        "select": "id,name,short_name",
        "order": "id.asc",
    })
    clubs = fetch_all(session, base, key, "tm_club", {
        "select": "id,name,is_national_team",
        "order": "id.asc",
    })
    competition_names = {str(row["id"]): " ".join(filter(None, [row.get("name"), row.get("short_name")])) for row in competitions}
    club_by_id = {str(row["id"]): row for row in clubs}
    card_by_id = {str(card["id"]): card for card in cards}

    # Exclude youth/reserve competitions from senior award candidates. A missing
    # competition dictionary is kept but later lowers evidence coverage.
    clean_stats = []
    for row in raw_stats:
        card_id = str(row.get("card_id") or "")
        if card_id not in card_by_id:
            continue
        comp_name = competition_names.get(str(row.get("competition_id") or ""), "")
        if comp_name and YOUTH_COMPETITION.search(comp_name):
            continue
        club = club_by_id.get(str(row.get("club_id") or ""))
        if club and RESERVE_CLUB.search(str(club.get("name") or "")):
            continue
        clean_stats.append(row)
    aggregated = aggregate_player_seasons(clean_stats)
    day_cards = [card_by_id[pid] for pid in aggregated if pid in card_by_id]
    output: list[dict[str, Any]] = []

    for award in AWARDS:
        eligible_cards = []
        for card in day_cards:
            category = card.get("category")
            if award in ("ballon_dor", "the_best", "golden_boy", "golden_boot") and category != "player":
                continue
            if award in ("ballon_dor_feminin", "the_best_female") and category != "woman":
                continue
            eligible_cards.append(card)
        rows = rank_candidates(
            eligible_cards, aggregated, award_key=award, season_id=season,
            snapshot_date=snapshot_day, limit=limit,
        )
        output.extend(rows)

    if apply:
        write_snapshots(session, base, key, output)
    return output


def main() -> int:
    load_dotenv(os.path.join(ROOT, ".env"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=datetime.now(timezone.utc).year)
    parser.add_argument("--limit", type=int, default=50, help="top candidates to store per award (1..50)")
    parser.add_argument("--apply", action="store_true", help="write snapshots to Supabase")
    args = parser.parse_args()
    if not 1 <= args.limit <= 50:
        parser.error("--limit must be between 1 and 50")
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not base or not key:
        parser.error("SUPABASE_URL and SUPABASE_KEY are required")
    day = date.today()
    try:
        rows = build_candidates(base, key, args.season, day, args.limit, args.apply)
    except requests.RequestException as exc:
        print(f"award candidate refresh failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({
        "season": args.season,
        "snapshot_date": day.isoformat(),
        "model_version": "award-candidates-v1",
        "apply": args.apply,
        "rows": len(rows),
        "top_candidates": [
            {"award": row["award_key"], "rank": row["rank"], "card_id": row["card_id"],
             "score": row["candidate_score"], "confidence": row["confidence"],
             "data_coverage": row["data_coverage"]}
            for row in rows if row["rank"] <= min(5, args.limit)
        ],
        "score_note": "Relative index only; not a calibrated probability or confirmed award.",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
