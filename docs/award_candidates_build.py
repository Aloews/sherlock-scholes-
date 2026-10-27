#!/usr/bin/env python3
"""Rank personal football-award candidates from observed match statistics.

Scores are relative indices, not calibrated winner probabilities. The pipeline
stores daily evidence snapshots so later verified outcomes can be backtested.
"""
from __future__ import annotations

import json
import os
import re
import statistics
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests
from dotenv import load_dotenv

MODEL_VERSION = "personal-awards-index-v1"
PAGE_SIZE = 1000
WINDOW_DAYS = 365
AWARD_WEIGHTS = {
    "ballon_dor": {"goals": 0.30, "assists": 0.25, "minutes": 0.15, "appearances": 0.15, "g_per90": 0.15},
    "ballon_dor_feminin": {"goals": 0.30, "assists": 0.25, "minutes": 0.15, "appearances": 0.15, "g_per90": 0.15},
    "the_best": {"goals": 0.25, "assists": 0.25, "minutes": 0.20, "appearances": 0.15, "g_per90": 0.15},
    "the_best_female": {"goals": 0.25, "assists": 0.25, "minutes": 0.20, "appearances": 0.15, "g_per90": 0.15},
    "golden_boy": {"goals": 0.25, "assists": 0.25, "minutes": 0.15, "appearances": 0.15, "g_per90": 0.20},
    "golden_boot": {"goals": 0.55, "g_per90": 0.25, "minutes": 0.10, "appearances": 0.10},
}
AWARD_CATEGORIES = {
    "ballon_dor": "player",
    "ballon_dor_feminin": "woman",
    "the_best": "player",
    "the_best_female": "woman",
    "golden_boy": "player",
    "golden_boot": "player",
}


def parse_date(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value[:10]) if value else None
    except (TypeError, ValueError):
        return None


def safe_int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def percentile(values: dict[str, float]) -> dict[str, float]:
    if not values:
        return {}
    ordered = sorted(values.items(), key=lambda item: (item[1], item[0]))
    n = len(ordered)
    out: dict[str, float] = {}
    i = 0
    while i < n:
        j = i + 1
        while j < n and ordered[j][1] == ordered[i][1]:
            j += 1
        score = 50.0 if n == 1 else ((i + j - 1) / 2) / (n - 1) * 100
        for k in range(i, j):
            out[ordered[k][0]] = round(score, 2)
        i = j
    return out


def build_award_candidates(
    award_key: str,
    cards: list[dict],
    stats_by_card: dict[str, dict],
    snapshot_date: date,
    award_year: int,
) -> list[dict]:
    """Return up to 50 eligible candidates with transparent relative scores."""
    if award_key not in AWARD_WEIGHTS:
        raise ValueError("unsupported award key")
    eligible = []
    for card in cards:
        if card.get("category") != AWARD_CATEGORIES[award_key] or not card.get("active", True):
            continue
        card_id = str(card.get("id") or "")
        stat = stats_by_card.get(card_id)
        if not card_id or not stat or stat.get("appearances", 0) < (5 if award_key == "golden_boot" else 3):
            continue
        if award_key == "golden_boy":
            born = parse_date(card.get("born_on"))
            # Eligibility is under 21 at the end of the target award year.
            if not born or born < date(award_year - 20, 1, 1):
                continue
        row = {
            "card": card,
            "stats": stat,
            "id": card_id,
            "goals": float(stat.get("goals", 0)),
            "assists": float(stat.get("assists", 0)),
            "minutes": float(stat.get("minutes", 0)),
            "appearances": float(stat.get("appearances", 0)),
        }
        row["g_per90"] = row["goals"] * 90 / max(row["minutes"], 90)
        eligible.append(row)
    if not eligible:
        return []

    metric_percentiles = {}
    for metric in ("goals", "assists", "minutes", "appearances", "g_per90"):
        metric_percentiles[metric] = percentile({row["id"]: row[metric] for row in eligible})

    ranked = []
    for row in eligible:
        components = {metric: metric_percentiles[metric][row["id"]] for metric in AWARD_WEIGHTS[award_key]}
        score = sum(components[metric] * weight for metric, weight in AWARD_WEIGHTS[award_key].items())
        stat = row["stats"]
        last_match = parse_date(stat.get("last_match"))
        days_old = (snapshot_date - last_match).days if last_match else 9999
        coverage = min(1.0, row["minutes"] / 2700)
        if row["minutes"] >= 1800 and days_old <= 30:
            confidence = "high"
        elif row["minutes"] >= 600 and days_old <= 60:
            confidence = "medium"
        else:
            confidence = "low"
        born = parse_date(row["card"].get("born_on"))
        ranked.append({
            "card_id": row["id"],
            "candidate_score": round(max(0.0, min(100.0, score)), 2),
            "confidence": confidence,
            "data_coverage": round(coverage, 4),
            "score_components": components,
            "evidence": {
                "goals": int(row["goals"]),
                "assists": int(row["assists"]),
                "minutes": int(row["minutes"]),
                "appearances": int(row["appearances"]),
                "goal_contributions_per_90": round((row["goals"] + row["assists"]) * 90 / max(row["minutes"], 90), 3),
                "goals_per_90": round(row["g_per90"], 3),
                "last_match": stat.get("last_match"),
                "days_since_last_match": days_old if last_match else None,
                "age_on_snapshot": (snapshot_date.year - born.year - ((snapshot_date.month, snapshot_date.day) < (born.month, born.day))) if born else None,
                "competitions_observed": stat.get("competitions", []),
                "source_rows": stat.get("source_rows", 0),
                "limitations": [
                    "relative ranking, not calibrated probability",
                    "no official shortlist or voting data",
                    "defensive actions and goalkeeper-specific metrics are not available in this feature set",
                ],
            },
            "source_fetched_at": stat.get("source_fetched_at"),
            "_name": str(row["card"].get("name") or row["id"]),
        })
    ranked.sort(key=lambda row: (-row["candidate_score"], row["_name"].casefold()))
    output = []
    for rank, row in enumerate(ranked[:50], start=1):
        row.pop("_name", None)
        row["candidate_rank"] = rank
        output.append(row)
    return output


