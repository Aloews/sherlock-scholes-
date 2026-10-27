import unittest
from datetime import date

from team_tournament_forecast import football_season_start, percentile, score_tournament


class TeamTournamentForecastTests(unittest.TestCase):
    def test_percentile_ties_receive_same_midrank(self):
        self.assertEqual(percentile({"a": 1, "b": 1, "c": 3}), {"a": 25.0, "b": 25.0, "c": 100.0})

    def test_single_team_percentile_is_neutral(self):
        self.assertEqual(percentile({"only": 100}), {"only": 50.0})

    def test_football_season_start_for_league_cup(self):
        self.assertEqual(football_season_start(date(2026, 10, 26), "Англия. Кубок лиги"), date(2026, 7, 1))
        self.assertEqual(football_season_start(date(2026, 3, 1), "Англия. Кубок лиги"), date(2025, 7, 1))

    def test_calendar_event_uses_calendar_year(self):
        self.assertEqual(football_season_start(date(2026, 7, 19), "Чемпионат мира"), date(2026, 1, 1))

    def test_ranked_teams_have_evidence_and_no_fake_probability(self):
        matches = []
        teams = [("alpha", "Alpha", 2, 0), ("beta", "Beta", 1, 0), ("gamma", "Gamma", 0, 1), ("delta", "Delta", 0, 2)]
        for idx, (home, home_name, hs, aws) in enumerate(teams):
            away = teams[(idx + 1) % len(teams)][0]
            away_name = teams[(idx + 1) % len(teams)][1]
            matches.append({
                "tournament": "League A",
                "match_date": f"2026-10-{10 + idx:02d}",
                "home_key": home,
                "away_key": away,
                "home_team": home_name,
                "away_team": away_name,
                "home_score": hs,
                "away_score": aws,
                "fetched_at": f"2026-10-{10 + idx:02d}T12:00:00+00:00",
            })
        ratings = {
            "alpha": {"elo": 1700, "played": 30},
            "beta": {"elo": 1600, "played": 30},
            "gamma": {"elo": 1500, "played": 30},
            "delta": {"elo": 1400, "played": 30},
        }
        ranked = score_tournament("League A", date(2026, 7, 1), matches, ratings, date(2026, 10, 27))
        self.assertEqual(len(ranked), 4)
        self.assertEqual([r["candidate_rank"] for r in ranked], [1, 2, 3, 4])
        self.assertIn("matches", ranked[0]["evidence"])
        self.assertIn("elo_percentile", ranked[0]["score_components"])
        self.assertNotIn("probability", ranked[0])
        self.assertTrue(all(0 <= r["candidate_score"] <= 100 for r in ranked))

    def test_insufficient_matches_are_not_ranked(self):
        ranked = score_tournament("Tiny Cup", date(2026, 7, 1), [], {}, date(2026, 10, 27))
        self.assertEqual(ranked, [])


if __name__ == "__main__":
    unittest.main()
