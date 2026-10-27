#!/usr/bin/env python3
"""Create daily, evidence-backed contender rankings for active team tournaments.

The output is a relative candidate index (0-100), NOT a calibrated probability.
Only competitions with recent, observed match evidence are ranked. A future
iteration may add bracket/fixture simulations after reliable schedule coverage
and retrospective calibration are available.
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

MODEL_VERSION = "team-tournament-index-v1"
WINDOW_DAYS = 450
ACTIVE_DAYS = 45
MIN_MATCHES = 6
MIN_TEAMS = 4
PAGE_SIZE = 1000
BASE_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
}
CUP_RE = re.compile(
    r"\b(cup|copa|pokal|coupe|kubok|кубок|суперкубок|champions league|"
    r"europa league|libertadores|champions cup|club world cup|клубный чемпионат мира)\b",
    re.I,
)
INTERNATIONAL_EVENT_RE = re.compile(
    r"(world cup|чемпионат мира|euro(?:pean championship)?|евро\b|"
    r"copa america|кубок африки|asian cup|кубок азии|olympic|олимп)",
    re.I,
)


def as_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except (TypeError, ValueError):
        return None


def percentile(values: dict[str, float]) -> dict[str, float]:
    """Midrank percentile in [0, 100], stable when values tie."""
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


def football_season_start(latest: date, tournament: str) -> date:
    if INTERNATIONAL_EVENT_RE.search(tournament):
        return date(latest.year, 1, 1)
    year = latest.year if latest.month >= 7 else latest.year - 1
    return date(year, 7, 1)


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
            raise RuntimeError(f"Expected list from {endpoint}, got {type(batch).__name__}")
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        offset += len(batch)


def upsert_rows(session: requests.Session, endpoint: str, rows: list[dict]) -> None:
    if not rows:
        return
    url = endpoint + "?on_conflict=tournament,season_start,snapshot_date,team_key"
    headers = dict(session.headers)
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    for start in range(0, len(rows), 500):
        response = session.post(url, headers=headers, json=rows[start:start + 500], timeout=60)
        response.raise_for_status()


def score_tournament(
    tournament: str,
    season_start: date,
    matches: list[dict],
    ratings: dict[str, dict],
    snapshot_date: date,
) -> list[dict]:
    team = defaultdict(lambda: {
        "matches": 0, "wins": 0, "draws": 0, "losses": 0,
        "points": 0, "gf": 0, "ga": 0, "form": [], "name": None,
        "last_match": None, "last_fetched": None,
    })
    tournament_matches = [
        m for m in matches
        if m.get("tournament") == tournament
        and (as_date(m.get("match_date")) or date.min) >= season_start
        and as_date(m.get("match_date")) <= snapshot_date
        and m.get("home_key") and m.get("away_key")
        and m.get("home_score") is not None and m.get("away_score") is not None
    ]
    tournament_matches.sort(key=lambda m: (m.get("match_date") or "", m.get("fetched_at") or ""))
    for m in tournament_matches:
        home, away = str(m["home_key"]), str(m["away_key"])
        hs, aws = int(m["home_score"]), int(m["away_score"])
        match_date = m.get("match_date")
        for key, name, gf, ga in (
            (home, m.get("home_team"), hs, aws),
            (away, m.get("away_team"), aws, hs),
        ):
            row = team[key]
            row["matches"] += 1
            row["gf"] += gf
            row["ga"] += ga
            row["name"] = name or row["name"] or key
            row["last_match"] = max(filter(None, [row["last_match"], match_date]), default=match_date)
            if m.get("fetched_at"):
                row["last_fetched"] = max(filter(None, [row["last_fetched"], m["fetched_at"]]), default=m["fetched_at"])
        if hs > aws:
            team[home]["wins"] += 1
            team[home]["points"] += 3
            team[away]["losses"] += 1
            home_result, away_result = 3, 0
        elif hs < aws:
            team[away]["wins"] += 1
            team[away]["points"] += 3
            team[home]["losses"] += 1
            home_result, away_result = 0, 3
        else:
            team[home]["draws"] += 1
            team[away]["draws"] += 1
            team[home]["points"] += 1
            team[away]["points"] += 1
            home_result = away_result = 1
        team[home]["form"].append((match_date or "", home_result))
        team[away]["form"].append((match_date or "", away_result))

    if len(team) < MIN_TEAMS or len(tournament_matches) < MIN_MATCHES:
        return []

    elo_raw = {key: float((ratings.get(key) or {}).get("elo") or 1500) for key in team}
    elo_pct = percentile(elo_raw)
    ppg = {key: row["points"] / max(1, row["matches"]) for key, row in team.items()}
    ppg_pct = percentile(ppg)
    gd = {key: (row["gf"] - row["ga"]) / max(1, row["matches"]) for key, row in team.items()}
    gd_pct = percentile(gd)
    win_rate = {key: row["wins"] / max(1, row["matches"]) for key, row in team.items()}
    win_pct = percentile(win_rate)
    form_raw = {}
    for key, row in team.items():
        recent = sorted(row["form"], reverse=True)[:5]
        form_raw[key] = sum(points for _, points in recent) / (3 * max(1, len(recent)))
    form_pct = percentile(form_raw)
    median_games = statistics.median(row["matches"] for row in team.values()) or 1
    is_cup = bool(CUP_RE.search(tournament))
    ranked = []
    for key, row in team.items():
        if is_cup:
            components = {
                "elo_percentile": elo_pct[key],
                "tournament_win_percentile": win_pct[key],
                "goal_difference_percentile": gd_pct[key],
                "recent_form_percentile": form_pct[key],
            }
            score = 0.50 * elo_pct[key] + 0.25 * win_pct[key] + 0.10 * gd_pct[key] + 0.15 * form_pct[key]
        else:
            components = {
                "elo_percentile": elo_pct[key],
                "points_per_game_percentile": ppg_pct[key],
                "goal_difference_percentile": gd_pct[key],
                "recent_form_percentile": form_pct[key],
            }
            score = 0.30 * elo_pct[key] + 0.35 * ppg_pct[key] + 0.15 * gd_pct[key] + 0.20 * form_pct[key]
        coverage = min(1.0, row["matches"] / median_games)
        confidence = "high" if row["matches"] >= 10 and coverage >= 0.7 else (
            "medium" if row["matches"] >= 5 and coverage >= 0.5 else "low"
        )
        rating = ratings.get(key) or {}
        ranked.append({
            "team_key": key,
            "team_name": str(row["name"] or key),
            "candidate_score": round(max(0.0, min(100.0, score)), 2),
            "confidence": confidence,
            "data_coverage": round(coverage, 4),
            "score_components": components,
            "evidence": {
                "matches": row["matches"],
                "wins": row["wins"],
                "draws": row["draws"],
                "losses": row["losses"],
                "points": row["points"],
                "points_per_game": round(ppg[key], 3),
                "goals_for": row["gf"],
                "goals_against": row["ga"],
                "goal_difference_per_game": round(gd[key], 3),
                "elo": rating.get("elo"),
                "elo_matches": rating.get("played"),
                "last_five_results": [p for _, p in sorted(row["form"], reverse=True)[:5]],
                "latest_competition_match": row["last_match"],
                "competition_format_hint": "knockout_or_cup" if is_cup else "league_or_points",
                "data_source": ["club_match", "club_rating"],
                "rating_computed_at": rating.get("computed_at"),
            },
            "source_fetched_at": row["last_fetched"],
        })
    ranked.sort(key=lambda x: (-x["candidate_score"], x["team_name"].casefold()))
    for rank, row in enumerate(ranked[:100], start=1):
        row["candidate_rank"] = rank
    return ranked[:100]


def run() -> int:
    load_dotenv()
    base_url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    key = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not base_url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required")
    session = requests.Session()
    session.headers.update({
        **BASE_HEADERS,
        "apikey": key,
        "Authorization": f"Bearer {key}",
    })
    rest = f"{base_url}/rest/v1"
    today = date.today()
    window_start = today - timedelta(days=WINDOW_DAYS)
    matches = get_rows(session, f"{rest}/club_match", {
        "select": "match_date,tournament,home_key,away_key,home_team,away_team,home_score,away_score,fetched_at",
        "match_date": f"gte.{window_start.isoformat()}",
        "home_score": "not.is.null",
        "away_score": "not.is.null",
        "order": "match_date.asc",
    })
    rating_rows = get_rows(session, f"{rest}/club_rating", {
        "select": "club_key,elo,played,last_match,computed_at",
        "order": "club_key.asc",
    })
    season_rows = get_rows(session, f"{rest}/league_season", {
        "select": "tournament,season_start,source,detected_at",
        "order": "tournament.asc",
    })
    ratings = {str(r["club_key"]): r for r in rating_rows if r.get("club_key")}
    seasons: dict[str, date] = {}
    for row in season_rows:
        start = as_date(row.get("season_start"))
        if row.get("tournament") and start and start <= today:
            if row["tournament"] not in seasons or start > seasons[row["tournament"]]:
                seasons[row["tournament"]] = start

    grouped: dict[str, list[dict]] = defaultdict(list)
    for match in matches:
        if match.get("tournament") and match.get("home_key") and match.get("away_key"):
            grouped[str(match["tournament"])].append(match)

    snapshots: list[dict] = []
    active_count = 0
    for tournament, tournament_matches in grouped.items():
        latest = max((as_date(m.get("match_date")) for m in tournament_matches if as_date(m.get("match_date"))), default=None)
        if not latest or (today - latest).days > ACTIVE_DAYS:
            continue
        season_start = seasons.get(tournament)
        if not season_start or (today - season_start).days > WINDOW_DAYS:
            season_start = football_season_start(latest, tournament)
        ranked = score_tournament(tournament, season_start, tournament_matches, ratings, today)
        if not ranked:
            continue
        active_count += 1
        for row in ranked:
            snapshots.append({
                "tournament": tournament,
                "season_start": season_start.isoformat(),
                "snapshot_date": today.isoformat(),
                "team_key": row["team_key"],
                "team_name": row["team_name"],
                "candidate_score": row["candidate_score"],
                "candidate_rank": row["candidate_rank"],
                "confidence": row["confidence"],
                "data_coverage": row["data_coverage"],
                "score_components": row["score_components"],
                "evidence": row["evidence"],
                "source_fetched_at": row["source_fetched_at"],
                "model_version": MODEL_VERSION,
            })
    upsert_rows(session, f"{rest}/team_tournament_candidate_snapshot", snapshots)
    print(json.dumps({
        "snapshot_date": today.isoformat(),
        "matches_loaded": len(matches),
        "ratings_loaded": len(ratings),
        "active_tournaments_ranked": active_count,
        "candidate_rows_upserted": len(snapshots),
        "model_version": MODEL_VERSION,
        "interpretation": "relative candidate index, not a calibrated probability",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(run())
    except Exception as exc:
        print(f"team tournament forecast failed: {exc}", file=sys.stderr)
        raise
