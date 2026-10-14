import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from market_settle_results import rule_for_fixture


class MarketSettlementVersionTests(unittest.TestCase):
    def test_uses_rule_effective_at_kickoff(self):
        rules = {
            "totals": [
                {"rule_version": 1, "rule_type": "totals", "effective_from": "2000-01-01T00:00:00+00:00"},
                {"rule_version": 2, "rule_type": "totals", "effective_from": "2026-01-01T00:00:00+00:00"},
            ]
        }
        self.assertEqual(rule_for_fixture(rules, "totals", "2025-06-01T12:00:00Z")["rule_version"], 1)
        self.assertEqual(rule_for_fixture(rules, "totals", "2026-10-01T12:00:00Z")["rule_version"], 2)

    def test_market_without_effective_rule_is_skipped(self):
        rules = {"totals": [{"rule_version": 2, "rule_type": "totals",
                             "effective_from": "2026-01-01T00:00:00+00:00"}]}
        self.assertIsNone(rule_for_fixture(rules, "totals", "2025-06-01T12:00:00Z"))


if __name__ == "__main__":
    unittest.main()
