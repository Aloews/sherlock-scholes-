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

MODEL_VERSION = "candidate-rank-v2"
PAGE_SIZE = 1000
TIMEOUT = 45

OVERALL_SPECS = {
    # Award-specific weights avoid publishing identical rankings for different awards.
    # Competition-weighted output suppresses raw totals from weaker divisions; SW rating,
    # market value and fame are separate priors, not substitutes for match performance.
    "ballon_dor": {
        "weighted_goals": .18, "weighted_assists": .12, "goals_per_90": .08,
        "assists_per_90": .05, "minutes": .08, "apps": .05, "sw_rating": .20,
        "market_value_eur": .12, "fame": .05, "competition_strength": .07,
    },
    "the_best": {
        "weighted_goals": .18, "weighted_assists": .14, "goals_per_90": .10,
        "assists_per_90": .08, "minutes": .08, "apps": .05, "sw_rating": .17,
        "market_value_eur": .06, "fame": .08, "competition_strength": .06,
    },
    "ballon_dor_feminin": {
        "weighted_goals": .18, "weighted_assists": .12, "goals_per_90": .08,
        "assists_per_90": .05, "minutes": .08, "apps": .05, "sw_rating": .20,
        "market_value_eur": .12, "fame": .05, "competition_strength": .07,
    },
    "the_best_female": {
        "weighted_goals": .18, "weighted_assists": .14, "goals_per_90": .10,
        "assists_per_90": .08, "minutes": .08, "apps": .05, "sw_rating": .17,
        "market_value_eur": .06, "fame": .08, "competition_strength": .06,
    },
    "golden_boy": {
        "weighted_goals": .18, "weighted_assists": .12, "goals_per_90": .10,
        "assists_per_90": .06, "minutes": .08, "apps": .05, "sw_rating": .16,
        "market_value_eur": .15, "fame": .03, "competition_strength": .07,
    },
}
GOLDEN_BOOT_WEIGHTS = {"goals": .68, "goals_per_90": .12, "assists": .08, "minutes": .07, "apps": .05}


def normalize_base_url(value: str) -> str:
    # Repository secrets may accidentally include a leading escape backslash.
    base = value.strip().lstrip("\\\\").rstrip("/")
    if not base.startswith(("https://", "http://")):
        raise ValueError("SUPABASE_URL must be an absolute HTTP(S) URL")
    return base


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


