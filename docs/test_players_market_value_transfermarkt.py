#!/usr/bin/env python3
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from players_market_value_transfermarkt import (  # noqa: E402
    market_value_refresh_key,
    parse_api_market_value,
    should_write_market_value,
    unwrap_api_market_value_payload,
    should_retry_market_value_status,
    TMAPI, TM_PAUSE,
)


class MarketValueRefreshTests(unittest.TestCase):
    def test_refresh_prioritizes_oldest_attempt_and_source_date_breaks_ties(self):
        cards = [
            {"name": "Recently checked", "market_value_eur": 90_000_000,
             "market_value_at": "2025-01-01", "market_value_checked_at": "2026-10-20T00:00:00+00:00"},
            {"name": "Never checked", "market_value_eur": 40_000_000,
             "market_value_at": "2026-10-01", "market_value_checked_at": None},
            {"name": "Old check, newer value", "market_value_eur": 50_000_000,
             "market_value_at": "2026-01-01", "market_value_checked_at": "2026-09-01T00:00:00+00:00"},
            {"name": "Old check, old low", "market_value_eur": 10_000_000,
             "market_value_at": "2025-01-01", "market_value_checked_at": "2026-09-01T00:00:00+00:00"},
            {"name": "Old check, old high", "market_value_eur": 70_000_000,
             "market_value_at": "2025-01-01", "market_value_checked_at": "2026-09-01T00:00:00+00:00"},
        ]
        ordered = sorted(cards, key=market_value_refresh_key)
        self.assertEqual(
            [card["name"] for card in ordered],
            ["Never checked", "Old check, old high", "Old check, old low",
             "Old check, newer value", "Recently checked"],
        )

    def test_json_api_market_value_keeps_exact_euros_and_source_date(self):
        value, valued_at = parse_api_market_value({
            "id": "316264",
            "marketValue": 65000000,
            "marketValueDetails": {"lastUpdated": "2026-06-03"},
            "marketValueHistory": [
                {"date": "2025-12-15", "marketValue": 70000000},
                {"date": "2026-06-03", "marketValue": 65000000},
            ],
        })
        self.assertEqual((value, valued_at), (65000000, "2026-06-03"))

    def test_public_api_direct_response_and_legacy_envelope_are_both_supported(self):
        direct = {
            "id": "316264",
            "marketValue": 65000000,
            "marketValueDetails": {"lastUpdated": "2026-06-03"},
            "updatedAt": "2026-10-27T18:00:00",
        }
        wrapped = {"success": True, "data": direct}
        self.assertEqual(unwrap_api_market_value_payload(direct, "316264"), direct)
        self.assertEqual(unwrap_api_market_value_payload(wrapped, "316264"), direct)
        self.assertEqual(unwrap_api_market_value_payload({"data": direct}, "316264"), direct)
        self.assertIsNone(unwrap_api_market_value_payload({"success": False}, "316264"))
        self.assertIsNone(unwrap_api_market_value_payload({**direct, "id": "132098"}, "316264"))

    def test_market_value_api_uses_the_documented_service_host_and_safe_pacing(self):
        self.assertEqual(TMAPI, "https://transfermarkt-api.fly.dev")
        self.assertGreaterEqual(TM_PAUSE, 1.6)

    def test_upstream_blocked_status_is_not_retried(self):
        self.assertTrue(should_retry_market_value_status(429))
        self.assertTrue(should_retry_market_value_status(500))
        self.assertTrue(should_retry_market_value_status(502))
        self.assertTrue(should_retry_market_value_status(504))
        self.assertFalse(should_retry_market_value_status(503))
        self.assertFalse(should_retry_market_value_status(404))

    def test_fetch_timestamp_is_not_used_as_valuation_date(self):
        value, valued_at = parse_api_market_value({
            "id": "316264",
            "marketValue": 65000000,
            "updatedAt": "2026-10-27T18:00:00",
        })
        self.assertEqual(value, 65000000)
        self.assertIsNone(valued_at)

    def test_json_api_market_value_parses_display_string_and_history_fallback(self):
        value, valued_at = parse_api_market_value({
            "marketValue": "€ 70.00m",
            "marketValueHistory": [
                {"date": "2026-07-22", "marketValue": 70000000},
            ],
        })
        self.assertEqual((value, valued_at), (70000000, "2026-07-22"))

    def test_json_api_no_valuation_stays_null_instead_of_becoming_zero(self):
        self.assertEqual(parse_api_market_value({"marketValue": None}), (None, None))

    def test_explicit_null_current_value_does_not_fall_back_to_old_history(self):
        self.assertEqual(
            parse_api_market_value({
                "marketValue": None,
                "marketValueHistory": [
                    {"date": "2026-06-03", "marketValue": 65000000},
                ],
            }),
            (None, "2026-06-03"),
        )

    def test_unknown_valuation_date_is_never_written(self):
        self.assertTrue(should_write_market_value(65_000_000, "2026-06-03"))
        self.assertFalse(should_write_market_value(65_000_000, None))
        self.assertFalse(should_write_market_value(65_000_000, "not-a-date"))
        self.assertFalse(should_write_market_value(65_000_000, "2999-01-01"))
        self.assertFalse(should_write_market_value(None, "2026-06-03"))
        self.assertFalse(should_write_market_value(0, "2026-06-03"))


if __name__ == "__main__":
    unittest.main()
