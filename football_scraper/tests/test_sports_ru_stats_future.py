"""Future fixtures from sports.ru are not valid historical player statistics."""
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sports_ru_stats import completed_match_rows


class FutureMatchRowsTests(unittest.TestCase):
    def test_keeps_past_and_today_and_drops_future_rows(self):
        rows = [
            {"date": date(2026, 10, 14), "home_score": 2, "away_score": 1},
            {"date": date(2026, 10, 15), "home_score": 0, "away_score": 0},
            {"date": date(2026, 10, 20), "home_score": 0, "away_score": 0},
        ]
        kept, skipped = completed_match_rows(rows, today=date(2026, 10, 15))
        self.assertEqual(kept, rows[:2])
        self.assertEqual(skipped, 1)

    def test_undated_rows_fail_closed(self):
        kept, skipped = completed_match_rows(
            [{"date": None}, {"date": "2026-10-14"}], today=date(2026, 10, 15)
        )
        self.assertEqual(kept, [])
        self.assertEqual(skipped, 0)


if __name__ == "__main__":
    unittest.main()
