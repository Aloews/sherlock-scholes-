#!/usr/bin/env python3
import json
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from players_market_value_transfermarkt import (  # noqa: E402
    fetch_api_market_value,
    invalid_profile_threshold,
    market_value_refresh_key,
    parse_ceapi_market_value,
    should_write_market_value,
    should_retry_market_value_status,
)


class MarketValueRefreshTests(unittest.TestCase):
    def test_retryable_http_statuses_are_explicit(self):
        self.assertTrue(should_retry_market_value_status(429))
        self.assertTrue(should_retry_market_value_status(500))
        self.assertTrue(should_retry_market_value_status(503))
        self.assertFalse(should_retry_market_value_status(400))
        self.assertFalse(should_retry_market_value_status(404))

    def test_invalid_source_threshold_fails_early_without_penalizing_small_targeted_runs(self):
        self.assertEqual(invalid_profile_threshold(1), 5)
        self.assertEqual(invalid_profile_threshold(20), 5)
        self.assertEqual(invalid_profile_threshold(80), 8)
        self.assertEqual(invalid_profile_threshold(800), 80)

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

    @patch("players_market_value_transfermarkt.urllib.request.urlopen")
    def test_fetch_uses_native_transfermarkt_chart_endpoint(self, urlopen):
        response = urlopen.return_value.__enter__.return_value
        response.read.return_value = json.dumps({
            "list": [
                {"datum_mw": "22.07.2026", "mw": "€70.00m"},
            ],
        }).encode()
        response.headers.get.return_value = None
        with patch.dict(os.environ, {
            "TMAPI_DIAGNOSTICS": "1",
            "TMAPI_DIAGNOSTIC_FAST": "1",
        }):
            self.assertEqual(
                fetch_api_market_value("316264"),
                (70_000_000, "2026-07-22", True),
            )
        request = urlopen.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "https://www.transfermarkt.com/ceapi/marketValueDevelopment/graph/316264",
        )
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 15)

    def test_ceapi_history_uses_latest_dated_source_value(self):
        value, valued_at, valid = parse_ceapi_market_value({
            "list": [
                {"datum_mw": "03.06.2026", "mw": "€65.00m"},
                {"datum_mw": "22.07.2026", "mw": "€70.00m"},
                {"datum_mw": "15.12.2025", "mw": "€75.00m"},
            ],
        })
        self.assertTrue(valid)
        self.assertEqual((value, valued_at), (70_000_000, "2026-07-22"))

    def test_ceapi_empty_history_is_a_valid_profile_without_a_published_value(self):
        self.assertEqual(parse_ceapi_market_value({"list": []}), (None, None, True))

    def test_ceapi_profile_with_undated_value_does_not_fabricate_a_date(self):
        self.assertEqual(
            parse_ceapi_market_value({"list": [{"mw": "€65.00m"}]}),
            (None, None, True),
        )

    def test_ceapi_rejects_malformed_top_level_payload(self):
        self.assertEqual(parse_ceapi_market_value({"error": "not found"}), (None, None, False))
        self.assertEqual(parse_ceapi_market_value([]), (None, None, False))

    def test_ceapi_accepts_numeric_euros_and_slash_dates(self):
        self.assertEqual(
            parse_ceapi_market_value({"list": [{"datum_mw": "03/06/2026", "mw": 65_000_000}]}),
            (65_000_000, "2026-06-03", True),
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