def competition_strength(name: str | None, short_name: str | None = None) -> float:
    """Conservative competition-quality prior; unknown competitions stay neutral."""
    value = f"{name or ''} {short_name or ''}".lower()
    if re.search(r"world cup|champions league|fifa intercontinental|european championship|euros\b|copa america|africa cup of nations|asian cup|чемпионат мира|лига чемпионов", value):
        return 1.0
    if re.search(r"russian premier league|россия\. премьер-лига", value):
        return 0.78
    if re.search(r"brazilian serie a|campeonato brasileiro|liga mx|major league soccer|a-league", value):
        return 0.82
    if re.search(r"premier league|laliga|la liga|bundesliga|serie a\b|ligue 1|fifa club world cup|uefa euro", value):
        return 0.95
    if re.search(r"europa league|conference league|qualifying|qualification|квалификац", value):
        return 0.82 if "qualif" not in value and "квалификац" not in value else 0.68
    if re.search(r"saudi pro league|süper lig|super lig|eredivisie|primeira liga|liga portugal|mls|brasileirão|brasileirao|liga profesional|j1 league|k league 1|russian premier league|премьер-лига|высшая лига", value):
        return 0.82
    if re.search(r"youth|u19|u20|u21|u23|reserve|amateur|youth league|молодёж|молодеж|резерв", value):
        return 0.38
    if re.search(r"second|2\. bundesliga|championship|serie b|liga 2|ligue 2|1\.lig|2\.lig|division 2|division 3|д2|д3|д4|д5|д6|первая лига|чемпионшип", value):
        return 0.56
    if re.search(r"cup|copa|coupe|pokal|coppa|кубок|supercup|суперкубок", value):
        return 0.72
    if re.search(r"league|liga|ligue|division|serie|лига|дивизион|чемпионат", value):
        return 0.64
    return 0.5


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
        # Unknown market values/ratings stay neutral instead of being treated as zero.
        measured = [p for p in eligible if p.get(metric) is not None]
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
            "goals_per_90": round(p.get("goals_per_90", 0), 4),
            "assists_per_90": round(p.get("assists_per_90", 0), 4),
            "weighted_goals": round(p.get("weighted_goals", p["goals"]), 3),
            "weighted_assists": round(p.get("weighted_assists", p["assists"]), 3),
            "competition_strength": round(p.get("competition_strength", 0.5), 3),
            "goal_involvements": p["goals"] + p["assists"],
            "sw_rating": p.get("sw_rating"), "market_value_eur": p.get("market_value_eur"),
            "fame": p.get("fame"),
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

    competition_rows = get_rows(base, key, "tm_competition", {
        "select": "id,name,short_name,type_id,updated_at", "order": "id.asc",
    })
    strength_by_competition = {
        str(item["id"]): competition_strength(item.get("name"), item.get("short_name"))
        for item in competition_rows if item.get("id")
    }

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
                "weighted_goals": 0.0, "weighted_assists": 0.0, "strength_minutes": 0.0,
                "minutes_for_strength": 0, "last_fetched": None, "stats_rows": 0,
            })
            item["stats_rows"] += 1
            for field in ("apps", "starts", "minutes", "goals", "assists"):
                item[field] += int(number(row, field))
            strength = strength_by_competition.get(competition, 0.5)
            item["weighted_goals"] += number(row, "goals") * strength
            item["weighted_assists"] += number(row, "assists") * strength
            item["strength_minutes"] += number(row, "minutes") * strength
            item["minutes_for_strength"] += int(number(row, "minutes"))
            fetched = row.get("fetched_at")
            if fetched and (item["last_fetched"] is None or fetched > item["last_fetched"]):
                item["last_fetched"] = fetched

    ids = list(totals)
    cards: dict[str, dict] = {}
    card_url = f"{base.rstrip('/')}/rest/v1/cards"
    for start in range(0, len(ids), 100):
        joined = ",".join(ids[start:start + 100])
        r = requests.get(card_url, headers=api_headers(key), params={
            "select": "id,name,category,born_on,sw_rating,market_value_eur,fame,pageviews,position_ru,active",
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
            row["weighted_goals"] = max(0.0, stat.get("weighted_goals", stat["goals"]))
            row["weighted_assists"] = max(0.0, stat.get("weighted_assists", stat["assists"]))
            row["competition_strength"] = (
                stat["strength_minutes"] / stat["minutes_for_strength"]
                if stat.get("minutes_for_strength", 0) > 0 else 0.5
            )
            row["goals_per_90"] = 90.0 * row["goals"] / max(1, row["minutes"])
            row["assists_per_90"] = 90.0 * row["assists"] / max(1, row["minutes"])
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

    payloads = []
    for award_key, weights in OVERALL_SPECS.items():
        payloads.extend(score_population(population, weights, award_key, season, snapshot))
    for competition, source in by_competition.items():
        comp_population = population_from(source)
        payloads.extend(score_population(comp_population, GOLDEN_BOOT_WEIGHTS, "golden_boot", season, snapshot, competition))
    if not payloads:
        raise RuntimeError("No award candidate rows generated; refusing to erase today's previous snapshot")
    # Replacing the date/season snapshot prevents candidates who fell out of the
    # new top 50 (or were scored by an older model) from remaining visible.
    delete_response = requests.delete(
        f"{base.rstrip('/')}/rest/v1/award_candidate_snapshot",
        headers=api_headers(key),
        params={"snapshot_date": f"eq.{snapshot.isoformat()}"},
        timeout=TIMEOUT,
    )
    delete_response.raise_for_status()
    written = upsert_rows(base, key, "award_candidate_snapshot", payloads,
                          "award_key,season_id,snapshot_date,card_id,competition_id")
    return season, written


def competition_format(tournament: str) -> str:
    """Classify only the ranking interpretation; never claim a cup is a league table."""
    value = tournament.lower()
    # Check international competitions before the generic "league" token:
    # "Лига чемпионов" is a tournament, not a domestic league table.
    if re.search(r"\b(champions|champions league|europa|conference league|world cup|euro|мир|европы|чемпионов)\b", value):
        return "international_tournament_form_proxy"
    if re.search(r"\b(cup|copa|coupe|pokal|coppa|кубок|суперкубок)\b", value):
        return "knockout_form_proxy"
    if re.search(r"\b(league|liga|ligue|division|división|bundesliga|serie [ab]|premier|championship|чемпионат|лига|дивизион|д[1-6]|высшая лига|первая лига|суперлига)\b", value):
        return "league_standings_proxy"
    return "competition_form_proxy"


def build_team_candidate_payloads(matches: list[dict], ratings: dict[str, dict], snapshot: date) -> list[dict]:
    """Create dated rankings for every sufficiently observed tracked competition."""
    grouped: dict[str, list[dict]] = defaultdict(list)
    seen = set()
    for match in matches:
        tournament = str(match.get("tournament") or "").strip()
        day = str(match.get("match_date") or "")[:10]
        home, away = str(match.get("home_team") or "").strip(), str(match.get("away_team") or "").strip()
        if not tournament or not day or not home or not away or home == away:
            continue
        if match.get("home_score") is None or match.get("away_score") is None:
            continue
        home_key = str(match.get("home_key") or normal_key(home)).strip()
        away_key = str(match.get("away_key") or normal_key(away)).strip()
        if not home_key or not away_key or home_key == away_key:
            continue
        identity = (tournament, day, home_key, away_key, int(match["home_score"]), int(match["away_score"]))
        if identity in seen:
            continue
        seen.add(identity)
        grouped[tournament].append({**match, "match_date": day, "home_key": home_key, "away_key": away_key,
                                    "home_team": home, "away_team": away})

    payloads: list[dict] = []
    for tournament, all_matches in grouped.items():
        all_matches.sort(key=lambda item: item["match_date"])
        # Keep the current competition cycle. The boundary is explicitly marked
        # as inferred unless an upstream source provides an official season ID.
        segment_start = 0
        for index in range(1, len(all_matches)):
            previous = date.fromisoformat(all_matches[index - 1]["match_date"])
            current = date.fromisoformat(all_matches[index]["match_date"])
            if (current - previous).days > 75:
                segment_start = index
        current_matches = all_matches[segment_start:]
        if not current_matches:
            continue

        by_team: dict[str, dict] = {}
        first_date = current_matches[0]["match_date"]
        last_updated = None
        for match in current_matches:
            if match.get("fetched_at"):
                last_updated = max(last_updated, match["fetched_at"]) if last_updated else match["fetched_at"]
            home_key, away_key = match["home_key"], match["away_key"]
            home_name, away_name = match["home_team"], match["away_team"]
            hs, aws = int(match["home_score"]), int(match["away_score"])
            for team_key, team_name in ((home_key, home_name), (away_key, away_name)):
                by_team.setdefault(team_key, {
                    "team_key": team_key, "team_name": team_name, "played": 0, "points": 0,
                    "wins": 0, "draws": 0, "losses": 0, "gf": 0, "ga": 0, "recent": [],
                })
                # Prefer the latest display name while preserving stable entity key.
                by_team[team_key]["team_name"] = team_name
            home, away = by_team[home_key], by_team[away_key]
            home["played"] += 1; away["played"] += 1
            home["gf"] += hs; home["ga"] += aws
            away["gf"] += aws; away["ga"] += hs
            if hs > aws:
                home["wins"] += 1; home["points"] += 3; away["losses"] += 1
                home["recent"].append(1.0); away["recent"].append(0.0)
            elif hs < aws:
                away["wins"] += 1; away["points"] += 3; home["losses"] += 1
                home["recent"].append(0.0); away["recent"].append(1.0)
            else:
                home["draws"] += 1; away["draws"] += 1
                home["points"] += 1; away["points"] += 1
                home["recent"].append(0.5); away["recent"].append(0.5)

        if len(by_team) < 2:
            continue
        teams = list(by_team.values())
        max_played = max(team["played"] for team in teams)
        # Percentiles prevent goal-rich competitions from dominating a ranking.
        ppg_values = [team["points"] / team["played"] for team in teams]
        gd_values = [max(-2.0, min(2.0, (team["gf"] - team["ga"]) / team["played"])) for team in teams]
        win_values = [team["wins"] / team["played"] for team in teams]
        form_values = [sum(team["recent"][-5:]) / len(team["recent"][-5:]) for team in teams]
        elo_raw = [ratings.get(team["team_key"], {}).get("elo") for team in teams]
        rated_indices = [i for i, value in enumerate(elo_raw) if value is not None]
        rated_percentiles = percentile([float(elo_raw[i]) for i in rated_indices])
        elo_rank = [50.0] * len(teams)
        for index, value in zip(rated_indices, rated_percentiles):
            elo_rank[index] = value
        ppg_rank = percentile(ppg_values)
        gd_rank = percentile(gd_values)
        win_rank = percentile(win_values)
        form_rank = percentile(form_values)
        raw_scores: dict[str, float] = {}
        component_map: dict[str, dict[str, float]] = {}
        for i, team in enumerate(teams):
            components = {
                "points_per_game_percentile": ppg_rank[i],
                "goal_difference_percentile": gd_rank[i],
                "win_rate_percentile": win_rank[i],
                "recent_form_percentile": form_rank[i],
                "club_elo_percentile": elo_rank[i],
            }
            # Relative form/standings plus an independent cross-competition team-strength prior.
            unshrunk_score = (
                .30 * components["points_per_game_percentile"]
                + .20 * components["goal_difference_percentile"]
                + .15 * components["win_rate_percentile"]
                + .20 * components["recent_form_percentile"]
                + .15 * components["club_elo_percentile"]
            )
            # Shrink tiny samples toward neutral so a perfect 2–3 match run
            # cannot outrank a full-season contender on form alone.
            reliability = min(1.0, team["played"] / 12.0)
            raw_scores[team["team_key"]] = 50.0 + (unshrunk_score - 50.0) * reliability
            component_map[team["team_key"]] = {
                **{key: round(value, 2) for key, value in components.items()},
                "unshrunk_relative_index": round(unshrunk_score, 2),
                "sample_reliability": round(reliability, 3),
            }
        ordered = sorted(teams, key=lambda team: (-raw_scores[team["team_key"]], -team["played"], team["team_key"]))
        comp_format = competition_format(tournament)
        for rank, team in enumerate(ordered[:100], 1):
            key = team["team_key"]
            coverage = min(1.0, team["played"] / max(1, max_played))
            confidence = "high" if team["played"] >= 12 and coverage >= .7 else (
                "medium" if team["played"] >= 6 and coverage >= .4 else "low")
            recent = team["recent"][-5:]
            payloads.append({
                "tournament": tournament, "season_start": first_date, "snapshot_date": snapshot.isoformat(),
                "team_key": key, "team_name": team["team_name"],
                "candidate_score": round(max(0, min(100, raw_scores[key])), 4),
                "candidate_rank": rank, "confidence": confidence, "data_coverage": round(coverage, 4),
                "score_components": component_map[key],
                "evidence": {
                    "competition_format": comp_format,
                    "matches_played": team["played"], "max_matches_played_by_team": max_played,
                    "wins": team["wins"], "draws": team["draws"], "losses": team["losses"],
                    "goals_for": team["gf"], "goals_against": team["ga"],
                    "points_per_game": round(team["points"] / team["played"], 4),
                    "goal_difference_per_game": round((team["gf"] - team["ga"]) / team["played"], 4),
                    "recent_form_last_5": round(sum(recent) / len(recent), 4) if recent else None,
                    "club_elo": ratings.get(key, {}).get("elo"),
                    "sample_reliability": round(min(1.0, team["played"] / 12.0), 3),
                    "coverage_basis": "share of maximum matches observed for a team in this competition snapshot; not source completeness",
                    "score_is_probability": False,
                    "ranking_method": "current competition results + recent form + cross-competition club Elo",
                    "season_start_basis": "inferred from the latest >75-day gap between recorded results",
                    "limitations": (
                        "Relative ranking index, not a calibrated probability. Cup and international-tournament "
                        "rankings use observed results/form and club Elo; bracket paths, remaining fixtures, injuries, "
                        "lineups and official qualification rules are not fully modeled."
                    ),
                },
                "source_fetched_at": last_updated or ratings.get(key, {}).get("computed_at"),
                "model_version": MODEL_VERSION,
            })
    return payloads


def build_team_candidates(base: str, key: str, snapshot: date) -> int:
    cutoff = (snapshot - timedelta(days=365)).isoformat()
    # club_match is the broad competition feed: it currently covers hundreds of
    # competitions and more than 30k scored matches per rolling year. The betting
    # fixtures feed is intentionally not the source of truth for tournament coverage.
    matches = get_rows(base, key, "club_match", {
        "select": "match_date,tournament,home_key,away_key,home_team,away_team,home_score,away_score,fetched_at",
        "match_date": f"gte.{cutoff}", "order": "match_date.asc",
    })
    if not matches:
        raise RuntimeError("No tracked club_match results in the last 365 days; refusing empty team snapshots")
    rating_rows = get_rows(base, key, "club_rating", {
        "select": "club_key,elo,computed_at", "order": "club_key.asc",
    })
    ratings = {
        str(row.get("club_key") or ""): {
            "elo": float(row["elo"]) if row.get("elo") is not None else None,
            "computed_at": row.get("computed_at"),
        }
        for row in rating_rows if row.get("club_key")
    }
    payloads = build_team_candidate_payloads(matches, ratings, snapshot)
    if not payloads:
        raise RuntimeError("No sufficiently observed team competitions; refusing empty team snapshots")
    # The source model changed from betting-feed sport keys to canonical tracked
    # competitions. Replace today's snapshot atomically at the logical level so
    # old rows from the previous model cannot remain visible beside new rankings.
    delete_response = requests.delete(
        f"{base.rstrip('/')}/rest/v1/team_tournament_candidate_snapshot",
        headers=api_headers(key),
        params={"snapshot_date": f"eq.{snapshot.isoformat()}"},
        timeout=TIMEOUT,
    )
    delete_response.raise_for_status()
    return upsert_rows(base, key, "team_tournament_candidate_snapshot", payloads,
                       "tournament,season_start,snapshot_date,team_key")

def main() -> int:
    load_dotenv()
    raw_base, key = os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_KEY", "").strip()
    if not raw_base.strip() or not key:
        print("SUPABASE_URL and SUPABASE_KEY are required", file=sys.stderr)
        return 2
    try:
        base = normalize_base_url(raw_base)
    except ValueError as error:
        print(str(error), file=sys.stderr)
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
