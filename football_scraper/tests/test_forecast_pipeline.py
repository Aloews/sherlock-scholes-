#!/usr/bin/env python3
"""Regression tests for the active forecast pipeline and historical model policy."""
import os
import sys

import numpy as np

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
assert pipeline.MODELS == ("llm", "own"), pipeline.MODELS
assert not hasattr(pipeline, "FlyBrain")
assert not hasattr(pipeline, "step_dopamine")
print("ok: active forecast pipeline excludes the connectome model and retains llm/own")
