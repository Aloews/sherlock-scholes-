import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from market_odds_ingest import normalize_events, normalize_market, normalize_selection


class MarketOddsIngestTests(unittest.TestCase):
    def test_market_keys_normalize_without_losing_market_type(self):
        self.assertEqual(normalize_market("h2h"), "three_way_result")
        self.assertEqual(normalize_market("spreads"), "spread")
        self.assertEqual(normalize_market("totals"), "totals")
        self.assertEqual(normalize_market("player_shots_on_target"), "player_shots_on_target")

    def test_selection_keys(self):
        self.assertEqual(normalize_selection("h2h", "Draw", "Arsenal", "Chelsea"), "draw")
        self.assertEqual(normalize_selection("h2h", "Arsenal", "Arsenal", "Chelsea"), "home")
        self.assertEqual(normalize_selection("totals", "Over", "Arsenal", "Chelsea"), "over")
        self.assertEqual(normalize_selection("double_chance", "1X", "Arsenal", "Chelsea"), "home_draw")

    def test_normalizes_multiple_markets_and_lines(self):
        events = [{
            "id": "fixture-1", "sport_key": "soccer_epl", "commence_time": "2026-10-20T18:00:00Z",
            "home_team": "Arsenal", "away_team": "Chelsea",
            "bookmakers": [{
                "key": "book-a", "markets": [
                    {"key": "h2h", "outcomes": [
                        {"name": "Arsenal", "price": 2.0}, {"name": "Draw", "price": 3.2},
                        {"name": "Chelsea", "price": 4.0}]},
                    {"key": "totals", "outcomes": [
                        {"name": "Over", "price": 1.9, "point": 2.5},
                        {"name": "Under", "price": 1.9, "point": 2.5}]},
                ],
            }],
        }]
        rows, skipped = normalize_events(events, {"fixture-1"}, "2026-10-14T10:00:00Z")
        self.assertEqual(skipped, 0)
        self.assertEqual(len(rows), 5)
        total = next(row for row in rows if row["market_key"] == "totals" and row["selection_key"] == "over")
        self.assertEqual(total["line_value"], 2.5)
        self.assertEqual(total["decimal_odds"], 1.9)

    def test_unknown_fixture_is_not_inserted(self):
        rows, skipped = normalize_events([{
            "id": "unknown", "sport_key": "soccer_epl", "commence_time": "2026-10-20T18:00:00Z",
            "home_team": "A", "away_team": "B", "bookmakers": [],
        }], set(), "2026-10-14T10:00:00Z")
        self.assertEqual(rows, [])
        self.assertEqual(skipped, 1)


if __name__ == "__main__":
    unittest.main()