def get_rows(session: requests.Session, endpoint: str, params: dict[str, Any]) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        query = dict(params)
        query["limit"] = PAGE_SIZE
        query["offset"] = offset
        response = session.get(endpoint, params=query, timeout=60)
        response.raise_for_status()
        batch = response.json()
        if not isinstance(batch, list):
            raise RuntimeError(f"Expected list from {endpoint}")
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        offset += len(batch)


def aggregate_stats(rows: list[dict]) -> dict[str, dict]:
    # One player/team/opponent/date should contribute once; keep the freshest
    # source row if the same match was imported more than once.
    dedup: dict[tuple[str, str, str, str], dict] = {}
    for row in rows:
        card_id = str(row.get("card_id") or "")
        match_date = str(row.get("match_date") or "")
        if not card_id or not match_date:
            continue
        key = (card_id, match_date, str(row.get("home_team") or ""), str(row.get("away_team") or ""))
        previous = dedup.get(key)
        if previous is None or str(row.get("fetched_at") or "") > str(previous.get("fetched_at") or ""):
            dedup[key] = row
    stats: dict[str, dict] = defaultdict(lambda: {
        "goals": 0, "assists": 0, "minutes": 0, "appearances": 0,
        "last_match": None, "source_fetched_at": None, "competitions": set(), "source_rows": 0,
    })
    for row in dedup.values():
        card_id = str(row["card_id"])
        item = stats[card_id]
        item["goals"] += safe_int(row.get("goals"))
        item["assists"] += safe_int(row.get("assists"))
        item["minutes"] += safe_int(row.get("minutes"))
        if safe_int(row.get("minutes")) > 0:
            item["appearances"] += 1
        item["last_match"] = max(filter(None, [item["last_match"], row.get("match_date")]), default=row.get("match_date"))
        item["source_fetched_at"] = max(filter(None, [item["source_fetched_at"], row.get("fetched_at")]), default=row.get("fetched_at"))
        if row.get("tournament"):
            item["competitions"].add(str(row["tournament"]))
        item["source_rows"] += 1
    for item in stats.values():
        item["competitions"] = sorted(item["competitions"])[:12]
    return dict(stats)


def upsert_rows(session: requests.Session, endpoint: str, rows: list[dict]) -> None:
    if not rows:
        return
    url = endpoint + "?on_conflict=award_key,season_id,snapshot_date,card_id"
    headers = dict(session.headers)
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    for start in range(0, len(rows), 500):
        response = session.post(url, headers=headers, json=rows[start:start + 500], timeout=60)
        response.raise_for_status()


def run() -> int:
    load_dotenv()
    base_url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    key = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not base_url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required")
    session = requests.Session()
    session.headers.update({
        "Accept": "application/json",
        "Content-Type": "application/json",
        "apikey": key,
        "Authorization": "Bearer " + key,
    })
    rest = base_url + "/rest/v1"
    today = date.today()
    year = today.year + 1  # Forecast the next award cycle, not the ceremony that has already passed.
    from_date = today - timedelta(days=WINDOW_DAYS)
    cards = get_rows(session, rest + "/cards", {
        "select": "id,name,category,active,born_on",
        "category": "in.(player,woman)",
        "active": "eq.true",
        "order": "id.asc",
    })
    match_rows = get_rows(session, rest + "/player_match_stats", {
        "select": "card_id,match_date,tournament,home_team,away_team,minutes,goals,assists,fetched_at",
        "match_date": "gte." + from_date.isoformat(),
        "disputed": "eq.false",
        "order": "match_date.asc",
    })
    stats_by_card = aggregate_stats(match_rows)
    snapshots = []
    counts = {}
    for award_key in AWARD_WEIGHTS:
        ranked = build_award_candidates(award_key, cards, stats_by_card, today, year)
        counts[award_key] = len(ranked)
        for row in ranked:
            snapshots.append({
                "award_key": award_key,
                "season_id": year,
                "snapshot_date": today.isoformat(),
                "card_id": row["card_id"],
                "candidate_score": row["candidate_score"],
                "candidate_rank": row["candidate_rank"],
                "confidence": row["confidence"],
                "data_coverage": row["data_coverage"],
                "score_components": row["score_components"],
                "evidence": row["evidence"],
                "source_fetched_at": row["source_fetched_at"],
                "model_version": MODEL_VERSION,
            })
    upsert_rows(session, rest + "/award_candidate_snapshot", snapshots)
    print(json.dumps({
        "snapshot_date": today.isoformat(),
        "target_award_year": year,
        "cards_loaded": len(cards),
        "match_rows_loaded": len(match_rows),
        "players_with_stats": len(stats_by_card),
        "candidate_counts": counts,
        "candidate_rows_upserted": len(snapshots),
        "model_version": MODEL_VERSION,
        "interpretation": "relative candidate indices, not calibrated probabilities",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(run())
    except Exception as exc:
        print("personal award candidate refresh failed: " + str(exc), file=sys.stderr)
        raise
