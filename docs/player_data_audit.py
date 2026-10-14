#!/usr/bin/env python3
"""Read-only audit of active footballer cards and their photo/season/match coverage."""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb import all_rows  # noqa: E402


def has_text(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def audit_cards(cards, season_rows, match_rows):
    season_ids = set()
    season_tm_ids = set()
    for row in season_rows:
        if row.get("card_id"):
            season_ids.add(str(row["card_id"]))
        if has_text(row.get("tm_player_id")):
            season_tm_ids.add(str(row["tm_player_id"]))

    match_ids = {str(row["card_id"]) for row in match_rows if row.get("card_id")}
    match_quality = Counter()
    future = pre_2000 = 0
    for row in match_rows:
        d = row.get("match_date")
        if d and d > datetime.now(timezone.utc).date().isoformat():
            future += 1
        if d and d < "2000-01-01":
            pre_2000 += 1
        metrics = ("minutes", "goals", "assists", "yellow", "red")
        if all(row.get(k) is None or int(row.get(k) or 0) == 0 for k in metrics):
            match_quality["all_zero_or_null"] += 1
        if row.get("minutes") is None:
            match_quality["missing_minutes"] += 1

    rows = []
    summary = Counter()
    photo_sources = Counter()
    value_bands = {}
    for card in cards:
        cid = str(card["id"])
        photo = has_text(card.get("photo_url"))
        tm = has_text(card.get("transfermarkt_id"))
        qid = has_text(card.get("wikidata_qid"))
        season = cid in season_ids or (tm and str(card.get("transfermarkt_id")) in season_tm_ids)
        match = cid in match_ids
        stats_json = isinstance(card.get("career_stats"), dict) and bool(card["career_stats"])
        value = card.get("market_value_eur")
        band = ("unvalued" if value is None else
                "10m+" if int(value) >= 10_000_000 else
                "1m-10m" if int(value) >= 1_000_000 else
                "100k-1m" if int(value) >= 100_000 else "under-100k")
        bucket = value_bands.setdefault(band, Counter())
        bucket["players"] += 1
        bucket["missing_photo"] += int(not photo)
        bucket["missing_season_stats"] += int(not season)
        bucket["missing_match_stats"] += int(not match)
        summary["players"] += 1
        summary["with_photo"] += int(photo)
        summary["missing_photo"] += int(not photo)
        summary["with_transfermarkt_id"] += int(tm)
        summary["with_wikidata_qid"] += int(qid)
        summary["with_season_stats"] += int(season)
        summary["missing_season_stats"] += int(not season)
        summary["with_match_stats"] += int(match)
        summary["missing_match_stats"] += int(not match)
        summary["with_career_stats_json"] += int(stats_json)
        summary["missing_country"] += int(not has_text(card.get("country")))
        summary["missing_position"] += int(not has_text(card.get("position_ru")))
        summary["missing_birth_date"] += int(not card.get("born_on"))
        photo_sources[card.get("photo_source") or "(null)"] += int(photo)
        rows.append({
            "card_id": cid, "name": card.get("name"), "name_en": card.get("name_en"),
            "market_value_eur": value, "value_band": band, "photo_url_present": photo,
            "photo_source": card.get("photo_source") or "", "transfermarkt_id": card.get("transfermarkt_id") or "",
            "wikidata_qid": card.get("wikidata_qid") or "", "season_stats_present": season,
            "match_stats_present": match, "career_stats_json_present": stats_json,
            "missing_country": not has_text(card.get("country")),
            "missing_position": not has_text(card.get("position_ru")),
            "missing_birth_date": not bool(card.get("born_on")),
        })
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": dict(summary),
        "photo_sources": dict(photo_sources),
        "value_bands": {k: dict(v) for k, v in sorted(value_bands.items())},
        "season_rows": len(season_rows),
        "season_players": len({str(r.get("card_id")) for r in season_rows if r.get("card_id")}),
        "match_rows": len(match_rows),
        "match_players": len(match_ids),
        "match_quality": {**dict(match_quality), "future_dated": future, "pre_2000": pre_2000},
        "profiles": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default="artifacts/player-data-audit")
    parser.add_argument("--skip-match-scan", action="store_true",
                        help="skip the large player_match_stats scan")
    args = parser.parse_args()
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_KEY"):
        raise SystemExit("SUPABASE_URL and SUPABASE_KEY are required")

    cards = all_rows("cards", {
        "select": "id,name,name_en,category,active,photo_url,photo_source,transfermarkt_id,wikidata_qid,market_value_eur,career_stats,country,position_ru,born_on",
        "category": "eq.player", "active": "not.is.false", "order": "id"
    })
    season_rows = all_rows("player_season_stat", {
        "select": "card_id,tm_player_id,season_id,apps,starts,minutes,goals,assists",
        "order": "card_id"
    })
    match_rows = [] if args.skip_match_scan else all_rows("player_match_stats", {
        "select": "card_id,match_date,minutes,goals,assists,yellow,red",
        "order": "match_date"
    })
    report = audit_cards(cards, season_rows, match_rows)
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    json_path = output / f"player-data-audit-{stamp}.json"
    csv_path = output / f"player-data-profiles-{stamp}.csv"
    json_path.write_text(json.dumps({k: v for k, v in report.items() if k != "profiles"},
                                    ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        fields = list(report["profiles"][0]) if report["profiles"] else ["card_id"]
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(report["profiles"])
    print(json.dumps({
        "json_report": str(json_path), "profiles_csv": str(csv_path),
        "summary": report["summary"], "value_bands": report["value_bands"],
        "season_rows": report["season_rows"], "match_rows": report["match_rows"],
        "match_quality": report["match_quality"]
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
