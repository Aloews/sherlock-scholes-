import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from evaluate_forecasts import evaluate


class ForecastEvaluationTests(unittest.TestCase):
    def test_perfect_forecasts(self):
        result = evaluate([
            {"actual": "home", "probabilities": {"home": 0.9, "draw": 0.05, "away": 0.05}},
            {"actual": "away", "probabilities": {"home": 0.05, "draw": 0.05, "away": 0.9}},
        ])
        self.assertEqual(result["n"], 2)
        self.assertEqual(result["accuracy"], 1.0)
        self.assertLess(result["log_loss"], 0.2)
        self.assertLess(result["multiclass_brier_score"], 0.02)

    def test_rejects_invalid_probability_sum(self):
        with self.assertRaises(ValueError):
            evaluate([{"actual": "draw", "probabilities": {"home": 0.4, "draw": 0.4, "away": 0.4}}])

    def test_rejects_missing_probability(self):
        with self.assertRaises(ValueError):
            evaluate([{"actual": "home", "probabilities": {"home": 1.0, "draw": 0.0}}])


if __name__ == "__main__":
    unittest.main()
