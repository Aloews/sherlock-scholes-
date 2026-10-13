import importlib.util
import pathlib
import unittest

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "paper_bankroll_math.py"
SPEC = importlib.util.spec_from_file_location("paper_bankroll_math", MODULE_PATH)
bankroll = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bankroll)


class PaperBankrollTests(unittest.TestCase):
    def test_positive_edge_stakes_quarter_kelly_capped_at_two_percent(self):
        self.assertEqual(bankroll.stake_for(10_000, 0.60, 2.2), 200.0)

    def test_negative_edge_never_places_a_position(self):
        self.assertEqual(bankroll.stake_for(10_000, 0.40, 2.0), 0.0)

    def test_stake_is_never_more_than_two_percent(self):
        self.assertLessEqual(bankroll.stake_for(10_000, 0.99, 10.0), 200.0)

    def test_correct_prediction_profit_uses_decimal_odds(self):
        self.assertEqual(bankroll.settlement_profit(100, 2.5, True), 150.0)

    def test_incorrect_prediction_loses_only_the_virtual_stake(self):
        self.assertEqual(bankroll.settlement_profit(100, 2.5, False), -100.0)

    def test_missing_or_invalid_odds_do_not_create_profit(self):
        self.assertEqual(bankroll.stake_for(10_000, 0.90, None), 0.0)
        self.assertEqual(bankroll.stake_for(10_000, 0.90, 1.0), 0.0)

    def test_zero_balance_cannot_place_a_position(self):
        self.assertEqual(bankroll.stake_for(0, 0.90, 2.0), 0.0)


if __name__ == "__main__":
    unittest.main()
