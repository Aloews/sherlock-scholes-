import unittest
from datetime import date

from award_analytics import aggregate_player_seasons, rank_candidates


class AwardAnalyticsTests(unittest.TestCase):
    def test_aggregates_competitions_without_losing_club_rows(self):
        rows = [
            {"card_id": "a", "apps": 10, "minutes": 800, "goals": 5, "assists": 2, "team_goals": 20, "opponent_goals": 8, "fetched_at": "2026-10-01"},
            {"card_id": "a", "apps": 5, "minutes": 400, "goals": 3, "assists": 1, "team_goals": 12, "opponent_goals": 4, "fetched_at": "2026-10-02"},
        ]
        result = aggregate_player_seasons(rows)["a"]
        self.assertEqual(result["apps"], 15)
        self.assertEqual(result["goals"], 8)
        self.assertEqual(result["assists"], 3)
        self.assertEqual(result["minutes"], 1200)
        self.assertEqual(result["stat_rows"], 2)
        self.assertEqual(result["fetched_at"], "2026-10-02")

    def test_golden_boy_enforces_age_and_minimum_sample(self):
        cards = [
            {"id": "young", "name": "Young", "born_on": "2005-01-01", "fame": 50},
            {"id": "old", "name": "Old", "born_on": "2000-01-01", "fame": 90},
            {"id": "few", "name": "Few", "born_on": "2007-01-01", "fame": 99},
        ]
        stats = {
            "young": {"apps": 20, "minutes": 1500, "goals": 8, "assists": 5, "goal_contributions": 13, "goals_per_90": .48, "contributions_per_90": .78, "team_goal_diff_per_app": .8, "fetched_at": "2026-10-01"},
            "old": {"apps": 30, "minutes": 2500, "goals": 10, "assists": 10, "goal_contributions": 20, "goals_per_90": .36, "contributions_per_90": .72, "team_goal_diff_per_app": 1.0, "fetched_at": "2026-10-01"},
            "few": {"apps": 4, "minutes": 250, "goals": 3, "assists": 1, "goal_contributions": 4, "goals_per_90": 1.08, "contributions_per_90": 1.44, "team_goal_diff_per_app": 1.0, "fetched_at": "2026-10-01"},
        }
        ranked = rank_candidates(cards, stats, award_key="golden_boy", season_id=2026, snapshot_date=date(2026, 10, 27))
        self.assertEqual([row["card_id"] for row in ranked], ["young"])
        self.assertFalse(ranked[0]["evidence"]["score_is_probability"])

    def test_missing_data_reduces_coverage_and_does_not_fake_inputs(self):
        cards = [{"id": "p", "name": "Player", "born_on": None, "fame": None, "market_value_eur": None}]
        stats = {"p": {"apps": 8, "minutes": 600, "goals": 2, "assists": 1, "goal_contributions": 3, "goals_per_90": .3, "contributions_per_90": .45, "team_goal_diff_per_app": None, "fetched_at": None}}
        ranked = rank_candidates(cards, stats, award_key="ballon_dor", season_id=2026, snapshot_date=date(2026, 10, 27))
        self.assertEqual(len(ranked), 1)
        self.assertLess(ranked[0]["data_coverage"], 1)
        self.assertNotIn("recognition", ranked[0]["score_components"])
        self.assertEqual(ranked[0]["confidence"], "medium")


if __name__ == "__main__":
    unittest.main()
