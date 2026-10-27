"""Transparent award-candidate rankings from current-season player statistics.

Scores are comparative indices, NOT calibrated probabilities or claims that an
award outcome is known. The source season and missing-input coverage are stored
with every snapshot so the UI can distinguish evidence from speculation.
"""
from __future__ import annotations

from datetime import date
from math import isfinite
from typing import Any


MODEL_VERSION = "award-candidates-v1"


def _percentile(values: list[float], value: float | None) -> float | None:
    if value is None or not isfinite(value) or not values:
        return None
    ordered = sorted(v for v in values if isfinite(v))
    if not ordered:
        return None
    if len(ordered) == 1:
        return 50.0
    # Mid-rank percentile handles ties deterministically.
    less = sum(v < value for v in ordered)
    equal = sum(v == value for v in ordered)
    return round(100.0 * (less + max(equal - 1, 0) / 2) / max(len(ordered) - 1, 1), 2)


def _weighted_score(parts: dict[str, tuple[float | None, float]]) -> tuple[float, float, dict[str, float]]:
    available = [(name, value, weight) for name, (value, weight) in parts.items() if value is not None]
    if not available:
        return 0.0, 0.0, {}
    total_weight = sum(weight for _, _, weight in available)
    score = sum(value * weight for _, value, weight in available) / total_weight
    coverage = sum(weight for _, _, weight in available) / sum(weight for _, weight in parts.values())
    return round(score, 2), round(coverage, 3), {name: round(value, 2) for name, value, _ in available}


def aggregate_player_seasons(stat_rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Aggregate club/competition rows without mixing seasons or duplicate cards."""
    out: dict[str, dict[str, Any]] = {}
    for row in stat_rows:
        card_id = row.get("card_id")
        if not card_id:
            continue
        try:
            apps = max(0, int(row.get("apps") or 0))
            minutes = max(0, int(row.get("minutes") or 0))
            goals = max(0, int(row.get("goals") or 0))
            assists = max(0, int(row.get("assists") or 0))
        except (TypeError, ValueError):
            continue
        item = out.setdefault(str(card_id), {
            "card_id": str(card_id), "apps": 0, "minutes": 0, "goals": 0,
            "assists": 0, "team_goals": 0, "opponent_goals": 0,
            "stat_rows": 0, "fetched_at": None,
        })
        item["apps"] += apps
        item["minutes"] += minutes
        item["goals"] += goals
        item["assists"] += assists
        item["team_goals"] += max(0, int(row.get("team_goals") or 0))
        item["opponent_goals"] += max(0, int(row.get("opponent_goals") or 0))
        item["stat_rows"] += 1
        fetched = row.get("fetched_at")
        if fetched and (item["fetched_at"] is None or fetched > item["fetched_at"]):
            item["fetched_at"] = fetched
    for item in out.values():
        item["goal_contributions"] = item["goals"] + item["assists"]
        item["contributions_per_90"] = (
            90 * item["goal_contributions"] / item["minutes"] if item["minutes"] else None
        )
        item["goals_per_90"] = 90 * item["goals"] / item["minutes"] if item["minutes"] else None
        item["team_goal_diff_per_app"] = (
            (item["team_goals"] - item["opponent_goals"]) / item["apps"]
            if item["apps"] else None
        )
    return out


def _age_on(born_on: str | None, reference_date: date) -> int | None:
    if not born_on:
        return None
    try:
        born = date.fromisoformat(str(born_on)[:10])
    except ValueError:
        return None
    return reference_date.year - born.year - ((reference_date.month, reference_date.day) < (born.month, born.day))


def rank_candidates(
    cards: list[dict[str, Any]],
    stats: dict[str, dict[str, Any]],
    *,
    award_key: str,
    season_id: int,
    snapshot_date: date,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Rank evidence-backed candidates for one award; no score is a probability."""
    eligible: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for card in cards:
        stat = stats.get(str(card.get("id")))
        if not stat or stat["apps"] < 5 or stat["minutes"] < 180:
            continue
        if award_key == "golden_boy":
            if card.get("category") == "woman":
                continue
            age = _age_on(card.get("born_on"), date(season_id, 12, 31))
            if age is None or age > 21:
                continue
        eligible.append((card, stat))
    if not eligible:
        return []

    metric_keys = ("goals", "goal_contributions", "contributions_per_90", "goals_per_90",
                   "minutes", "team_goal_diff_per_app", "fame", "market_value_eur")
    percentiles: dict[str, dict[str, float | None]] = {}
    for key in metric_keys:
        values = [float(stat[key]) for _, stat in eligible if stat.get(key) is not None]
        percentiles[key] = {
            str(card["id"]): _percentile(values, float(stat[key]) if stat.get(key) is not None else None)
            for card, stat in eligible
        }

    results = []
    for card, stat in eligible:
        p = percentiles
        pid = str(card["id"])
        parts: dict[str, tuple[float | None, float]] = {
            "goal_contributions": (p["goal_contributions"][pid], 0.35),
            "contributions_per_90": (p["contributions_per_90"][pid], 0.15),
            "minutes_played": (p["minutes"][pid], 0.20),
            "team_goal_difference": (p["team_goal_diff_per_app"][pid], 0.15),
            "recognition": (p["fame"][pid], 0.10),
            "market_value_proxy": (p["market_value_eur"][pid], 0.05),
        }
        if award_key == "golden_boot":
            parts = {
                "goals": (p["goals"][pid], 0.65),
                "goals_per_90": (p["goals_per_90"][pid], 0.20),
                "minutes_played": (p["minutes"][pid], 0.15),
            }
        elif award_key == "golden_boy":
            parts = {
                "goal_contributions": (p["goal_contributions"][pid], 0.35),
                "contributions_per_90": (p["contributions_per_90"][pid], 0.20),
                "minutes_played": (p["minutes"][pid], 0.25),
                "team_goal_difference": (p["team_goal_diff_per_app"][pid], 0.10),
                "recognition": (p["fame"][pid], 0.10),
            }
        elif award_key == "the_best":
            parts["recognition"] = (p["fame"][pid], 0.20)
            parts["market_value_proxy"] = (p["market_value_eur"][pid], 0.05)

        score, coverage, components = _weighted_score(parts)
        confidence = "high" if coverage >= 0.85 else "medium" if coverage >= 0.60 else "low"
        results.append({
            "award_key": award_key,
            "season_id": season_id,
            "snapshot_date": snapshot_date.isoformat(),
            "card_id": pid,
            "candidate_score": score,
            "rank": 0,
            "confidence": confidence,
            "data_coverage": coverage,
            "score_components": components,
            "source_fetched_at": stat.get("fetched_at"),
            "model_version": MODEL_VERSION,
            "evidence": {
                "apps": stat["apps"], "minutes": stat["minutes"], "goals": stat["goals"],
                "assists": stat["assists"], "age_at_season_end": _age_on(
                    card.get("born_on"), date(season_id, 12, 31)
                ),
                "score_is_probability": False,
            },
        })
    results.sort(key=lambda row: (-row["candidate_score"], -row["evidence"]["minutes"], row["card_id"]))
    for index, row in enumerate(results[:limit], start=1):
        row["rank"] = index
    return results[:limit]
