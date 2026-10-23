#!/usr/bin/env python3
"""Synthetic regression coverage for market de-vigging, calibration and walk-forward splits."""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from market_express_model import (  # noqa: E402
    apply_platt, calibrated_outcomes, fit_platt, legacy_h2h_rows, probability_metrics, settled_examples, train_market_model,
)


def quote_rows():
    rows = []
    base = date(2025, 1, 1)
    for i in range(120):
        fid = f"fixture-{i:03d}"
        kickoff = (base + timedelta(days=i)).isoformat() + "T15:00:00Z"
        taken = (base + timedelta(days=i)).isoformat() + "T10:00:00Z"
        fixture = {"commence_at": kickoff, "sport_key": "soccer_test"}
        market_outcomes = {
            "h2h": [("home", 2.1, 0), ("draw", 3.3, 0), ("away", 3.6, 0)],
            "totals": [("over", 1.9, 2.5), ("under", 1.95, 2.5)],
            "spreads": [("home", 1.9, -0.5), ("away", 1.95, 0.5)],
            "btts": [("yes", 1.9, 0), ("no", 1.95, 0)],
        }
        winners = {
            "h2h": ("home", "draw", "away")[i % 3],
            "totals": ("over", "under")[i % 2],
            "spreads": ("home", "away")[i % 2],
            "btts": ("yes", "no")[i % 2],
        }
        for market, outcomes in market_outcomes.items():
            for outcome, price, point in outcomes:
                rows.append({
                    "fixture_id": fid, "taken_at": taken, "provider": "test",
                    "bookmaker": "book", "region": "eu", "market_key": market,
                    "outcome_key": outcome, "point": point, "price": price,
                    "settlement_status": "won" if outcome == winners[market] else "lost",
                    "fixtures": fixture,
                })
    return rows


legacy = legacy_h2h_rows([{
    "fixture_id": "legacy-1", "taken_at": "2025-02-01T10:00:00Z",
    "bookmaker": "legacy-book", "home_price": 2.0, "draw_price": 3.0, "away_price": 4.0,
    "fixtures": {"commence_at": "2025-02-01T15:00:00Z", "sport_key": "soccer_test",
                 "home_score": 2, "away_score": 0, "completed": True,
                 "scores_at": "2025-02-01T17:00:00Z"},
}])
assert len(legacy) == 3 and sum(r["settlement_status"] == "won" for r in legacy) == 1
rows = quote_rows()
examples = settled_examples(rows)
assert len(examples) == 120 * (3 + 2 + 2 + 2), len(examples)
h2h = [e for e in examples if e["fixture_id"] == "fixture-000" and e["market"] == "h2h"]
assert abs(sum(e["raw_prob"] for e in h2h) - 1.0) < 1e-9
calibrators = {market: {"a": 1.0, "b": 0.0} for market in ("h2h", "totals", "spreads", "btts")}
normalized = calibrated_outcomes(examples, calibrators)
groups = {}
for row in normalized:
    key = (row["fixture_id"], row["market"], row["line"], row["provider"], row["bookmaker"], row["region"])
    groups[key] = groups.get(key, 0.0) + row["prob"]
assert groups and all(abs(total - 1.0) < 1e-9 for total in groups.values())
a, b = fit_platt([e["raw_prob"] for e in examples], [e["label"] for e in examples])
assert 0.0 < apply_platt(0.5, a, b) < 1.0
metrics = probability_metrics([0.2, 0.8], [0.0, 1.0])
assert metrics["n"] == 2 and metrics["brier"] >= 0
model = train_market_model(rows, min_fixtures=100)
assert set(model["markets"]) == {"h2h", "totals", "spreads", "btts"}, model["markets"]
assert model["express_holdout"]["3"]["tickets"] >= 0
print("ok: market quotes de-vigged, calibrated chronologically and evaluated at express level")
