#!/usr/bin/env python3
"""Walk-forward calibration and express-level evaluation of settled market quotes.

This deliberately does not train on unsettled fixtures or backfilled express
tickets. A market is activated only after it has enough distinct settled fixtures.
"""
from __future__ import annotations

import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from forecast_duel import _fetch, _write  # noqa: E402

SUPPORTED_MARKETS = ("h2h", "totals", "spreads", "btts")
MIN_FIXTURES = 100
MIN_HOLDOUT_FIXTURES = 20
MIN_EV = 0.02


def _fixture(row):
    fixture = row.get("fixtures") or {}
    if isinstance(fixture, list):
        fixture = fixture[0] if fixture else {}
    return fixture if isinstance(fixture, dict) else {}


def _line_key(market, point):
    point = float(point or 0.0)
    if market == "spreads":
        point = abs(point)
    if market in ("spreads", "totals"):
        # Avoid push/quarter-line settlement in this binary calibration model.
        twice = round(point * 2)
        if abs(point * 2 - twice) > 1e-6 or abs(point - round(point)) < 1e-6:
            return None
    return round(point, 3) if market in ("spreads", "totals") else 0.0


def settled_examples(rows):
    """Keep each bookmaker's latest pre-match snapshot and remove vig per line."""
    groups = defaultdict(list)
    for row in rows:
        market = row.get("market_key")
        if market not in SUPPORTED_MARKETS:
            continue
        fixture = _fixture(row)
        kickoff = fixture.get("commence_at")
        if not kickoff or not row.get("taken_at"):
            continue
        if row["taken_at"] >= kickoff:
            continue
        line = _line_key(market, row.get("point"))
        if line is None:
            continue
        if row.get("settlement_status") not in ("won", "lost"):
            continue
        key = (row["fixture_id"], market, line, row.get("provider"),
               row.get("bookmaker"), row.get("region"))
        groups[key].append((row, fixture, line))

    examples = []
    for entries in groups.values():
        latest = max(e[0]["taken_at"] for e in entries)
        snapshot = [e for e in entries if e[0]["taken_at"] == latest]
        prices = {}
        for row, fixture, line in snapshot:
            try:
                price = float(row["price"])
            except (TypeError, ValueError):
                continue
            if price > 1 and math.isfinite(price):
                prices[row["outcome_key"]] = (row, fixture, line, price)
        required = 3 if snapshot and snapshot[0][0]["market_key"] == "h2h" else 2
        if len(prices) < required:
            continue
        inverse = {key: 1.0 / value[3] for key, value in prices.items()}
        total = sum(inverse.values())
        if total <= 0:
            continue
        for outcome, (row, fixture, line, price) in prices.items():
            examples.append({
                "fixture_id": row["fixture_id"],
                "commence_at": fixture["commence_at"],
                "sport_key": fixture.get("sport_key") or "",
                "market": row["market_key"],
                "outcome": outcome,
                "line": line,
                "bookmaker": row.get("bookmaker") or "",
                "price": price,
                "raw_prob": inverse[outcome] / total,
                "label": 1.0 if row["settlement_status"] == "won" else 0.0,
                "status": row["settlement_status"],
            })
    return sorted(examples, key=lambda e: (e["commence_at"], e["fixture_id"], e["market"], e["outcome"]))


def fit_platt(probabilities, labels, l2=1.0, iterations=100):
    """Regularized Platt scaling over no-vig implied probabilities."""
    p = np.clip(np.asarray(probabilities, dtype=float), 1e-5, 1 - 1e-5)
    y = np.asarray(labels, dtype=float)
    if len(p) < 20 or len(p) != len(y) or len(np.unique(y)) < 2:
        raise ValueError("insufficient class-balanced settled examples")
    x = np.log(p / (1 - p))
    a, b = 1.0, 0.0
    for _ in range(iterations):
        z = np.clip(a * x + b, -30, 30)
        pred = 1.0 / (1.0 + np.exp(-z))
        err = pred - y
        weight = pred * (1 - pred)
        grad = np.array([np.dot(err, x) + l2 * (a - 1), err.sum() + l2 * b])
        hessian = np.array([
            [np.dot(weight, x * x) + l2, np.dot(weight, x)],
            [np.dot(weight, x), weight.sum() + l2],
        ])
        step = np.linalg.solve(hessian, grad)
        a = float(np.clip(a - step[0], -10, 10))
        b = float(np.clip(b - step[1], -10, 10))
        if float(np.max(np.abs(step))) < 1e-6:
            break
    return a, b


def apply_platt(probability, a, b):
    p = min(1 - 1e-5, max(1e-5, float(probability)))
    z = max(-30.0, min(30.0, a * math.log(p / (1 - p)) + b))
    return 1.0 / (1.0 + math.exp(-z))


def probability_metrics(probabilities, labels):
    p = np.clip(np.asarray(probabilities, dtype=float), 1e-6, 1 - 1e-6)
    y = np.asarray(labels, dtype=float)
    return {
        "n": int(len(y)),
        "brier": round(float(np.mean((p - y) ** 2)), 6),
        "log_loss": round(float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))), 6),
    }


def _fixture_split(examples):
    kickoff_by_fixture = {}
    for row in examples:
        kickoff_by_fixture[row["fixture_id"]] = row["commence_at"]
    ordered = sorted(kickoff_by_fixture, key=lambda fid: (kickoff_by_fixture[fid], fid))
    cut = int(len(ordered) * 0.8)
    return set(ordered[:cut]), set(ordered[cut:])


