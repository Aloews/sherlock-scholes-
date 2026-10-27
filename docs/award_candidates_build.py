#!/usr/bin/env python3
"""Build explainable, dated candidate rankings for individual awards and team tournaments.

Scores are relative ranking indices, not probabilities. The pipeline writes snapshots
only; verified winners live separately in award_outcome / team_tournament_outcome.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

import requests
from dotenv import load_dotenv

MODEL_VERSION = "candidate-rank-v1"
PAGE_SIZE = 1000
TIMEOUT = 45


def api_headers(key: str) -> dict[str, str]:
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def get_rows(base: str, key: str, table: str, params: dict[str, str], page_size: int = PAGE_SIZE) -> list[dict]:
    url = f"{base.rstrip('/')}/rest/v1/{table}"
    rows: list[dict] = []
    offset = 0
    while True:
        response = requests.get(url, headers={**api_headers(key), "Range-Unit": "items"},
                                params={**params, "limit": page_size, "offset": offset}, timeout=TIMEOUT)
        response.raise_for_status()
        batch = response.json()
        if not isinstance(batch, list):
            raise RuntimeError(f"Unexpected {table} response")
        rows.extend(batch)
        if len(batch) < page_size:
            return rows
        offset += len(batch)


def upsert_rows(base: str, key: str, table: str, rows: list[dict], conflict: str) -> int:
    if not rows:
        return 0
    url = f"{base.rstrip('/')}/rest/v1/{table}"
    headers = {**api_headers(key), "Prefer": "resolution=merge-duplicates,return=minimal"}
    for start in range(0, len(rows), 250):
        response = requests.post(url, params={"on_conflict": conflict}, headers=headers,
                                 json=rows[start:start + 250], timeout=TIMEOUT)
        response.raise_for_status()
    return len(rows)


def number(row: dict, key: str) -> float:
    try:
        value = float(row.get(key) or 0)
        return value if math.isfinite(value) else 0.0
    except (TypeError, ValueError):
        return 0.0


def percentile(values: list[float]) -> list[float]:
    """Deterministic mid-rank percentile in [0,100], handling ties and singleton lists."""
    if not values:
        return []
    ordered = sorted(values)
    n = len(ordered)
    if n == 1:
        return [50.0]
    result = []
    for value in values:
        first = next(i for i, item in enumerate(ordered) if item == value)
        last = n - 1 - next(i for i, item in enumerate(reversed(ordered)) if item == value)
        result.append(100.0 * ((first + last) / 2) / (n - 1))
    return result


def normal_key(value: str) -> str:
    return re.sub(r"[^\w]+", "-", value.lower(), flags=re.UNICODE).strip("-_") or "unknown"


def score_population(population: list[dict], weights: dict[str, float], award_key: str,
                     season: int, snapshot: date, competition_id: str = "*") -> list[dict]:
    eligible = [p for p in population if p.get("active") and (
        p["category"] == "player" if award_key in {"ballon_dor", "the_best", "golden_boy", "golden_boot"}
        else p["category"] == "woman"
    )]
    if award_key == "golden_boy":
        eligible = [p for p in eligible if p.get("age") is not None and p["age"] < 21]
    if not eligible:
        return []

    percentiles: dict[str, dict[str, float]] = {}
    for metric in weights:
        measured = [p for p in eligible if metric != "sw_rating" or p.get("sw_rating") is not None]
        ranks = percentile([number(p, metric) for p in measured])
        percentiles[metric] = {p["card_id"]: 50.0 for p in eligible}
        percentiles[metric].update({p["card_id"]: rank for p, rank in zip(measured, ranks)})

    scored = []
    for p in eligible:
        components = {metric: round(percentiles[metric][p["card_id"]], 2) for metric in weights}
        score = sum(components[m] * weight for m, weight in weights.items())
        coverage = min(1.0, max(p["apps"] / 25.0, p["minutes"] / 2250.0))
        confidence = "high" if p["apps"] >= 18 and p["minutes"] >= 1200 else (
            "medium" if p["apps"] >= 8 and p["minutes"] >= 450 else "low")
        target_year = season if award_key == "golden_boot" else season + 1
        evidence = {
            "name": p["name"], "target_award_year": target_year, "source_season_id": season,
            "competition_id": competition_id, "ranking_scope": (
                f"tracked competition {competition_id}" if award_key == "golden_boot"
                else "all tracked competitions in selected season"),
            "age": p.get("age"), "apps": p["apps"], "starts": p["starts"], "minutes": p["minutes"],
            "goals": p["goals"], "assists": p["assists"],
            "goal_involvements": p["goals"] + p["assists"],
            "sw_rating": p.get("sw_rating"), "market_value_eur": p.get("market_value_eur"),
            "coverage_basis": "player apps/minutes exposure proxy, not source-feed completeness",
            "source_stats_rows": p["stats_rows"],
            "score_is_probability": False,
        }
        scored.append({
            "card_id": p["card_id"], "score": score, "components": components,
            "coverage": coverage, "confidence": confidence, "evidence": evidence,
            "last_fetched": p.get("last_fetched"),
        })
    scored.sort(key=lambda item: (-item["score"], -item["coverage"], item["card_id"]))
    rows = []
    for rank, item in enumerate(scored[:50], 1):
        rows.append({
            "award_key": award_key, "season_id": season, "snapshot_date": snapshot.isoformat(),
            "card_id": item["card_id"], "competition_id": competition_id,
            "candidate_score": round(max(0, min(100, item["score"])), 4),
            "candidate_rank": rank, "confidence": item["confidence"],
            "data_coverage": round(item["coverage"], 4), "score_components": item["components"],
            "evidence": item["evidence"], "source_fetched_at": item["last_fetched"],
            "model_version": MODEL_VERSION,
        })
    return rows


def build_award_candidates(base: str, key: str, snapshot: date) -> tuple[int, int]:
    response = requests.get(f"{base.rstrip('/')}/rest/v1/player_season_stat",
                            headers=api_headers(key),
                            params={"select": "season_id", "order": "season_id.desc", "limit": "1"},
                            timeout=TIMEOUT)
    response.raise_for_status()
    newest = response.json()
    if not newest:
        raise RuntimeError("player_season_stat is empty; refusing empty candidate snapshots")
    season = int(newest[0]["season_id"])
    stats = get_rows(base, key, "player_season_stat", {
        "select": "card_id,season_id,competition_id,apps,starts,minutes,goals,assists,team_goals,opponent_goals,fetched_at",
        "season_id": f"eq.{season}", "card_id": "not.is.null", "order": "card_id.asc",
    })
    if not stats:
        raise RuntimeError(f"No player-season statistics found for season_id={season}")

    totals: dict[str, dict[str, Any]] = {}
    by_competition: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in stats:
        card_id = row.get("card_id")
        if not card_id:
            continue
        competition = str(row.get("competition_id") or "").strip()
        keys = [(totals, card_id)]
        if competition:
            keys.append((by_competition[competition], card_id))
        for target, target_key in keys:
            item = target.setdefault(target_key, {
                "card_id": card_id, "apps": 0, "starts": 0, "minutes": 0, "goals": 0, "assists": 0,
                "last_fetched": None, "stats_rows": 0,
            })
            item["stats_rows"] += 1
            for field in ("apps", "starts", "minutes", "goals", "assists"):
                item[field] += int(number(row, field))
            fetched = row.get("fetched_at")
            if fetched and (item["last_fetched"] is None or fetched > item["last_fetched"]):
                item["last_fetched"] = fetched

    ids = list(totals)
    cards: dict[str, dict] = {}
    card_url = f"{base.rstrip('/')}/rest/v1/cards"
    for start in range(0, len(ids), 100):
        joined = ",".join(ids[start:start + 100])
        r = requests.get(card_url, headers=api_headers(key), params={
            "select": "id,name,category,born_on,sw_rating,market_value_eur,position_ru,active",
            "id": f"in.({joined})",
        }, timeout=TIMEOUT)
        r.raise_for_status()
        for card in r.json():
            cards[card["id"]] = card

    def population_from(source: dict[str, dict]) -> list[dict]:
        population = []
        for card_id, stat in source.items():
            card = cards.get(card_id)
            if not card or not card.get("active"):
                continue
            row = {**stat, **card}
            for field in ("apps", "starts", "minutes", "goals", "assists"):
                row[field] = max(0, stat[field])
            row["age"] = None
            born = card.get("born_on")
            if born:
                try:
                    born_date = date.fromisoformat(born[:10])
                    row["age"] = season - born_date.year - (
                        (born_date.month, born_date.day) > (snapshot.month, snapshot.day))
                except ValueError:
                    pass
            population.append(row)
        return population

    population = population_from(totals)
    if not population:
        raise RuntimeError("No active cards matched current season statistics; refusing empty snapshots")

    overall_specs = {
        "ballon_dor": {"goals": .33, "assists": .20, "minutes": .20, "apps": .13, "sw_rating": .14},
        "the_best": {"goals": .33, "assists": .20, "minutes": .20, "apps": .13, "sw_rating": .14},
        "ballon_dor_feminin": {"goals": .33, "assists": .20, "minutes": .20, "apps": .13, "sw_rating": .14},
        "the_best_female": {"goals": .33, "assists": .20, "minutes": .20, "apps": .13, "sw_rating": .14},
        "golden_boy": {"goals": .34, "assists": .22, "minutes": .18, "apps": .12, "sw_rating": .14},
    }
    payloads = []
    for award_key, weights in overall_specs.items():
        payloads.extend(score_population(population, weights, award_key, season, snapshot))
    boot_weights = {"goals": .72, "minutes": .10, "apps": .08, "assists": .10}
    for competition, source in by_competition.items():
        comp_population = population_from(source)
        payloads.extend(score_population(comp_population, boot_weights, "golden_boot", season, snapshot, competition))
    written = upsert_rows(base, key, "award_candidate_snapshot", payloads,
                          "award_key,season_id,snapshot_date,card_id,competition_id")
    return season, written


def build_team_candidates(base: str, key: str, snapshot: date) -> int:
    cutoff = (snapshot - timedelta(days=365)).isoformat()
    fixtures = get_rows(base, key, "fixtures", {
        "select": "sport_key,commence_at,home_team,away_team,home_score,away_score,completed,updated_at",
        "completed": "eq.true", "home_score": "not.is.null", "away_score": "not.is.null",
        "commence_at": f"gte.{cutoff}T00:00:00Z", "order": "commence_at.asc",
    })
    if not fixtures:
        raise RuntimeError("No completed, scored fixtures in the last 365 days; refusing empty team snapshots")
    competitions: dict[str, list[dict]] = defaultdict(list)
    for fixture in fixtures:
        tournament = str(fixture.get("sport_key") or "").strip()
        home, away = str(fixture.get("home_team") or "").strip(), str(fixture.get("away_team") or "").strip()
        if tournament and home and away and home != away:
            competitions[tournament].append(fixture)

    payloads = []
    for tournament, matches in competitions.items():
        by_team: dict[str, dict] = {}
        first_date, last_updated = None, None
        for match in matches:
            day = str(match["commence_at"])[:10]
            first_date = min(first_date, day) if first_date else day
            if match.get("updated_at"):
                last_updated = max(last_updated, match["updated_at"]) if last_updated else match["updated_at"]
            home, away = match["home_team"], match["away_team"]
            hs, aws = int(match["home_score"]), int(match["away_score"])
            for name in (home, away):
                by_team.setdefault(name, {"played": 0, "points": 0, "wins": 0, "draws": 0, "losses": 0,
                                          "gf": 0, "ga": 0, "recent": []})
            h, a = by_team[home], by_team[away]
            h["played"] += 1; a["played"] += 1
            h["gf"] += hs; h["ga"] += aws; a["gf"] += aws; a["ga"] += hs
            if hs > aws:
                h["wins"] += 1; h["points"] += 3; a["losses"] += 1
                h["recent"].append(1); a["recent"].append(0)
            elif hs < aws:
                a["wins"] += 1; a["points"] += 3; h["losses"] += 1
                h["recent"].append(0); a["recent"].append(1)
            else:
                h["draws"] += 1; a["draws"] += 1; h["points"] += 1; a["points"] += 1
                h["recent"].append(.5); a["recent"].append(.5)

        if len(by_team) < 2:
            continue
        max_played = max(item["played"] for item in by_team.values())
        raw = {}
        for name, item in by_team.items():
            ppg = item["points"] / (3 * item["played"]) if item["played"] else 0
            gdpg = (item["gf"] - item["ga"]) / item["played"] if item["played"] else 0
            win_rate = item["wins"] / item["played"] if item["played"] else 0
            recent = item["recent"][-5:]
            form = sum(recent) / len(recent) if recent else 0
            raw[name] = .45 * ppg + .25 * max(-1, min(1, gdpg / 2)) + .20 * win_rate + .10 * form
        low, high = min(raw.values()), max(raw.values())
        season_start = first_date or snapshot.isoformat()
        for rank, name in enumerate(sorted(by_team, key=lambda team: (-raw[team], team))[:100], 1):
            item = by_team[name]
            coverage = min(1.0, item["played"] / max(1, max_played))
            confidence = "high" if item["played"] >= 12 and coverage >= .7 else (
                "medium" if item["played"] >= 6 and coverage >= .4 else "low")
            score = 50.0 if high == low else 100.0 * (raw[name] - low) / (high - low)
            recent = item["recent"][-5:]
            payloads.append({
                "tournament": tournament, "season_start": season_start, "snapshot_date": snapshot.isoformat(),
                "team_key": normal_key(name), "team_name": name,
                "candidate_score": round(max(0, min(100, score)), 4), "candidate_rank": rank,
                "confidence": confidence, "data_coverage": round(coverage, 4),
                "score_components": {"relative_form_index": round(raw[name], 6)},
                "evidence": {
                    "matches_played": item["played"], "max_matches_in_tournament_sample": max_played,
                    "wins": item["wins"], "draws": item["draws"], "losses": item["losses"],
                    "goals_for": item["gf"], "goals_against": item["ga"],
                    "points_per_game": round(item["points"] / item["played"], 4),
                    "goal_difference_per_game": round((item["gf"] - item["ga"]) / item["played"], 4),
                    "recent_form_last_5": round(sum(recent) / len(recent), 4) if recent else None,
                    "score_is_probability": False,
                    "limitation": "Uses completed fixtures in the last 365 days. Knockout brackets, remaining schedule, injuries and squad availability are not fully modeled.",
                },
                "source_fetched_at": last_updated, "model_version": MODEL_VERSION,
            })
    return upsert_rows(base, key, "team_tournament_candidate_snapshot", payloads,
                       "tournament,season_start,snapshot_date,team_key")


def main() -> int:
    load_dotenv()
    base, key = os.environ.get("SUPABASE_URL", "").strip(), os.environ.get("SUPABASE_KEY", "").strip()
    if not base or not key:
        print("SUPABASE_URL and SUPABASE_KEY are required", file=sys.stderr)
        return 2
    snapshot = date.today()
    try:
        season, award_writes = build_award_candidates(base, key, snapshot)
        team_writes = build_team_candidates(base, key, snapshot)
    except (requests.RequestException, ValueError, KeyError, TypeError, RuntimeError) as error:
        print(f"candidate build failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({
        "snapshot_date": snapshot.isoformat(), "season_id": season,
        "award_candidate_rows_upserted": award_writes,
        "team_tournament_candidate_rows_upserted": team_writes,
        "model_version": MODEL_VERSION,
        "interpretation": "candidate scores are relative ranking indices, not probabilities",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
