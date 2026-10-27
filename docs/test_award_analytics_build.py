#!/usr/bin/env python3
import unittest
from datetime import date

from award_analytics_build import score_player_candidates, score_team_tournaments


class PersonalAwardTests(unittest.TestCase):
    def test_player_award_candidates_rank_current_season_stats(self):
        cards = [
            {"id": "p1", "name": "Top Scorer", "category": "player", "born_on": "1998-01-01", "fame": 70, "market_value_eur": 50000000},
            {"id": "p2", "name": "Young Playmaker", "category": "player", "born_on": "2005-01-01", "fame": 45, "market_value_eur": 30000000},
            {"id": "p3", "name": "No Stats", "category": "player", "born_on": "2000-01-01", "fame": 90, "market_value_eur": 90000000},
        ]
        stats = [
            {"card_id": "p1", "season_id": 2026, "competition_id": "PL", "club_id": "a", "apps": 20, "minutes": 1700, "goals": 18, "assists": 4, "fetched_at": "2026-10-25T12:00:00+00:00"},
            {"card_id": "p2", "season_id": 2026, "competition_id": "PL", "club_id": "b", "apps": 18, "minutes": 1450, "goals": 8, "assists": 12, "fetched_at": "2026-10-25T12:00:00+00:00"},
        ]
        rows = score_player_candidates(cards, stats, 2026, date(2026, 10, 26), 10)
        scorer = [r for r in rows if r["award_key"] == "top_scorer"]
        self.assertEqual(scorer[0]["card_id"], "p1")
        youth = [r for r in rows if r["award_key"] == "young_player"]
        self.assertEqual({r["card_id"] for r in youth}, {"p2"})
        self.assertTrue(all(0 <= r["candidate_score"] <= 100 for r in rows))
        self.assertTrue(all(r["evidence"]["season_id"] == 2026 for r in rows))

    def test_empty_player_stats_do_not_invent_candidates(self):
        rows = score_player_candidates(
            [{"id": "p1", "name": "Player", "category": "player"}], [], 2026, date(2026, 10, 26)
        )
        self.assertEqual(rows, [])


class TeamTournamentTests(unittest.TestCase):
    def test_current_tournament_form_ranks_team_with_more_points_first(self):
        matches = [
            {"match_date": "2026-08-01", "tournament": "Test League", "home_key": "alpha", "away_key": "beta", "home_team": "Alpha", "away_team": "Beta", "home_score": 3, "away_score": 0, "fetched_at": "2026-10-25T00:00:00+00:00"},
            {"match_date": "2026-08-08", "tournament": "Test League", "home_key": "gamma", "away_key": "alpha", "home_team": "Gamma", "away_team": "Alpha", "home_score": 0, "away_score": 2, "fetched_at": "2026-10-25T00:00:00+00:00"},
            {"match_date": "2026-08-15", "tournament": "Test League", "home_key": "alpha", "away_key": "gamma", "home_team": "Alpha", "away_team": "Gamma", "home_score": 1, "away_score": 0, "fetched_at": "2026-10-25T00:00:00+00:00"},
            {"match_date": "2026-08-02", "tournament": "Test League", "home_key": "beta", "away_key": "gamma", "home_team": "Beta", "away_team": "Gamma", "home_score": 1, "away_score": 1, "fetched_at": "2026-10-25T00:00:00+00:00"},
            {"match_date": "2026-08-09", "tournament": "Test League", "home_key": "beta", "away_key": "alpha", "home_team": "Beta", "away_team": "Alpha", "home_score": 0, "away_score": 1, "fetched_at": "2026-10-25T00:00:00+00:00"},
            {"match_date": "2026-08-16", "tournament": "Test League", "home_key": "gamma", "away_key": "beta", "home_team": "Gamma", "away_team": "Beta", "home_score": 2, "away_score": 0, "fetched_at": "2026-10-25T00:00:00+00:00"},
        ]
        rows = score_team_tournaments(matches, [{"tournament": "Test League", "season_start": "2026-07-01"}], date(2026, 10, 26), 10)
        ranked = sorted(rows, key=lambda r: r["candidate_rank"])
        self.assertEqual(ranked[0]["team_key"], "alpha")
        self.assertEqual(ranked[0]["candidate_rank"], 1)
        self.assertIn("points_per_game", ranked[0]["score_components"])
        self.assertEqual(ranked[0]["evidence"]["season_boundary_source"], ["league_season"])

    def test_matches_before_season_boundary_are_excluded(self):
        matches = [
            {"match_date": "2025-11-01", "tournament": "Test League", "home_key": "alpha", "away_key": "beta", "home_team": "Alpha", "away_team": "Beta", "home_score": 5, "away_score": 0},
            {"match_date": "2026-08-01", "tournament": "Test League", "home_key": "alpha", "away_key": "beta", "home_team": "Alpha", "away_team": "Beta", "home_score": 0, "away_score": 0},
            {"match_date": "2026-08-08", "tournament": "Test League", "home_key": "beta", "away_key": "alpha", "home_team": "Beta", "away_team": "Alpha", "home_score": 0, "away_score": 0},
            {"match_date": "2026-08-15", "tournament": "Test League", "home_key": "alpha", "away_key": "beta", "home_team": "Alpha", "away_team": "Beta", "home_score": 0, "away_score": 0},
        ]
        rows = score_team_tournaments(matches, [{"tournament": "Test League", "season_start": "2026-07-01"}], date(2026, 10, 26), 10)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["evidence"]["matches_used"] == 3 for r in rows))


if __name__ == "__main__":
    unittest.main()
