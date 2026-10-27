import unittest
from datetime import date

from award_candidates_build import aggregate_stats, build_award_candidates, percentile


class AwardCandidateTests(unittest.TestCase):
    def test_percentile_ties(self):
        self.assertEqual(percentile({"a": 1, "b": 1, "c": 3}), {"a": 25.0, "b": 25.0, "c": 100.0})

    def test_duplicate_match_rows_keep_freshest_record(self):
        rows = [
            {"card_id": "p1", "match_date": "2026-10-01", "home_team": "A", "away_team": "B", "minutes": 60, "goals": 1, "assists": 0, "fetched_at": "2026-10-02"},
            {"card_id": "p1", "match_date": "2026-10-01", "home_team": "A", "away_team": "B", "minutes": 60, "goals": 1, "assists": 0, "fetched_at": "2026-10-03"},
        ]
        stats = aggregate_stats(rows)
        self.assertEqual(stats["p1"]["appearances"], 1)
        self.assertEqual(stats["p1"]["goals"], 1)

    def test_golden_boy_requires_verified_birth_date_and_eligibility(self):
        cards = [
            {"id": "eligible", "name": "Eligible", "category": "player", "active": True, "born_on": "2006-01-01"},
            {"id": "too_old", "name": "Too old", "category": "player", "active": True, "born_on": "2005-12-31"},
            {"id": "unknown_age", "name": "Unknown", "category": "player", "active": True, "born_on": None},
        ]
        stats = {card["id"]: {"goals": 3, "assists": 1, "minutes": 500, "appearances": 6, "last_match": "2026-10-20", "source_rows": 6} for card in cards}
        ranked = build_award_candidates("golden_boy", cards, stats, date(2026, 10, 27), 2026)
        self.assertEqual([row["card_id"] for row in ranked], ["eligible"])

    def test_award_candidates_have_evidence_and_no_probability_field(self):
        cards = [
            {"id": "p1", "name": "Alpha", "category": "player", "active": True, "born_on": "1998-01-01"},
            {"id": "p2", "name": "Beta", "category": "player", "active": True, "born_on": "2000-01-01"},
            {"id": "w1", "name": "Woman", "category": "woman", "active": True, "born_on": "1999-01-01"},
        ]
        stats = {
            "p1": {"goals": 10, "assists": 4, "minutes": 1800, "appearances": 20, "last_match": "2026-10-25", "source_rows": 20, "competitions": ["League A"]},
            "p2": {"goals": 5, "assists": 8, "minutes": 1600, "appearances": 18, "last_match": "2026-10-24", "source_rows": 18, "competitions": ["League B"]},
            "w1": {"goals": 6, "assists": 3, "minutes": 1300, "appearances": 16, "last_match": "2026-10-25", "source_rows": 16, "competitions": ["Women's League"]},
        }
        ranked = build_award_candidates("ballon_dor", cards, stats, date(2026, 10, 27), 2026)
        self.assertEqual(len(ranked), 2)
        self.assertEqual(ranked[0]["candidate_rank"], 1)
        self.assertIn("goals", ranked[0]["evidence"])
        self.assertNotIn("probability", ranked[0])

    def test_womens_awards_exclude_mens_cards(self):
        cards = [
            {"id": "p1", "name": "Player", "category": "player", "active": True},
            {"id": "w1", "name": "Woman", "category": "woman", "active": True},
        ]
        stats = {key: {"goals": 4, "assists": 2, "minutes": 900, "appearances": 10, "last_match": "2026-10-25"} for key in ("p1", "w1")}
        ranked = build_award_candidates("ballon_dor_feminin", cards, stats, date(2026, 10, 27), 2026)
        self.assertEqual([row["card_id"] for row in ranked], ["w1"])


if __name__ == "__main__":
    unittest.main()
