import unittest

from award_candidates_build import (build_team_candidate_payloads, competition_format, normal_key, normalize_base_url, percentile, score_population)
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


    def test_team_candidates_cover_every_competition_and_use_stable_team_keys(self):
        matches = [
            {"tournament": "League A", "match_date": "2026-08-01", "home_key": "club-a",
             "away_key": "club-b", "home_team": "Alpha FC", "away_team": "Beta FC",
             "home_score": 2, "away_score": 0, "fetched_at": "2026-10-26T00:00:00Z"},
            {"tournament": "League A", "match_date": "2026-08-08", "home_key": "club-b",
             "away_key": "club-c", "home_team": "Beta FC", "away_team": "Gamma FC",
             "home_score": 1, "away_score": 1, "fetched_at": "2026-10-26T00:00:00Z"},
            {"tournament": "League A", "match_date": "2026-08-15", "home_key": "club-c",
             "away_key": "club-a", "home_team": "Gamma FC", "away_team": "Alpha FC",
             "home_score": 0, "away_score": 3, "fetched_at": "2026-10-26T00:00:00Z"},
            {"tournament": "National Cup", "match_date": "2026-09-01", "home_key": "club-a",
             "away_key": "club-d", "home_team": "Alpha FC", "away_team": "Delta FC",
             "home_score": 1, "away_score": 0, "fetched_at": "2026-10-26T00:00:00Z"},
            {"tournament": "National Cup", "match_date": "2026-09-08", "home_key": "club-d",
             "away_key": "club-e", "home_team": "Delta FC", "away_team": "Epsilon FC",
             "home_score": 2, "away_score": 1, "fetched_at": "2026-10-26T00:00:00Z"},
            {"tournament": "National Cup", "match_date": "2026-09-15", "home_key": "club-e",
             "away_key": "club-a", "home_team": "Epsilon FC", "away_team": "Alpha FC",
             "home_score": 0, "away_score": 2, "fetched_at": "2026-10-26T00:00:00Z"},
        ]
        rows = build_team_candidate_payloads(
            matches,
            {"club-a": {"elo": 1800}, "club-b": {"elo": 1600}, "club-c": {"elo": 1500}},
            date(2026, 10, 27),
        )
        self.assertEqual({row["tournament"] for row in rows}, {"League A", "National Cup"})
        alpha = next(row for row in rows if row["tournament"] == "League A" and row["team_key"] == "club-a")
        self.assertEqual(alpha["team_name"], "Alpha FC")
        self.assertEqual(alpha["candidate_rank"], 1)
        self.assertIn("club_elo_percentile", alpha["score_components"])
        self.assertFalse(alpha["evidence"]["score_is_probability"])
        self.assertEqual(alpha["evidence"]["competition_format"], "league_standings_proxy")
        # A missing rating is unknown, not zero strength.
        delta = next(row for row in rows if row["tournament"] == "National Cup" and row["team_key"] == "club-d")
        self.assertEqual(delta["score_components"]["club_elo_percentile"], 50.0)

    def test_team_candidates_ignore_duplicate_matches_and_skip_unobserved_competitions(self):
        match = {"tournament": "League A", "match_date": "2026-08-01", "home_key": "a",
                 "away_key": "b", "home_team": "A", "away_team": "B", "home_score": 1,
                 "away_score": 0, "fetched_at": "2026-10-26T00:00:00Z"}
        rows = build_team_candidate_payloads(
            [match, match, {**match, "tournament": "Single match cup"}],
            {}, date(2026, 10, 27),
        )
        self.assertEqual(rows, [])

    def test_competition_format_distinguishes_leagues_and_knockout_cups(self):
        self.assertEqual(competition_format("Англия. Премьер-лига"), "league_standings_proxy")
        self.assertEqual(competition_format("Англия. Кубок"), "knockout_form_proxy")
        self.assertEqual(competition_format("Лига чемпионов"), "international_tournament_form_proxy")


if __name__ == "__main__":
    unittest.main()
