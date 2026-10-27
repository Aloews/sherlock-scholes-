#!/usr/bin/env python3
"""Check that current-season Transfermarkt stats reached women's cards."""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb import all_rows, sb  # noqa: E402

MIN_STATS_CARDS = 8


def main() -> int:
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_KEY"):
        print("SUPABASE_URL and SUPABASE_KEY are required", file=sys.stderr)
        return 2

    cards = all_rows("cards", {
        "select": "id,name_en,transfermarkt_id",
        "category": "eq.woman", "active": "is.true",
        "transfermarkt_id": "not.is.null", "order": "id.asc",
    })
    if not cards:
        print(json.dumps({"status": "insufficient", "reason": "no women's Transfermarkt IDs"}))
        return 1

    latest = sb("player_season_stat", {
        "select": "season_id", "order": "season_id.desc", "limit": "1",
    })
    if latest is None or not latest or latest[0].get("season_id") is None:
        print(json.dumps({"status": "insufficient", "reason": "no season stats in production"}))
        return 1
    season_id = str(latest[0]["season_id"])
    card_ids = [str(card["id"]) for card in cards]
    rows = all_rows("player_season_stat", {
        "select": "card_id,season_id,competition_id,minutes,apps,goals,assists",
        "card_id": "in.(" + ",".join(card_ids) + ")",
        "season_id": "eq." + season_id,
        "order": "card_id.asc",
    })
    players = {str(row["card_id"]) for row in rows if row.get("card_id")}
    players_with_minutes = {
        str(row["card_id"]) for row in rows
        if row.get("card_id") and row.get("minutes") is not None and float(row["minutes"] or 0) > 0
    }
    competitions = {str(row["competition_id"]) for row in rows if row.get("competition_id")}
    result = {
        "status": "success" if len(players_with_minutes) >= MIN_STATS_CARDS else "insufficient",
        "season_id": season_id, "women_cards_with_transfermarkt_id": len(cards),
        "women_cards_with_season_stats": len(players),
        "women_cards_with_minutes": len(players_with_minutes),
        "competitions": len(competitions), "minimum_required": MIN_STATS_CARDS,
    }
    print(json.dumps(result))
    return 0 if len(players_with_minutes) >= MIN_STATS_CARDS else 1


if __name__ == "__main__":
    raise SystemExit(main())
