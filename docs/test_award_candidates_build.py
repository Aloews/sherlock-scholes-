import unittest

from award_candidates_build import normal_key, normalize_base_url, percentile, score_population
from datetime import date


class CandidateRankingTests(unittest.TestCase):

    def test_normalize_supabase_url_removes_accidental_escape_and_trailing_slash(self):
        self.assertEqual(normalize_base_url("\\\\https://project.supabase.co/"), "https://project.supabase.co")

    def test_normalize_supabase_url_rejects_non_absolute_url(self):
        with self.assertRaises(ValueError):
            normalize_base_url("project.supabase.co")

    def test_percentile_is_monotonic(self):
        values = [10.0, 30.0, 20.0]
        ranks = percentile(values)
        self.assertLess(ranks[0], ranks[2])
        self.assertLess(ranks[2], ranks[1])

    def test_percentile_ties_share_the_same_midrank(self):
        ranks = percentile([5.0, 5.0, 10.0])
        self.assertEqual(ranks[0], ranks[1])
        self.assertGreater(ranks[2], ranks[0])
        self.assertTrue(all(0 <= rank <= 100 for rank in ranks))

    def test_single_candidate_gets_neutral_percentile(self):
        self.assertEqual(percentile([99.0]), [50.0])

    def test_empty_population_is_safe(self):
        self.assertEqual(percentile([]), [])


    def test_award_ranking_returns_explainable_relative_score_not_probability(self):
        players = [
            {"card_id": "a", "name": "Player A", "category": "player", "active": True,
             "apps": 20, "starts": 18, "minutes": 1600, "goals": 18, "assists": 7,
             "team_win_rate": .7, "sw_rating": 90, "market_value_eur": 100000000,
             "age": 24, "stats_rows": 3, "last_fetched": "2026-10-26T00:00:00Z"},
            {"card_id": "b", "name": "Player B", "category": "player", "active": True,
             "apps": 15, "starts": 12, "minutes": 1100, "goals": 5, "assists": 3,
             "team_win_rate": .5, "sw_rating": None, "market_value_eur": 10000000,
             "age": 25, "stats_rows": 2, "last_fetched": "2026-10-25T00:00:00Z"},
        ]
        rows = score_population(players, {"goals": .7, "assists": .3},
                                "golden_boot", 2026, date(2026, 10, 27), "competition-1")
        self.assertEqual(rows[0]["card_id"], "a")
        self.assertEqual(rows[0]["candidate_rank"], 1)
        self.assertEqual(rows[0]["competition_id"], "competition-1")
        self.assertFalse(rows[0]["evidence"]["score_is_probability"])
        self.assertEqual(rows[0]["evidence"]["ranking_scope"], "tracked competition competition-1")

    def test_golden_boy_only_includes_eligible_male_cards(self):
        players = [
            {"card_id": "young", "name": "Young", "category": "player", "active": True,
             "apps": 10, "starts": 8, "minutes": 700, "goals": 3, "assists": 2,
             "team_win_rate": .5, "sw_rating": 75, "age": 20, "stats_rows": 2},
            {"card_id": "old", "name": "Old", "category": "player", "active": True,
             "apps": 20, "starts": 18, "minutes": 1500, "goals": 10, "assists": 6,
             "team_win_rate": .7, "sw_rating": 90, "age": 22, "stats_rows": 2},
            {"card_id": "young-woman", "name": "Young Woman", "category": "woman", "active": True,
             "apps": 20, "starts": 18, "minutes": 1500, "goals": 10, "assists": 6,
             "team_win_rate": .7, "sw_rating": 90, "age": 19, "stats_rows": 2},
        ]
        rows = score_population(players, {"goals": .5, "assists": .5},
                                "golden_boy", 2026, date(2026, 10, 27))
        self.assertEqual([row["card_id"] for row in rows], ["young"])

    def test_team_key_is_stable_and_url_safe(self):
        self.assertEqual(normal_key("Manchester City"), "manchester-city")
        self.assertEqual(normal_key("ПСЖ"), "псж")
        self.assertEqual(normal_key("AFC / Team 2"), "afc-team-2")


if __name__ == "__main__":
    unittest.main()
