#!/usr/bin/env python3
"""Backfill women's match statistics once, then refresh award candidates."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

from espn_stats import WOMEN_LEAGUES, collect

ROOT = Path(__file__).resolve().parents[1]
MIN_ROWS = 100
MIN_PLAYERS = 8
MIN_SPAN_DAYS = 180
PAGE_SIZE = 1000


def api_headers(key: str) -> dict[str, str]:
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def fetch_all(base: str, key: str, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    url = f"{base.rstrip('/')}/rest/v1/{table}"
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        response = requests.get(
            url,
            headers={**api_headers(key), "Range-Unit": "items"},
            params={**params, "limit": str(PAGE_SIZE), "offset": str(offset)},
            timeout=60,
        )
        response.raise_for_status()
        batch = response.json()
        if not isinstance(batch, list):
            raise RuntimeError(f"Unexpected {table} response")
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        offset += len(batch)


def needs_backfill(rows: list[dict[str, Any]], min_rows: int = MIN_ROWS,
                   min_players: int = MIN_PLAYERS, min_span_days: int = MIN_SPAN_DAYS) -> bool:
    valid = []
    players = set()
    for row in rows:
        try:
            valid.append(date.fromisoformat(str(row.get("match_date", ""))[:10]))
        except ValueError:
            continue
        if row.get("card_id"):
            players.add(str(row["card_id"]))
    if len(valid) < min_rows or len(players) < min_players:
        return True
    return (max(valid) - min(valid)).days < min_span_days


def read_women_stats(base: str, key: str, today: date) -> list[dict[str, Any]]:
    cards = fetch_all(base, key, "cards", {
        "select": "id", "active": "eq.true", "category": "eq.woman",
        "name_en": "not.is.null", "order": "id.asc",
    })
    ids = [str(card["id"]) for card in cards if card.get("id")]
    if not ids:
        raise RuntimeError("No active women's cards with English names")
    return fetch_all(base, key, "player_match_stats", {
        "select": "card_id,match_date,source",
        "card_id": "in.(" + ",".join(ids) + ")",
        "source": "eq.espn", "disputed": "eq.false",
        "match_date": f"gte.{(today - timedelta(days=365)).isoformat()}",
        "order": "match_date.asc",
    })


def verify_women_award_candidates(base: str, key: str, snapshot: date) -> dict[str, int]:
    counts = {}
    for award in ("ballon_dor_feminin", "the_best_female"):
        rows = fetch_all(base, key, "award_candidate_snapshot", {
            "select": "card_id", "award_key": f"eq.{award}",
            "snapshot_date": f"eq.{snapshot.isoformat()}",
            "model_version": "eq.candidate-rank-v2",
        })
        counts[award] = len(rows)
        if not rows:
            raise RuntimeError(f"No current candidate snapshot written for {award}")
    return counts


def main() -> int:
    load_dotenv()
    raw_base = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not raw_base or not key:
        print("SUPABASE_URL and SUPABASE_KEY are required", file=sys.stderr)
        return 2
    base = raw_base.lstrip("\\\\").rstrip("/")
    if not base.startswith(("https://", "http://")):
        print("SUPABASE_URL must be an absolute HTTP(S) URL", file=sys.stderr)
        return 2

    today = date.today()
    try:
        existing = read_women_stats(base, key, today)
        if not needs_backfill(existing):
            print(json.dumps({
                "status": "skipped", "reason": "women's match-stat coverage is sufficient",
                "rows": len(existing), "players": len({r.get("card_id") for r in existing}),
            }))
            return 0

        codes = ",".join(sorted(WOMEN_LEAGUES))
        print(json.dumps({
            "status": "backfill_started", "days": 365, "leagues": sorted(WOMEN_LEAGUES),
            "existing_rows": len(existing),
        }))
        result = collect(365, dry_run=False, only=codes)
        if result != 0:
            return result

        refreshed = read_women_stats(base, key, today)
        if needs_backfill(refreshed):
            raise RuntimeError(
                "Women's ESPN backfill finished but coverage remains below the "
                f"acceptance threshold: rows={len(refreshed)}, "
                f"players={len({r.get('card_id') for r in refreshed})}"
            )

        build = subprocess.run(
            [sys.executable, str(ROOT / "docs" / "award_candidates_build.py")],
            cwd=ROOT, check=False,
        )
        if build.returncode != 0:
            return build.returncode
        candidate_counts = verify_women_award_candidates(base, key, today)
        print(json.dumps({
            "status": "success", "rows": len(refreshed),
            "players": len({r.get("card_id") for r in refreshed}),
            "date_span_days": (max(date.fromisoformat(str(r["match_date"])[:10]) for r in refreshed)
                               - min(date.fromisoformat(str(r["match_date"])[:10]) for r in refreshed)).days,
            "candidate_rows": candidate_counts,
        }))
        return 0
    except (requests.RequestException, ValueError, KeyError, TypeError, RuntimeError) as error:
        print(f"women stats backfill failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
