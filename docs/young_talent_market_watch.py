#!/usr/bin/env python3
"""Snapshot young-player market value and verified honours for daily scouting.

Only source-dated, recent Transfermarkt values are eligible. A missing price or
birth date is not guessed. The SQL view computes price movement between snapshots.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from datetime import date, datetime, timezone
from typing import Any

import requests
from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRAPER = os.path.join(ROOT, "football_scraper")
PAGE_SIZE = 1000
MODEL_VERSION = "young-talent-market-v1"
INVALID_HONOUR = re.compile(r"\{\{|\}\}|\|url\s*=|https?://", re.I)
NON_WIN = re.compile(r"финалист|вице-чемпион|серебряный приз[её]р|бронзовый приз[её]р|участник|номинант|runner.?up|finalist|participant|nominee", re.I)


def api_headers(key: str) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    }


def fetch_all_cards(base: str, key: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        response = requests.get(
            base.rstrip("/") + "/rest/v1/cards",
            headers={**api_headers(key), "Range-Unit": "items"},
            params={
                "select": "id,name,category,active,born_on,market_value_eur,market_value_at,transfermarkt_id,facts",
                "category": "in.(player,woman)",
                "active": "eq.true",
                "born_on": "not.is.null",
                "market_value_eur": "not.is.null",
                "market_value_at": "not.is.null",
                "order": "id.asc",
                "limit": PAGE_SIZE,
                "offset": offset,
            },
            timeout=45,
        )
        response.raise_for_status()
        batch = response.json()
        if not isinstance(batch, list):
            raise RuntimeError("Unexpected cards response while building youth market watch")
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        offset += len(batch)


def verified_honour_totals(facts: Any) -> tuple[int, int]:
    """Return (distinct honour records, actual wins), excluding malformed/non-win claims."""
    honours = facts.get("honours") if isinstance(facts, dict) else None
    if not isinstance(honours, list):
        return 0, 0
    count_records = 0
    total_wins = 0
    seen: set[tuple[str, str]] = set()
    for honour in honours:
        if not isinstance(honour, dict):
            continue
        title = str(honour.get("title") or "").strip()
        if len(title) < 3 or INVALID_HONOUR.search(title):
            continue
        if title.casefold().strip(" «»„“”\".,:;!?") in {"награда", "награды"}:
            continue
        try:
            wins = max(1, int(honour.get("count") or 1))
        except (TypeError, ValueError):
            continue
        identity = (title.casefold(), str(honour.get("kind") or ""))
        if identity in seen:
            continue
        seen.add(identity)
        count_records += 1
        if not NON_WIN.search(title):
            total_wins += wins
    return count_records, total_wins


def player_age(born_on: str | None, today: date) -> int | None:
    try:
        born = date.fromisoformat(str(born_on)[:10])
    except (TypeError, ValueError):
        return None
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def aggregate_season_stats(rows: list[dict], snapshot_date: date, max_age_days: int = 14) -> dict[str, dict]:
    """Aggregate fresh current-season Transfermarkt rows by player card."""
    totals: dict[str, dict] = {}
    for row in rows:
        card_id = str(row.get("card_id") or "")
        if not card_id:
            continue
        try:
            fetched = datetime.fromisoformat(str(row.get("fetched_at") or "").replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - fetched.astimezone(timezone.utc)).days > max_age_days:
                continue
        except (TypeError, ValueError):
            continue
        item = totals.setdefault(card_id, {
            "apps": 0, "goals": 0, "assists": 0, "minutes": 0, "fetched_at": None,
        })
        for field in ("apps", "goals", "assists", "minutes"):
            try:
                item[field] += max(0, int(row.get(field) or 0))
            except (TypeError, ValueError):
                pass
        if item["fetched_at"] is None or str(row["fetched_at"]) > item["fetched_at"]:
            item["fetched_at"] = str(row["fetched_at"])
    return totals


def fetch_current_season_stats(base: str, key: str, season_id: int) -> dict[str, dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        response = requests.get(
            base.rstrip("/") + "/rest/v1/player_season_stat",
            headers={**api_headers(key), "Range-Unit": "items"},
            params={
                "select": "card_id,apps,goals,assists,minutes,fetched_at",
                "season_id": f"eq.{season_id}",
                "order": "card_id.asc,competition_id.asc",
                "limit": PAGE_SIZE,
                "offset": offset,
            },
            timeout=45,
        )
        response.raise_for_status()
        batch = response.json()
        if not isinstance(batch, list):
            raise RuntimeError("Unexpected current-season statistics response")
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return aggregate_season_stats(rows, date.today())


def base_talent_score(
    age: int, value_eur: int, honour_wins: int,
    season_apps: int = 0, season_goals: int = 0, season_assists: int = 0, season_minutes: int = 0,
) -> tuple[float, dict[str, float]]:
    """Explainable 0–100 score from age, price, verified honours and fresh season output."""
    age_score = 20.0 * max(0.0, min(1.0, (24 - age) / 8))
    value_score = 30.0 * max(0.0, min(1.0, math.log1p(value_eur / 1_000_000) / math.log1p(200)))
    award_score = 30.0 * max(0.0, min(1.0, math.log1p(honour_wins) / math.log1p(20)))
    production = max(0.0, season_goals) + 0.7 * max(0.0, season_assists)
    output_score = 12.0 * max(0.0, min(1.0, production / 25))
    minutes_score = 8.0 * max(0.0, min(1.0, max(0, season_minutes) / 1800))
    components = {
        "age": round(age_score, 3),
        "market_value": round(value_score, 3),
        "verified_award_wins": round(award_score, 3),
        "current_season_output": round(output_score, 3),
        "current_season_minutes": round(minutes_score, 3),
    }
    return round(sum(components.values()), 3), components


def build_snapshots(cards: list[dict], snapshot_date: date, season_stats: dict[str, dict] | None = None) -> list[dict]:
    season_stats = season_stats or {}
    rows = []
    for card in cards:
        age = player_age(card.get("born_on"), snapshot_date)
        if age is None or not 16 <= age <= 23:
            continue
        try:
            value = int(card.get("market_value_eur") or 0)
            value_date = date.fromisoformat(str(card.get("market_value_at") or "")[:10])
        except (TypeError, ValueError):
            continue
        # Do not turn an undated/stale value into a current market signal.
        if value <= 0 or not 0 <= (snapshot_date - value_date).days <= 180:
            continue
        facts = card.get("facts") if isinstance(card.get("facts"), dict) else {}
        honour_count, honour_wins = verified_honour_totals(facts)
        stats = season_stats.get(str(card["id"]), {})
        season_apps = int(stats.get("apps") or 0)
        season_goals = int(stats.get("goals") or 0)
        season_assists = int(stats.get("assists") or 0)
        season_minutes = int(stats.get("minutes") or 0)
        base_score, components = base_talent_score(
            age, value, honour_wins, season_apps, season_goals, season_assists, season_minutes
        )
        components["current_season_apps"] = season_apps
        components["current_season_goals"] = season_goals
        components["current_season_assists"] = season_assists
        tm_id = str(card.get("transfermarkt_id") or "").strip()
        source_url = f"https://www.transfermarkt.com/spieler/profil/spieler/{tm_id}" if tm_id else None
        rows.append({
            "snapshot_date": snapshot_date.isoformat(),
            "card_id": card["id"],
            "player_name": str(card.get("name") or ""),
            "age": age,
            "market_value_eur": value,
            "market_value_at": value_date.isoformat(),
            "verified_honours_count": honour_count,
            "verified_award_wins": honour_wins,
            "season_apps": season_apps,
            "season_goals": season_goals,
            "season_assists": season_assists,
            "season_minutes": season_minutes,
            "season_stats_fetched_at": stats.get("fetched_at"),
            "base_score": base_score,
            "score_components": components,
            "source_url": source_url,
            "model_version": MODEL_VERSION,
            "source_fetched_at": datetime.now(timezone.utc).isoformat(),
        })
    return rows


def upsert_snapshots(base: str, key: str, rows: list[dict]) -> int:
    url = base.rstrip("/") + "/rest/v1/young_talent_market_snapshot"
    headers = {**api_headers(key), "Prefer": "resolution=merge-duplicates,return=minimal"}
    for start in range(0, len(rows), 250):
        response = requests.post(
            url,
            params={"on_conflict": "snapshot_date,card_id"},
            headers=headers,
            json=rows[start:start + 250],
            timeout=45,
        )
        response.raise_for_status()
    return len(rows)


def fetch_ranked_today(base: str, key: str, snapshot_date: date, limit: int = 20) -> list[dict]:
    response = requests.get(
        base.rstrip("/") + "/rest/v1/young_talent_market_watch",
        headers=api_headers(key),
        params={
            "select": "snapshot_date,card_id,player_name,age,market_value_eur,verified_honours_count,verified_award_wins,season_apps,season_goals,season_assists,season_minutes,price_change_pct,score,confidence,score_components,source_url",
            "snapshot_date": f"eq.{snapshot_date.isoformat()}",
            "order": "score.desc,verified_award_wins.desc,market_value_eur.desc",
            "limit": limit,
        },
        timeout=45,
    )
    response.raise_for_status()
    data = response.json()
    return data if isinstance(data, list) else []


def main() -> None:
    load_dotenv(os.path.join(SCRAPER, ".env"))
    base = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not (base and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set")
    snapshot_date = date.today()
    cards = fetch_all_cards(base, key)
    season_stats = fetch_current_season_stats(base, key, snapshot_date.year)
    rows = build_snapshots(cards, snapshot_date, season_stats)
    written = upsert_snapshots(base, key, rows)
    ranked = fetch_ranked_today(base, key, snapshot_date)
    print(f"Young talent market watch: {snapshot_date.isoformat()}")
    print(f"eligible active players age 16–23 with recent source-dated value: {len(rows)}")
    print(f"daily snapshots upserted: {written}")
    print("Top candidates by value, award wins and market momentum:")
    for row in ranked:
        print(
            f"{row['score']:5.1f} | age {row['age']:2} | €{int(row['market_value_eur']):,} | "
            f"awards {row['verified_award_wins']:3} | G/A {row.get('season_goals') or 0}/{row.get('season_assists') or 0} | "
            f"Δ {row.get('price_change_pct') or 0:+.1f}% | {row['player_name']} | "
            f"{row.get('source_url') or 'no Transfermarkt profile URL'}"
        )


if __name__ == "__main__":
    main()
