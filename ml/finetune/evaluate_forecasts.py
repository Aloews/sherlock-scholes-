#!/usr/bin/env python3
"""Evaluate 1X2 forecast probabilities on a strictly held-out temporal set."""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import sys

OUTCOMES = ("home", "draw", "away")


def evaluate(rows: list[dict]) -> dict:
    if not rows:
        raise ValueError("evaluation dataset is empty")
    log_loss = 0.0
    brier = 0.0
    correct = 0
    calibration = [{"lower": i / 10, "upper": (i + 1) / 10, "count": 0,
                    "mean_confidence": 0.0, "accuracy": 0.0} for i in range(10)]
    for index, row in enumerate(rows, 1):
        actual = row.get("actual")
        probs = row.get("probabilities")
        if actual not in OUTCOMES or not isinstance(probs, dict):
            raise ValueError(f"row {index}: actual must be home/draw/away and probabilities an object")
        values = [float(probs.get(outcome, -1)) for outcome in OUTCOMES]
        if any(not math.isfinite(p) or p < 0 or p > 1 for p in values):
            raise ValueError(f"row {index}: probabilities must be finite and within [0,1]")
        if abs(sum(values) - 1.0) > 0.02:
            raise ValueError(f"row {index}: probabilities must sum to 1 within 0.02")
        values = [p / sum(values) for p in values]
        actual_index = OUTCOMES.index(actual)
        log_loss -= math.log(max(values[actual_index], 1e-15))
        brier += sum((p - (1.0 if j == actual_index else 0.0)) ** 2 for j, p in enumerate(values))
        predicted_index = max(range(3), key=lambda j: values[j])
        is_correct = predicted_index == actual_index
        correct += int(is_correct)
        confidence = values[predicted_index]
        bin_index = min(9, int(confidence * 10))
        bucket = calibration[bin_index]
        bucket["count"] += 1
        bucket["mean_confidence"] += confidence
        bucket["accuracy"] += int(is_correct)
    for bucket in calibration:
        if bucket["count"]:
            bucket["mean_confidence"] /= bucket["count"]
            bucket["accuracy"] /= bucket["count"]
    n = len(rows)
    return {
        "n": n,
        "accuracy": correct / n,
        "log_loss": log_loss / n,
        "multiclass_brier_score": brier / n,
        "calibration_by_max_probability": calibration,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    try:
        rows = [json.loads(line) for line in args.input.read_text(encoding="utf-8").splitlines() if line.strip()]
        result = evaluate(rows)
        rendered = json.dumps(result, indent=2)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered + "\n", encoding="utf-8")
        print(rendered)
        return 0
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"forecast evaluation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
