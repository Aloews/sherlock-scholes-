#!/usr/bin/env python3
"""Regression test for the scheduled forecast pipeline's feature imports."""
import os
import sys

import numpy as np
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import forecast_pipeline as pipeline  # noqa: E402
from forecast_winner import LIN_FEATURES  # noqa: E402

row = {name: 1.0 for name in LIN_FEATURES}
row.update({
    "h_gf": 1.4, "h_ga": 0.8, "a_gf": 1.1, "a_ga": 1.2,
    "h_dr": 0.2, "a_dr": 0.3,
})
params = {"features": list(LIN_FEATURES), "W": np.zeros((len(LIN_FEATURES) + 2, 3)).tolist()}
pick, confidence, expected_total = pipeline.llm_call(params, row)
assert pick in {"H", "D", "A"}, pick
assert 0.0 <= confidence <= 1.0, confidence
assert expected_total >= 0.0, expected_total
print("ok: forecast pipeline models produce valid predictions")

# Calibration must cover exactly the active H/D/A forecast models.
assert pipeline.MODELS == ("llm", "own"), pipeline.MODELS
graded_rows = [
    {"model": "llm", "confidence": 0.8, "correct": True, "commence_at": "2026-01-01T00:00:00Z"},
    {"model": "own", "confidence": 0.7, "correct": False, "commence_at": "2026-01-02T00:00:00Z"},
]
metrics = {
    "a": 1.0, "b": 0.0, "trained_on": 1, "tested_on": 1,
    "brier_raw": 0.25, "brier_cal": 0.2, "brier_const": 0.25,
}
with patch.object(pipeline, "_fetch", return_value=graded_rows), \
     patch.object(pipeline, "evaluate", return_value=metrics), \
     patch.object(pipeline, "_write") as write:
    calibrated = pipeline.step_calibrate("https://example.supabase.co", "test-key")
assert calibrated == 2, calibrated
payload = write.call_args.args[3]
assert {row["model"] for row in payload} == {"llm", "own"}, payload
print("ok: forecast calibration runs for active models only")