def express_holdout(examples, calibrators):
    """Chronological holdout: select positive-EV legs, at most one per fixture."""
    best_by_fixture = {}
    for row in examples:
        model = calibrators.get(row["market"])
        if not model:
            continue
        p = apply_platt(row["raw_prob"], model["a"], model["b"])
        ev = p * row["price"] - 1.0
        if ev < MIN_EV:
            continue
        candidate = {**row, "prob": p, "ev": ev}
        prev = best_by_fixture.get(row["fixture_id"])
        if prev is None or (candidate["ev"], candidate["price"]) > (prev["ev"], prev["price"]):
            best_by_fixture[row["fixture_id"]] = candidate
    days = defaultdict(list)
    for row in best_by_fixture.values():
        day = row["commence_at"][:10]
        days[day].append(row)
    results = {}
    for k in (3, 4):
        tickets = hits = 0
        roi = expected = 0.0
        for day_rows in days.values():
            legs = sorted(day_rows, key=lambda r: (r["ev"], r["prob"], r["fixture_id"]), reverse=True)[:k]
            if len(legs) != k:
                continue
            tickets += 1
            expected += math.prod(r["prob"] for r in legs)
            if all(r["label"] == 1 for r in legs):
                hits += 1
                roi += math.prod(r["price"] for r in legs) - 1.0
            else:
                roi -= 1.0
        results[str(k)] = {
            "tickets": tickets,
            "hits": hits,
            "pass_rate": round(hits / tickets, 6) if tickets else None,
            "mean_roi": round(roi / tickets, 6) if tickets else None,
            "mean_expected_pass_probability": round(expected / tickets, 6) if tickets else None,
            "min_ev": MIN_EV,
        }
    return results


def train_market_model(rows, min_fixtures=MIN_FIXTURES):
    examples = settled_examples(rows)
    model_market, skipped = {}, {}
    for market in SUPPORTED_MARKETS:
        market_rows = [e for e in examples if e["market"] == market]
        train_ids, test_ids = _fixture_split(market_rows)
        fixture_count = len(train_ids) + len(test_ids)
        if fixture_count < min_fixtures or len(test_ids) < MIN_HOLDOUT_FIXTURES:
            skipped[market] = {"settled_fixtures": fixture_count, "reason": "insufficient_settled_history"}
            continue
        train = [e for e in market_rows if e["fixture_id"] in train_ids]
        test = [e for e in market_rows if e["fixture_id"] in test_ids]
        try:
            a_hold, b_hold = fit_platt([e["raw_prob"] for e in train], [e["label"] for e in train])
        except (ValueError, np.linalg.LinAlgError) as exc:
            skipped[market] = {"settled_fixtures": fixture_count, "reason": str(exc)}
            continue
        raw_test = [e["raw_prob"] for e in test]
        labels_test = [e["label"] for e in test]
        calibrated_test = [apply_platt(p, a_hold, b_hold) for p in raw_test]
        metrics = {
            "train_fixtures": len(train_ids),
            "holdout_fixtures": len(test_ids),
            "raw": probability_metrics(raw_test, labels_test),
            "calibrated": probability_metrics(calibrated_test, labels_test),
        }
        try:
            a, b = fit_platt([e["raw_prob"] for e in market_rows], [e["label"] for e in market_rows])
        except (ValueError, np.linalg.LinAlgError) as exc:
            skipped[market] = {"settled_fixtures": fixture_count, "reason": str(exc)}
            continue
        model_market[market] = {
            "a": round(a, 8), "b": round(b, 8),
            "settled_fixtures": fixture_count, "trained_examples": len(market_rows),
            "holdout": metrics,
        }
    holdout_rows = []
    holdout_calibrators = {}
    for market in model_market:
        market_rows = [e for e in examples if e["market"] == market]
        train_ids, test_ids = _fixture_split(market_rows)
        train = [e for e in market_rows if e["fixture_id"] in train_ids]
        holdout_rows.extend(e for e in market_rows if e["fixture_id"] in test_ids)
        try:
            a, b = fit_platt([e["raw_prob"] for e in train], [e["label"] for e in train])
            holdout_calibrators[market] = {"a": a, "b": b}
        except (ValueError, np.linalg.LinAlgError):
            pass
    return {
        "version": 1,
        "fitted_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "markets": model_market,
        "skipped": skipped,
        "express_holdout": express_holdout(holdout_rows, holdout_calibrators),
        "data": {"settled_quote_rows": len(rows), "usable_examples": len(examples)},
    }


def main():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("нет SUPABASE_URL / SUPABASE_KEY")
    rows = _fetch(url, key,
        "fixture_market_quotes?select=fixture_id,taken_at,provider,bookmaker,region,market_key,outcome_key,point,price,settlement_status,fixtures!inner(commence_at,sport_key)&settlement_status=not.is.null&order=taken_at.asc,fixture_id.asc,market_key.asc")
    params = train_market_model(rows)
    if not params["markets"]:
        print("market-express: недостаточно подтверждённых settled-котировок; модель не перезаписана")
        print(params["skipped"])
        return 0
    _write(url, key, "forecast_model?on_conflict=id", [{
        "id": "market-express", "params": params, "fitted_at": params["fitted_at"],
    }], method="POST")
    print({"markets_trained": sorted(params["markets"]), "data": params["data"],
           "express_holdout": params["express_holdout"]})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
