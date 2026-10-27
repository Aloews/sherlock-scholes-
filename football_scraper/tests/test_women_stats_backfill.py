import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from women_stats_backfill import needs_backfill


class WomensStatsBackfillTests(unittest.TestCase):
    def test_empty_data_requires_backfill(self):
        self.assertTrue(needs_backfill([]))

    def test_sufficient_rows_players_and_date_span_skip_backfill(self):
        rows = []
        start = date(2026, 1, 1)
        for index in range(100):
            rows.append({
                "card_id": f"player-{index % 10}",
                "match_date": (start + timedelta(days=index * 2)).isoformat(),
            })
        self.assertFalse(needs_backfill(rows))

    def test_short_date_span_requires_backfill(self):
        rows = [
            {"card_id": f"player-{index % 10}",
             "match_date": (date(2026, 10, 1) + timedelta(days=index % 10)).isoformat()}
            for index in range(120)
        ]
        self.assertTrue(needs_backfill(rows))

    def test_too_few_distinct_players_requires_backfill(self):
        rows = [
            {"card_id": "one-player",
             "match_date": (date(2026, 1, 1) + timedelta(days=index * 2)).isoformat()}
            for index in range(120)
        ]
        self.assertTrue(needs_backfill(rows))


if __name__ == "__main__":
    unittest.main()
