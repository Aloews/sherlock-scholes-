#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Daily, auditable candidate rankings for individual awards and team tournaments.

Scores are relative candidate indices, not calibrated probabilities. The pipeline
writes immutable daily snapshots so outcomes can later be scored without leakage.
It never fabricates winners and never overwrites verified outcomes.
"""
from __future__ import annotations

import argparse
import math
import os
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests
from dotenv import load_dotenv

MODEL_VERSION = "award-analytics-v1.0"
PAGE_SIZE = 1000
BATCH_SIZE = 200
DEFAULT_TOP = 100
UA = "SherlockScholesAwardAnalytics/1.0"
PERSONAL_AWARDS = ("player_of_season", "top_scorer", "playmaker", "young_player")


def percentile(values: list[float], value: float) -> float:
    """Empirical percentile in [0, 1], with ties averaged deterministically."""
    if not values:
        return 0.0
    less = sum(v < value for v in values)
    equal = sum(v == value for v in values)
    return (less + max(equal - 1, 0) / 2) / max(len(values) - 1, 1)


def bounded(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def confidence_for(coverage: float, games: int, fresh: bool) -> str:
    if coverage >= 0.85 and games >= 18 and fresh:
        return "high"
    if coverage >= 0.55 and games >= 6:
        return "medium"
    return "low"


def score_player_candidates(cards: list[dict], stats: list[dict], season_id: int,
                            snapshot_date: date, top_n: int = DEFAULT_TOP) -> list[dict]:
    card_by_id = {str(c["id"]): c for c in cards}
    agg: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "apps": 0, "minutes": 0, "goals": 0, "assists": 0, "rows": 0,
        "competition_ids": set(), "clubs": set(), "latest_fetch": None,
    })
    for row in stats:
        cid = str(row.get("card_id") or "")
        if cid not in card_by_id:
            continue
        a = agg[cid]
        for key in ("apps", "minutes", "goals", "assists"):
            a[key] += max(0, int(row.get(key) or 0))
        a["rows"] += 1
        if row.get("competition_id"):
            a["competition_ids"].add(str(row["competition_id"]))
        if row.get("club_id"):
            a["clubs"].add(str(row["club_id"]))
        fetched = row.get("fetched_at")
        if fetched and (a["latest_fetch"] is None or fetched > a["latest_fetch"]):
            a["latest_fetch"] = fetched

    eligible = []
    for cid, a in agg.items():
        card = card_by_id[cid]
        if a["apps"] <= 0 and a["minutes"] <= 0 and a["goals"] <= 0 and a["assists"] <= 0:
            continue
        born = card.get("born_on")
        age = None
        if born:
            try:
                born_date = date.fromisoformat(str(born)[:10])
                age = snapshot_date.year - born_date.year - ((snapshot_date.month, snapshot_date.day) < (born_date.month, born_date.day))
            except ValueError:
                age = None
        goals90 = 90 * a["goals"] / a["minutes"] if a["minutes"] else 0.0
        assists90 = 90 * a["assists"] / a["minutes"] if a["minutes"] else 0.0
        eligible.append({
            "id": cid, "card": card, **{k: a[k] for k in ("apps", "minutes", "goals", "assists", "rows")},
            "age": age, "goals90": goals90, "assists90": assists90,
            "competition_ids": sorted(a["competition_ids"]), "clubs": sorted(a["clubs"]),
            "latest_fetch": a["latest_fetch"],
        })
    if not eligible:
        return []

    feature_names = ("goals", "assists", "minutes", "apps", "goals90", "assists90", "fame", "market_value")
    feature_values = {
        key: [float((p["card"].get("fame") or 0) if key == "fame" else
                    (p["card"].get("market_value_eur") or 0) if key == "market_value" else p[key])
              for p in eligible]
        for key in feature_names
    }
    for p in eligible:
        for key in feature_names:
            value = float((p["card"].get("fame") or 0) if key == "fame" else
                          (p["card"].get("market_value_eur") or 0) if key == "market_value" else p[key])
            p[key + "_pct"] = percentile(feature_values[key], value)

    definitions = {
        "player_of_season": {"goals": .24, "assists": .18, "minutes": .17, "apps": .10, "goals90": .12, "assists90": .10, "fame": .05, "market_value": .04},
        "top_scorer": {"goals": .68, "goals90": .16, "minutes": .08, "apps": .08},
        "playmaker": {"assists": .65, "assists90": .17, "minutes": .10, "apps": .08},
        "young_player": {"goals": .22, "assists": .18, "minutes": .18, "apps": .10, "goals90": .12, "assists90": .08, "fame": .06, "market_value": .06},
    }
    out = []
    for award_key, weights in definitions.items():
        candidates = []
        for p in eligible:
            if award_key == "young_player" and (p["age"] is None or p["age"] > 23):
                continue
            raw = sum(p[key + "_pct"] * weight for key, weight in weights.items())
            # A thin statistical sample must lower the ranking, not masquerade as a full season.
            coverage = bounded(min(1.0, p["apps"] / 20) * 0.55 + min(1.0, p["minutes"] / 1500) * 0.45)
            adjusted = raw * (0.65 + 0.35 * coverage)
            fresh = bool(p["latest_fetch"] and str(p["latest_fetch"])[:10] >= (snapshot_date - timedelta(days=14)).isoformat())
            conf = confidence_for(coverage, p["apps"], fresh)
            candidates.append((adjusted, p, coverage, conf))
        candidates.sort(key=lambda x: (-x[0], str(x[1]["card"].get("name") or "").casefold()))
        for rank, (score, p, coverage, conf) in enumerate(candidates[:top_n], 1):
            components = {key: round(p[key + "_pct"] * 100, 2) for key in weights}
            components["sample_coverage"] = round(coverage * 100, 2)
            evidence = {
                "season_id": season_id, "apps": p["apps"], "minutes": p["minutes"],
                "goals": p["goals"], "assists": p["assists"],
                "goals_per_90": round(p["goals90"], 4), "assists_per_90": round(p["assists90"], 4),
                "age": p["age"], "competitions": p["competition_ids"], "clubs": p["clubs"],
                "source_table": "player_season_stat", "source_fetched_at": p["latest_fetch"],
                "scoring_note": "relative ranking index; not a calibrated probability",
            }
            out.append({
                "award_key": award_key, "season_id": season_id, "snapshot_date": snapshot_date.isoformat(),
                "card_id": p["id"], "candidate_score": round(score * 100, 4),
                "candidate_rank": rank, "confidence": conf, "data_coverage": round(coverage, 4),
                "score_components": components, "evidence": evidence,
                "source_fetched_at": p["latest_fetch"], "model_version": MODEL_VERSION,
            })
    return out


def _team_key(row: dict, side: str) -> str:
    return str(row.get(side + "_key") or re.sub(r"[^a-z0-9]+", "-", str(row.get(side + "_team") or "").casefold()).strip("-"))


def score_team_tournaments(matches: list[dict], season_rows: list[dict],
                           snapshot_date: date, top_n: int = DEFAULT_TOP) -> list[dict]:
    """Rank current-season contenders in every tournament with usable match data."""
    seasons = {str(r["tournament"]): date.fromisoformat(str(r["season_start"])[:10])
               for r in season_rows if r.get("tournament") and r.get("season_start")}
    by_tournament: dict[str, list[dict]] = defaultdict(list)
    for row in matches:
        tournament = str(row.get("tournament") or "").strip()
        if not tournament or row.get("home_score") is None or row.get("away_score") is None:
            continue
        try:
            match_date = date.fromisoformat(str(row.get("match_date"))[:10])
        except (TypeError, ValueError):
            continue
        season_start = seasons.get(tournament)
        boundary_source = "league_season"
        if season_start is None:
            # For cups absent from league_season, use a transparent rolling season window.
            season_start = snapshot_date - timedelta(days=365)
            boundary_source = "rolling_365d_fallback"
        if match_date < season_start or match_date > snapshot_date:
            continue
        home = _team_key(row, "home")
        away = _team_key(row, "away")
        if not home or not away or home == away:
            continue
        normalized = dict(row, _date=match_date, _home_key=home, _away_key=away,
                          _season_start=season_start, _boundary_source=boundary_source)
        by_tournament[tournament].append(normalized)

    output = []
    for tournament, games in by_tournament.items():
        teams: dict[str, dict[str, Any]] = {}
        for game in games:
            for side, opp in (("home", "away"), ("away", "home")):
                key = game["_" + side + "_key"]
                name = str(game.get(side + "_team") or key)
                t = teams.setdefault(key, {
                    "key": key, "name": name, "played": 0, "wins": 0, "draws": 0,
                    "losses": 0, "gf": 0, "ga": 0, "points": 0, "forms": [],
                    "latest_match": None, "source_fetched_at": None, "boundary_sources": set(),
                })
                score, conceded = int(game[side + "_score"]), int(game[opp + "_score"])
                t["played"] += 1
                t["gf"] += score
                t["ga"] += conceded
                t["wins"] += int(score > conceded)
                t["draws"] += int(score == conceded)
                t["losses"] += int(score < conceded)
                t["points"] += 3 if score > conceded else (1 if score == conceded else 0)
                t["forms"].append((game["_date"], 3 if score > conceded else (1 if score == conceded else 0)))
                t["latest_match"] = max(t["latest_match"] or game["_date"], game["_date"])
                fetched = game.get("fetched_at")
                if fetched and (t["source_fetched_at"] is None or fetched > t["source_fetched_at"]):
                    t["source_fetched_at"] = fetched
                t["boundary_sources"].add(game["_boundary_source"])
        teams = {k: t for k, t in teams.items() if t["played"] >= 3}
        if len(teams) < 2:
            continue
        raw_values = {}
        for key, t in teams.items():
            t["ppg"] = t["points"] / t["played"]
            t["gdpg"] = (t["gf"] - t["ga"]) / t["played"]
            t["win_rate"] = t["wins"] / t["played"]
            last = sorted(t["forms"], reverse=True)[:8]
            t["recent_ppg"] = sum(v for _, v in last) / len(last) if last else 0.0
            # A stable, interpretable form index; it is deliberately not called a title probability.
            raw_values[key] = (
                0.42 * (t["ppg"] / 3)
                + 0.22 * t["win_rate"]
                + 0.18 * bounded((t["gdpg"] + 2) / 4)
                + 0.18 * (t["recent_ppg"] / 3)
            )
        mean = sum(raw_values.values()) / len(raw_values)
        variance = sum((v - mean) ** 2 for v in raw_values.values()) / len(raw_values)
        sd = math.sqrt(variance) or 0.01
        # Convert standardized strength into a 0-100 relative index for readable comparisons.
        for key, t in teams.items():
            z = (raw_values[key] - mean) / sd
            relative_score = 100 / (1 + math.exp(-z))
            latest = t["latest_match"]
            freshness_days = (snapshot_date - latest).days
            coverage = bounded(min(1.0, t["played"] / 20) * 0.65 + (0.35 if freshness_days <= 14 else 0.15 if freshness_days <= 35 else 0.0))
            conf = confidence_for(coverage, t["played"], freshness_days <= 14)
            components = {
                "points_per_game": round(t["ppg"], 4), "win_rate": round(t["win_rate"], 4),
                "goal_difference_per_game": round(t["gdpg"], 4), "recent_8_points_per_game": round(t["recent_ppg"], 4),
                "matches_played": t["played"], "freshness_days": freshness_days,
            }
            evidence = {
                "tournament": tournament, "season_start": min(g["_season_start"] for g in games).isoformat(),
                "matches_used": len(games), "team_matches": t["played"],
                "wins": t["wins"], "draws": t["draws"], "losses": t["losses"],
                "goals_for": t["gf"], "goals_against": t["ga"],
                "last_match_date": latest.isoformat(),
                "season_boundary_source": sorted(t["boundary_sources"]),
                "source_table": "club_match",
                "scoring_note": "form/standings strength index; not a calibrated title probability",
            }
            output.append({
                "tournament": tournament, "season_start": min(g["_season_start"] for g in games).isoformat(),
                "snapshot_date": snapshot_date.isoformat(), "team_key": key, "team_name": t["name"],
                "candidate_score": round(relative_score, 4), "candidate_rank": 0,
                "confidence": conf, "data_coverage": round(coverage, 4),
                "score_components": components, "evidence": evidence,
                "source_fetched_at": t["source_fetched_at"], "model_version": MODEL_VERSION,
            })
    # Rank within each tournament and retain top N per tournament.
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in output:
        grouped[(row["tournament"], row["season_start"])].append(row)
    ranked = []
    for _, rows in grouped.items():
        rows.sort(key=lambda r: (-r["candidate_score"], r["team_name"].casefold()))
        for rank, row in enumerate(rows[:top_n], 1):
            row["candidate_rank"] = rank
            ranked.append(row)
    return ranked


class SupabaseRest:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.session = requests.Session()
        self.session.headers.update({
            "apikey": key, "Authorization": "Bearer " + key,
            "Content-Type": "application/json", "User-Agent": UA,
        })

    def fetch(self, table: str, params: dict[str, str], page_size: int = PAGE_SIZE) -> list[dict]:
        rows, offset = [], 0
        while True:
            query = dict(params, limit=str(page_size), offset=str(offset))
            response = self.session.get(f"{self.base}/{table}", params=query, timeout=90)
            response.raise_for_status()
            batch = response.json()
            if not isinstance(batch, list):
                raise RuntimeError(f"Expected array from {table}, received {type(batch).__name__}")
            rows.extend(batch)
            if len(batch) < page_size:
                return rows
            offset += len(batch)

    def upsert(self, table: str, rows: list[dict], conflict: str) -> int:
        for start in range(0, len(rows), BATCH_SIZE):
            batch = rows[start:start + BATCH_SIZE]
            response = self.session.post(
                f"{self.base}/{table}", params={"on_conflict": conflict}, json=batch,
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                timeout=90,
            )
            if not response.ok:
                raise RuntimeError(f"Upsert {table} failed HTTP {response.status_code}: {response.text[:1200]}")
        return len(rows)


def run(args: argparse.Namespace) -> int:
    load_dotenv()
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY are required")
    db = SupabaseRest(url, key)
    today = date.today()
    cards = db.fetch("cards", {
        "select": "id,name,category,born_on,fame,market_value_eur",
        "category": "in.(player,woman)", "active": "eq.true",
        "order": "id.asc",
    })
    season_rows = db.fetch("league_season", {"select": "tournament,season_start,source,detected_at"})
    matches = db.fetch("club_match", {
        "select": "match_date,home_key,away_key,tournament,home_team,away_team,home_score,away_score,fetched_at",
        "match_date": "lte." + today.isoformat(),
        "order": "match_date.asc",
    })
    season_response = db.session.get(f"{db.base}/player_season_stat", params={
        "select": "season_id", "order": "season_id.desc", "limit": "1",
    }, timeout=30)
    season_response.raise_for_status()
    season_payload = season_response.json()
    if not season_payload:
        raise RuntimeError("player_season_stat is empty; cannot build personal-award candidates")
    season_id = int(season_payload[0]["season_id"])
    stats = db.fetch("player_season_stat", {
        "select": "card_id,season_id,competition_id,club_id,apps,minutes,goals,assists,fetched_at",
        "season_id": f"eq.{season_id}", "card_id": "not.is.null",
        "order": "card_id.asc",
    })
    personal = score_player_candidates(cards, stats, season_id, today, args.top)
    teams = score_team_tournaments(matches, season_rows, today, args.top)
    if not personal:
        raise RuntimeError("No individual-award candidates produced; refusing to publish empty snapshots")
    if not teams:
        raise RuntimeError("No team-tournament candidates produced; refusing to publish empty snapshots")
    print(f"season={season_id}; active_player_cards={len(cards)}; current_season_stat_rows={len(stats)}")
    print(f"personal_candidate_rows={len(personal)}; team_candidate_rows={len(teams)}; tournaments={len({r['tournament'] for r in teams})}")
    if args.dry_run:
        for row in personal[:8]:
            print("PERSONAL", row["award_key"], row["candidate_rank"], row["card_id"], row["candidate_score"], row["confidence"])
        for row in sorted(teams, key=lambda r: (r["tournament"], r["candidate_rank"]))[:12]:
            print("TEAM", row["tournament"], row["candidate_rank"], row["team_name"], row["candidate_score"], row["confidence"])
        return 0
    if not args.apply:
        raise RuntimeError("Writes require --apply; otherwise pass --dry-run")
    p_count = db.upsert("award_candidate_snapshot", personal, "award_key,season_id,snapshot_date,card_id")
    t_count = db.upsert("team_tournament_candidate_snapshot", teams, "tournament,season_start,snapshot_date,team_key")
    print(f"upserted personal snapshots={p_count}; team tournament snapshots={t_count}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--top", type=int, default=DEFAULT_TOP, help="candidates retained per award/tournament")
    parser.add_argument("--dry-run", action="store_true", help="fetch live data and score candidates without writing")
    parser.add_argument("--apply", action="store_true", help="upsert daily snapshots to Supabase")
    args = parser.parse_args()
    if args.top < 5 or args.top > 500:
        parser.error("--top must be between 5 and 500")
    if args.dry_run and args.apply:
        parser.error("choose --dry-run or --apply, not both")
    try:
        return run(args)
    except Exception as exc:
        print(f"award analytics failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
