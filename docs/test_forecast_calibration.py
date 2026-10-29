import unittest
from forecast_calibration import (
    build_award_groups, build_team_groups, fit_platt, predict, score_metrics, walk_forward
)


class ForecastCalibrationTests(unittest.TestCase):
    def test_missing_announcement_timestamp_is_not_used_for_training(self):
        snapshots = [{"award_key": "ballon_dor", "season_id": 2024, "competition_id": "*",
                      "snapshot_date": "2024-08-01", "card_id": "winner", "candidate_score": 90}]
        outcomes = [{"award_key": "ballon_dor", "award_year": 2024, "competition_id": "*",
                     "card_id": "winner", "result": "winner", "announced_at": None}]
        self.assertEqual(build_award_groups(snapshots, outcomes), [])

    def test_snapshot_after_outcome_is_excluded_to_prevent_leakage(self):
        snapshots = [{"award_key": "ballon_dor", "season_id": 2024, "competition_id": "*",
                      "snapshot_date": "2024-12-01", "card_id": "winner", "candidate_score": 90}]
        outcomes = [{"award_key": "ballon_dor", "award_year": 2024, "competition_id": "*",
                     "card_id": "winner", "result": "winner", "announced_at": "2024-11-01T12:00:00Z"}]
        self.assertEqual(build_award_groups(snapshots, outcomes), [])

    def test_team_outcomes_require_a_pre_announcement_snapshot(self):
        snapshots = [{"tournament": "League", "season_start": "2024-08-01",
                      "snapshot_date": "2025-05-01", "team_key": "a", "candidate_score": 90}]
        outcomes = [{"tournament": "League", "season_start": "2024-08-01",
                     "team_key": "a", "result": "winner", "announced_at": "2025-05-20T10:00:00Z"}]
        groups = build_team_groups(snapshots, outcomes)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["rows"][0]["label"], 1)

    def test_calibrator_refuses_insufficient_history(self):
        model = fit_platt([
            {"candidate_score": 95, "label": 1, "season": "2024"},
            {"candidate_score": 40, "label": 0, "season": "2024"},
        ])
        self.assertEqual(model["status"], "insufficient_training")
        self.assertIsNone(predict(model, {"candidate_score": 99}))

    def test_calibrator_outputs_probabilities_inside_unit_interval(self):
        examples = []
        for season in range(2018, 2024):
            examples.extend([
                {"candidate_score": 95, "label": 1, "season": str(season)},
                {"candidate_score": 70, "label": 0, "season": str(season)},
                {"candidate_score": 25, "label": 0, "season": str(season)},
                {"candidate_score": 10, "label": 0, "season": str(season)},
            ])
        model = fit_platt(examples)
        self.assertEqual(model["status"], "ready")
        p = predict(model, {"candidate_score": 95})
        self.assertGreater(p, 0)
        self.assertLess(p, 1)

    def test_metrics_are_computed_from_predictions_not_raw_scores(self):
        metrics = score_metrics([
            {"probability": 0.8, "label": 1, "group_key": "a"},
            {"probability": 0.2, "label": 0, "group_key": "a"},
        ])
        self.assertEqual(metrics["n"], 2)
        self.assertAlmostEqual(metrics["brier"], 0.04)
        self.assertEqual(metrics["top_1_accuracy"], 1.0)

    def test_walk_forward_does_not_train_on_target_or_future_outcomes(self):
        groups = []
        for season in range(2018, 2024):
            announced = f"{season}-12-15T12:00:00+00:00"
            groups.append({"kind": "award", "forecast_key": "ballon_dor|"+str(season)+"|*",
                           "season": str(season), "snapshot_date": f"{season}-11-01",
                           "announced_at": announced,
                           "rows": [{"candidate_score": 90, "label": 1, "card_id": "winner"},
                                    {"candidate_score": 20, "label": 0, "card_id": "other"}]})
        report = walk_forward(groups)
        self.assertEqual(report["groups"], 6)
        self.assertTrue(all(r["training_winners"] == 0 or r["training_winners"] < 5
                            for r in report["reports"][:5]))


if __name__ == "__main__":
    unittest.main()
