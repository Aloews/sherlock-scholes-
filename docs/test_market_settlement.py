import unittest

from docs.market_settlement import settle


class MarketSettlementTests(unittest.TestCase):
    def test_three_way_result(self):
        self.assertEqual(settle("three_way_result", "home", 2, 1), "won")
        self.assertEqual(settle("three_way_result", "away", 2, 1), "lost")
        self.assertEqual(settle("three_way_result", "draw", 1, 1), "won")

    def test_two_way_draw_is_void(self):
        self.assertEqual(settle("two_way_result", "home", 1, 1), "void")

    def test_totals_push(self):
        self.assertEqual(settle("totals", "over", 1, 1, 2), "push")
        self.assertEqual(settle("totals", "under", 2, 1, 2.5), "lost")

    def test_btts(self):
        self.assertEqual(settle("both_teams_to_score", "yes", 1, 1), "won")
        self.assertEqual(settle("both_teams_to_score", "no", 0, 1), "won")

    def test_draw_no_bet_pushes_on_draw(self):
        self.assertEqual(settle("draw_no_bet", "home", 0, 0), "push")

    def test_double_chance(self):
        self.assertEqual(settle("double_chance", "home_draw", 0, 0), "won")
        self.assertEqual(settle("double_chance", "home_away", 0, 1), "won")

    def test_spread_is_from_selected_side_perspective(self):
        self.assertEqual(settle("spread", "home", 2, 1, -0.5), "won")
        self.assertEqual(settle("spread", "away", 2, 1, 1), "push")

    def test_correct_score(self):
        self.assertEqual(settle("correct_score", "2-1", 2, 1), "won")
        self.assertEqual(settle("correct_score", "2-1", 2, 0), "lost")

    def test_missing_score_is_void(self):
        self.assertEqual(settle("totals", "over", None, 1, 2.5), "void")

    def test_invalid_market_rejected(self):
        with self.assertRaises(ValueError):
            settle("player_props_unimplemented", "over", 1, 0, 1.5)


if __name__ == "__main__":
    unittest.main()
