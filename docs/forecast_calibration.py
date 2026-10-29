#!/usr/bin/env python3
"""Leakage-safe walk-forward calibration for award and team-tournament rankings.

The candidate score is not a probability. This module fits a per-forecast Platt
calibrator only from outcomes announced before the target snapshot. It refuses
to emit probabilities when historical evidence is insufficient.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

MODEL_VERSION = "walk-forward-platt-v1"
MIN_TRAIN_WINNERS = 5
MIN_TRAIN_SEASONS = 3
PAGE_SIZE = 1000
WIN_RESULTS = {"winner", "champion", "1st", "first place", "1st place"}


def parse_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def sigmoid(value: float) -> float:
    if value >= 35:
        return 1.0 - 1e-15
    if value <= -35:
        return 1e-15
    return 1.0 / (1.0 + math.exp(-value))


def _score(row: dict[str, Any]) -> float:
    try:
        return min(100.0, max(0.0, float(row.get("candidate_score") or 0.0))) / 100.0
    except (TypeError, ValueError):
        return 0.0


def fit_platt(examples: list[dict[str, Any]], min_winners: int = MIN_TRAIN_WINNERS,
              min_seasons: int = MIN_TRAIN_SEASONS) -> dict[str, Any]:
    """Fit regularized logistic calibration; never silently falls back to raw scores."""
    winners = sum(int(e["label"]) for e in examples)
    seasons = {str(e["season"]) for e in examples}
    if winners < min_winners or len(seasons) < min_seasons or winners == len(examples):
        return {"status": "insufficient_training", "n": len(examples),
                "winners": winners, "seasons": len(seasons)}
    prevalence = min(0.99, max(0.01, winners / len(examples)))
    intercept, slope = math.log(prevalence / (1 - prevalence)), 0.0
    # Batch gradient descent on binary cross-entropy with a small slope penalty.
    for _ in range(2500):
        grad_a = grad_b = 0.0
        for row in examples:
            x, y = _score(row), int(row["label"])
            error = sigmoid(intercept + slope * x) - y
            grad_a += error
            grad_b += error * x
        grad_a /= len(examples)
        grad_b = grad_b / len(examples) + 0.01 * slope
        next_a = intercept - 0.2 * grad_a
        next_b = slope - 0.2 * grad_b
        if abs(next_a - intercept) + abs(next_b - slope) < 1e-10:
            intercept, slope = next_a, next_b
            break
        intercept, slope = next_a, next_b
    return {"status": "ready", "intercept": intercept, "slope": slope,
            "n": len(examples), "winners": winners, "seasons": len(seasons)}


def predict(model: dict[str, Any], row: dict[str, Any]) -> float | None:
    if model.get("status") != "ready":
        return None
    return round(sigmoid(model["intercept"] + model["slope"] * _score(row)), 8)


def score_metrics(rows: list[dict[str, Any]]) -> dict[str, float | int | None]:
    if not rows:
        return {"n": 0, "brier": None, "log_loss": None, "ece": None, "top_1_accuracy": None}
    brier = 0.0
    log_loss = 0.0
    bins = [[] for _ in range(10)]
    for row in rows:
        p = min(1 - 1e-15, max(1e-15, float(row["probability"])))
        y = int(row["label"])
        brier += (p - y) ** 2
        log_loss -= y * math.log(p) + (1 - y) * math.log(1 - p)
        bins[min(9, int(p * 10))].append((p, y))
    ece = sum(len(bucket) / len(rows) * abs(
        sum(p for p, _ in bucket) / len(bucket) - sum(y for _, y in bucket) / len(bucket)
    ) for bucket in bins if bucket)
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["group_key"])].append(row)
    top1 = sum(
        int(any(r["label"] for r in sorted(group, key=lambda x: x["probability"], reverse=True)[:1]))
        for group in grouped.values()
    ) / len(grouped)
    n = len(rows)
    return {"n": n, "brier": round(brier / n, 6), "log_loss": round(log_loss / n, 6),
            "ece": round(ece, 6), "top_1_accuracy": round(top1, 6)}


def _winner(result: Any) -> bool:
    return str(result or "").strip().casefold().replace("_", " ") in WIN_RESULTS


def build_award_groups(snapshots: list[dict], outcomes: list[dict]) -> list[dict]:
    grouped_outcomes: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for outcome in outcomes:
        key = (str(outcome.get("award_key") or ""), str(outcome.get("award_year") or ""),
               str(outcome.get("competition_id") or "*"))
        grouped_outcomes[key].append(outcome)
    groups = []
    for key, records in grouped_outcomes.items():
        announced = [parse_time(r.get("announced_at")) for r in records]
        announced = [t for t in announced if t is not None]
        if not announced:
            continue
        announced_at = max(announced)
        winners = {str(r.get("card_id")) for r in records if _winner(r.get("result")) and r.get("card_id")}
        if not winners:
            continue
        eligible = [r for r in snapshots if
            str(r.get("award_key") or "") == key[0]
            and str(r.get("season_id") or "") == key[1]
            and str(r.get("competition_id") or "*") == key[2]
            and (parse_date(r.get("snapshot_date")) is not None)
            and parse_date(r.get("snapshot_date")) < announced_at.date()]
        if not eligible:
            continue
        snap_date = max(parse_date(r["snapshot_date"]) for r in eligible)
        rows = [dict(r) for r in eligible if parse_date(r["snapshot_date"]) == snap_date]
        for row in rows:
            row["label"] = int(str(row.get("card_id")) in winners)
        groups.append({"kind": "award", "forecast_key": "|".join(key), "season": key[1],
                       "snapshot_date": snap_date.isoformat(), "announced_at": announced_at.isoformat(),
                       "rows": rows, "winners": len(winners)})
    return sorted(groups, key=lambda g: g["announced_at"])


def build_team_groups(snapshots: list[dict], outcomes: list[dict]) -> list[dict]:
    grouped_outcomes: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for outcome in outcomes:
        grouped_outcomes[(str(outcome.get("tournament") or ""), str(outcome.get("season_start") or ""))].append(outcome)
    groups = []
    for key, records in grouped_outcomes.items():
        announced = [parse_time(r.get("announced_at")) for r in records]
        announced = [t for t in announced if t is not None]
        if not announced:
            continue
        announced_at = max(announced)
        winners = {str(r.get("team_key")) for r in records if _winner(r.get("result")) and r.get("team_key")}
        if not winners:
            continue
        eligible = [r for r in snapshots if
            str(r.get("tournament") or "") == key[0]
            and str(r.get("season_start") or "") == key[1]
            and parse_date(r.get("snapshot_date")) is not None
            and parse_date(r.get("snapshot_date")) < announced_at.date()]
        if not eligible:
            continue
        snap_date = max(parse_date(r["snapshot_date"]) for r in eligible)
        rows = [dict(r) for r in eligible if parse_date(r["snapshot_date"]) == snap_date]
        for row in rows:
            row["label"] = int(str(row.get("team_key")) in winners)
        groups.append({"kind": "team_tournament", "forecast_key": "|".join(key), "season": key[1],
                       "snapshot_date": snap_date.isoformat(), "announced_at": announced_at.isoformat(),
                       "rows": rows, "winners": len(winners)})
    return sorted(groups, key=lambda g: g["announced_at"])


def examples(groups: list[dict]) -> list[dict]:
    return [{"candidate_score": row.get("candidate_score"), "label": row["label"], "season": group["season"]}
            for group in groups for row in group["rows"]]


def walk_forward(groups: list[dict]) -> dict[str, Any]:
    """Evaluate each season only against outcomes already announced before its snapshot."""
    reports = []
    all_predictions = []
    for target in groups:
        snapshot_date = parse_date(target["snapshot_date"])
        target_parts = target["forecast_key"].split("|")
        if target["kind"] == "award":
            same_forecast = [g for g in groups if g["forecast_key"].split("|")[0] == target_parts[0]
                             and g["forecast_key"].split("|")[-1] == target_parts[-1]]
        else:
            same_forecast = [g for g in groups if g["forecast_key"].split("|")[0] == target_parts[0]]
        train_groups = [g for g in same_forecast if parse_time(g["announced_at"]) is not None
                        and parse_time(g["announced_at"]).date() < snapshot_date]
        model = fit_platt(examples(train_groups))
        if model["status"] != "ready":
            reports.append({"forecast_key": target["forecast_key"], "snapshot_date": target["snapshot_date"],
                        "outcome_announced_at": target["announced_at"],
                        "status": model["status"], "training_examples": model["n"],
                        "training_winners": model["winners"], "training_seasons": model["seasons"],
                        "evaluation_candidates": len(target["rows"])})
            continue
        predicted = []
        for row in target["rows"]:
            p = predict(model, row)
            if p is not None:
                predicted.append({"probability": p, "label": row["label"],
                                  "group_key": target["forecast_key"]})
        all_predictions.extend(predicted)
        reports.append({"forecast_key": target["forecast_key"], "snapshot_date": target["snapshot_date"],
                        "outcome_announced_at": target["announced_at"],
                        "status": "evaluated", "training_examples": model["n"],
                        "training_winners": model["winners"], "training_seasons": model["seasons"],
                        "evaluation_candidates": len(target["rows"]), "metrics": score_metrics(predicted)})
    return {"model_version": MODEL_VERSION, "groups": len(groups), "evaluated_groups": sum(
        r["status"] == "evaluated" for r in reports), "metrics": score_metrics(all_predictions), "reports": reports}


def current_predictions(snapshots: list[dict], groups: list[dict], kind: str) -> tuple[list[dict], dict]:
    if not snapshots:
        return [], {"status": "no_snapshots", "probabilities_written": 0}
    key_fields = ("award_key", "season_id", "competition_id") if kind == "award" else ("tournament", "season_start")
    grouped: dict[tuple[str, ...], list[dict]] = defaultdict(list)
    for row in snapshots:
        grouped[tuple(str(row.get(k) or ("*" if k == "competition_id" else "")) for k in key_fields)].append(row)
    outputs, statuses = [], []
    for key, rows in grouped.items():
        snap_dates = [parse_date(r.get("snapshot_date")) for r in rows]
        snap_date = max(d for d in snap_dates if d is not None) if any(snap_dates) else None
        if not snap_date:
            continue
        current_rows = [r for r in rows if parse_date(r.get("snapshot_date")) == snap_date]
        forecast_key = "|".join(key)
        if kind == "award":
            matching = [g for g in groups if g["forecast_key"].split("|")[0] == key[0]
                        and g["forecast_key"].split("|")[-1] == key[-1]]
        else:
            matching = [g for g in groups if g["forecast_key"].split("|")[0] == key[0]]
        train_groups = [g for g in matching if parse_time(g["announced_at"]).date() < snap_date]
        model = fit_platt(examples(train_groups))
        statuses.append({"forecast_key": forecast_key, "snapshot_date": snap_date.isoformat(),
                         "status": model["status"], "training_examples": model["n"],
                         "training_winners": model["winners"], "training_seasons": model["seasons"]})
        for row in current_rows:
            p = predict(model, row)
            payload = {"kind": kind, "forecast_key": forecast_key,
                       "snapshot_date": snap_date.isoformat(),
                       "card_id": row.get("card_id"), "team_key": row.get("team_key"),
                       "probability": p, "training_examples": model["n"],
                       "calibration_status": model["status"], "model_version": MODEL_VERSION}
            if kind == "award":
                payload.update({"award_key": key[0], "season_id": int(key[1]), "competition_id": key[2]})
            else:
                payload.update({"tournament": key[0], "season_start": key[1]})
            outputs.append(payload)
    return outputs, {"groups": statuses, "probabilities_written": sum(x["probability"] is not None for x in outputs)}


def api_rows(base: str, key: str, table: str, select: str) -> list[dict]:
    rows, offset = [], 0
    while True:
        response = requests.get(f"{base.rstrip('/')}/rest/v1/{table}",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            params={"select": select, "order": "snapshot_date.asc", "limit": PAGE_SIZE, "offset": offset},
            timeout=45)
        response.raise_for_status()
        page = response.json()
        if not isinstance(page, list):
            raise RuntimeError(f"Unexpected response from {table}")
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def load_production_data() -> dict[str, list[dict]]:
    load_dotenv()
    base = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")
    if not base or not key:
        raise RuntimeError("SUPABASE_URL and a read-authorized Supabase key are required")
    return {
        "award_snapshots": api_rows(base, key, "award_candidate_snapshot",
            "award_key,season_id,snapshot_date,card_id,competition_id,candidate_score,candidate_rank,model_version"),
        "award_outcomes": api_rows(base, key, "award_outcome",
            "award_key,award_year,card_id,result,announced_at,competition_id,source_url"),
        "team_snapshots": api_rows(base, key, "team_tournament_candidate_snapshot",
            "tournament,season_start,snapshot_date,team_key,candidate_score,candidate_rank,model_version"),
        "team_outcomes": api_rows(base, key, "team_tournament_outcome",
            "tournament,season_start,team_key,result,announced_at,source_url"),
    }



def persist_report(report: dict[str, Any], predictions: list[dict[str, Any]]) -> None:
    """Persist calibrated probabilities and walk-forward evaluation rows."""
    load_dotenv()
    base = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not base or not key:
        raise RuntimeError("--persist requires SUPABASE_URL and service-role SUPABASE_KEY")
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    response = requests.post(f"{base.rstrip('/')}/rest/v1/rpc/apply_forecast_calibration",
                             headers=headers, json={"p_rows": predictions}, timeout=60)
    if not response.ok:
        raise RuntimeError(f"apply_forecast_calibration failed: HTTP {response.status_code}: {response.text[:500]}")
    ledger = []
    for kind, section in (("award", report["individual_awards"]["backtest"]),
                          ("team_tournament", report["team_tournaments"]["backtest"])):
        for item in section["reports"]:
            metrics = item.get("metrics") or {}
            announced = parse_time(item.get("outcome_announced_at"))
            if announced is None:
                continue
            ledger.append({
                "forecast_kind": kind, "forecast_key": item["forecast_key"],
                "evaluation_snapshot_date": item["snapshot_date"],
                "outcome_announced_at": announced.isoformat(),
                "training_cutoff": item["snapshot_date"] + "T00:00:00+00:00",
                "training_examples": item.get("training_examples", 0),
                "training_winners": item.get("training_winners", 0),
                "training_seasons": item.get("training_seasons", 0),
                "evaluation_candidates": item.get("evaluation_candidates", 0),
                "brier_score": metrics.get("brier"), "log_loss": metrics.get("log_loss"),
                "expected_calibration_error": metrics.get("ece"),
                "top_1_accuracy": metrics.get("top_1_accuracy"),
                "status": item["status"], "model_version": MODEL_VERSION, "report": item,
            })
    if ledger:
        result = requests.post(f"{base.rstrip('/')}/rest/v1/forecast_calibration_evaluation",
            headers={**headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
            params={"on_conflict": "forecast_kind,forecast_key,evaluation_snapshot_date,outcome_announced_at,model_version"},
            json=ledger, timeout=60)
        if not result.ok:
            raise RuntimeError(f"calibration evaluation write failed: HTTP {result.status_code}: {result.text[:500]}")

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-json", help="Use a fixture JSON instead of querying Supabase")
    parser.add_argument("--output", default="forecast-calibration-report.json")
    parser.add_argument("--persist", action="store_true",
                        help="write probabilities and evaluation rows; requires migration and SUPABASE_KEY")
    args = parser.parse_args()
    data = json.loads(Path(args.input_json).read_text(encoding="utf-8")) if args.input_json else load_production_data()
    award_groups = build_award_groups(data.get("award_snapshots", []), data.get("award_outcomes", []))
    team_groups = build_team_groups(data.get("team_snapshots", []), data.get("team_outcomes", []))
    award_report = walk_forward(award_groups)
    team_report = walk_forward(team_groups)
    award_predictions, award_current = current_predictions(data.get("award_snapshots", []), award_groups, "award")
    team_predictions, team_current = current_predictions(data.get("team_snapshots", []), team_groups, "team_tournament")
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_version": MODEL_VERSION,
        "policy": {"temporal_cutoff": "outcome announced strictly before prediction snapshot",
                   "insufficient_evidence": "no probability emitted; raw candidate score is never used as probability",
                   "min_train_winners": MIN_TRAIN_WINNERS, "min_train_seasons": MIN_TRAIN_SEASONS},
        "individual_awards": {"backtest": award_report, "current": award_current, "predictions": award_predictions},
        "team_tournaments": {"backtest": team_report, "current": team_current, "predictions": team_predictions},
    }
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.persist:
        persist_report(report, award_predictions + team_predictions)
    print(json.dumps({
        "output": args.output,
        "award_groups": len(award_groups),
        "award_evaluated_groups": award_report["evaluated_groups"],
        "award_current_probabilities": award_current["probabilities_written"],
        "team_groups": len(team_groups),
        "team_evaluated_groups": team_report["evaluated_groups"],
        "team_current_probabilities": team_current["probabilities_written"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
