import unittest
from unittest.mock import Mock, patch

from award_candidates_build import (OVERALL_SPECS, aggregate_women_match_stats, build_team_candidate_payloads, competition_format, competition_strength, normal_key, normalize_base_url, percentile, remove_stale_award_snapshot_rows, score_population)
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

    def test_womens_match_stats_use_competition_season_windows_and_keep_unknown_minutes(self):
        rows = [
            {"card_id": "woman-a", "match_date": "2026-08-15", "tournament": "English Women's Super League",
             "minutes": None, "goals": 1, "assists": 1, "fetched_at": "2026-08-16T00:00:00Z"},
            {"card_id": "woman-a", "match_date": "2026-06-15", "tournament": "English Women's Super League",
             "minutes": None, "goals": 4, "assists": 0, "fetched_at": "2026-06-16T00:00:00Z"},
            {"card_id": "woman-b", "match_date": "2026-03-10", "tournament": "National Women's Soccer League",
             "minutes": None, "goals": 2, "assists": 0, "fetched_at": "2026-03-11T00:00:00Z"},
        ]
        totals = aggregate_women_match_stats(rows, 2026, date(2026, 10, 27))
        self.assertEqual(totals["woman-a"]["apps"], 1)
        self.assertEqual(totals["woman-a"]["goals"], 1)
        self.assertEqual(totals["woman-a"]["stats_window_start"], "2026-07-01")
        self.assertEqual(totals["woman-a"]["minutes"], 0)
        self.assertFalse(totals["woman-a"]["minutes_known"])
        self.assertEqual(totals["woman-b"]["apps"], 1)
        self.assertEqual(totals["woman-b"]["goals"], 2)
        self.assertEqual(totals["woman-b"]["stats_window_start"], "2026-01-01")

    def test_womens_award_ranking_does_not_fabricate_per90_when_minutes_are_missing(self):
        population = [{
            "card_id": "woman-a", "name": "Player A", "category": "woman", "active": True,
            "apps": 10, "starts": 0, "minutes": 0, "goals": 5, "assists": 2,
            "weighted_goals": 3.2, "weighted_assists": 1.2, "competition_strength": 0.64,
            "goals_per_90": None, "assists_per_90": None, "stats_rows": 10,
            "stats_window_start": "2026-07-01", "stats_source": "espn_player_match_stats",
            "starts_known": False, "minutes_known": False, "sw_rating": None, "market_value_eur": None,
            "fame": 50, "age": 28, "last_fetched": "2026-10-26T00:00:00Z",
        }]
        rows = score_population(population, OVERALL_SPECS["ballon_dor_feminin"],
                                "ballon_dor_feminin", 2026, date(2026, 10, 27))
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["evidence"]["goals_per_90"])
        self.assertIsNone(rows[0]["evidence"]["assists_per_90"])
        self.assertFalse(rows[0]["evidence"]["minutes_available"])
        self.assertFalse(rows[0]["evidence"]["starts_available"])
        self.assertIsNone(rows[0]["evidence"]["minutes"])
        self.assertIsNone(rows[0]["evidence"]["starts"])
        self.assertEqual(rows[0]["evidence"]["stats_source"], "espn_player_match_stats")
        self.assertEqual(rows[0]["evidence"]["candidate_pool_size"], 1)
        self.assertEqual(
            rows[0]["evidence"]["candidate_pool_scope"],
            "active cards with stats available in tracked sources",
        )
        self.assertEqual(rows[0]["confidence"], "low")

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

    def test_team_candidates_deduplicate_results_and_keep_sparse_competitions_low_confidence(self):
        match = {"tournament": "League A", "match_date": "2026-08-01", "home_key": "a",
                 "away_key": "b", "home_team": "A", "away_team": "B", "home_score": 1,
                 "away_score": 0, "fetched_at": "2026-10-26T00:00:00Z"}
        rows = build_team_candidate_payloads(
            [match, match, {**match, "tournament": "Single match cup"}],
            {}, date(2026, 10, 27),
        )
        self.assertEqual({row["tournament"] for row in rows}, {"League A", "Single match cup"})
        self.assertEqual(len(rows), 4)  # two teams per competition; duplicate source row counted once
        self.assertTrue(all(row["confidence"] == "low" for row in rows))
        self.assertTrue(all(row["candidate_score"] < 60 for row in rows))
        self.assertTrue(all(row["score_components"]["sample_reliability"] < 0.2 for row in rows))

    def test_competition_format_distinguishes_leagues_and_knockout_cups(self):
        self.assertEqual(competition_format("Англия. Премьер-лига"), "league_standings_proxy")
        self.assertEqual(competition_format("Англия. Кубок"), "knockout_form_proxy")
        self.assertEqual(competition_format("Лига чемпионов"), "international_tournament_form_proxy")


    def test_competition_strength_downweights_lower_divisions(self):
        self.assertGreater(competition_strength("UEFA Champions League"), competition_strength("1.Lig"))
        self.assertGreater(competition_strength("Premier League"), competition_strength("1.Lig"))
        self.assertGreater(competition_strength("Premier League"), competition_strength("Russian Premier League"))
        self.assertEqual(competition_strength("Unmapped competition"), 0.5)

    def test_ballondor_and_the_best_use_distinct_weight_profiles(self):
        self.assertNotEqual(OVERALL_SPECS["ballon_dor"], OVERALL_SPECS["the_best"])
        self.assertNotEqual(OVERALL_SPECS["ballon_dor"], OVERALL_SPECS["golden_boy"])
        self.assertAlmostEqual(sum(OVERALL_SPECS["ballon_dor"].values()), 1.0)
        self.assertAlmostEqual(sum(OVERALL_SPECS["the_best"].values()), 1.0)
        self.assertAlmostEqual(sum(OVERALL_SPECS["golden_boy"].values()), 1.0)


    def test_missing_market_value_is_neutral_not_zero(self):
        players = [
            {"card_id": "unknown", "name": "Unknown value", "category": "player", "active": True,
             "apps": 10, "starts": 8, "minutes": 700, "goals": 4, "assists": 2,
             "market_value_eur": None, "stats_rows": 1},
            {"card_id": "known", "name": "Known value", "category": "player", "active": True,
             "apps": 10, "starts": 8, "minutes": 700, "goals": 4, "assists": 2,
             "market_value_eur": 100000000, "stats_rows": 1},
        ]
        rows = score_population(players, {"market_value_eur": 0.5, "goals": 0.5},
                                "ballon_dor", 2026, date(2026, 10, 27))
        self.assertEqual(
            next(row for row in rows if row["card_id"] == "unknown")["score_components"]["market_value_eur"],
            50.0,
        )


    @patch("award_candidates_build.requests.delete")
    def test_stale_award_rows_are_removed_only_for_the_current_snapshot(self, delete):
        response = Mock()
        response.json.return_value = [{"card_id": "stale-1"}, {"card_id": "stale-2"}]
        delete.return_value = response

        removed = remove_stale_award_snapshot_rows(
            "https://project.supabase.co/", "service-key", date(2026, 10, 27)
        )

        self.assertEqual(removed, 2)
        args, kwargs = delete.call_args
        self.assertEqual(
            args[0],
            "https://project.supabase.co/rest/v1/award_candidate_snapshot",
        )
        self.assertEqual(
            kwargs["params"],
            {
                "snapshot_date": "eq.2026-10-27",
                "model_version": "neq.candidate-rank-v2",
            },
        )
        self.assertEqual(kwargs["headers"]["Prefer"], "return=representation")
        response.raise_for_status.assert_called_once_with()

    @patch("award_candidates_build.requests.delete")
    def test_stale_award_cleanup_propagates_database_errors(self, delete):
        response = Mock()
        response.raise_for_status.side_effect = RuntimeError("database unavailable")
        delete.return_value = response
        with self.assertRaisesRegex(RuntimeError, "database unavailable"):
            remove_stale_award_snapshot_rows(
                "https://project.supabase.co", "service-key", date(2026, 10, 27)
            )

if __name__ == "__main__":
    unittest.main()
