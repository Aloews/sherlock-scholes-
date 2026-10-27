#!/usr/bin/env python3
import json
import os
import urllib.error
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from players_market_value_transfermarkt import (  # noqa: E402
    fetch_api_market_value,
    invalid_profile_threshold,
    market_value_refresh_key,
    select_market_value_refresh_candidates,
    parse_tmapi_market_value,
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
            {"name": "Never valued", "market_value_eur": None,
             "market_value_at": None, "market_value_checked_at": None},
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
            ["Never checked", "Never valued", "Old check, old high",
             "Old check, old low", "Old check, newer value", "Recently checked"],
        )

    def test_refresh_keeps_daily_high_value_cohort_and_rotates_the_rest(self):
        now = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)
        cards = [
            {"id": "elite", "name": "Elite", "transfermarkt_id": "1",
             "market_value_eur": 100_000_000, "market_value_at": "2026-10-01",
             "market_value_checked_at": "2026-10-27T10:00:00+00:00"},
            {"id": "star", "name": "Star", "transfermarkt_id": "2",
             "market_value_eur": 80_000_000, "market_value_at": "2026-09-01",
             "market_value_checked_at": "2026-10-27T10:00:00+00:00"},
            {"id": "recent", "name": "Recently checked star", "transfermarkt_id": "3",
             "market_value_eur": 70_000_000, "market_value_at": "2026-10-01",
             "market_value_checked_at": "2026-10-28T11:00:00+00:00"},
            {"id": "old-low", "name": "Old low", "transfermarkt_id": "4",
             "market_value_eur": 10_000_000, "market_value_at": "2025-01-01",
             "market_value_checked_at": "2026-09-01T00:00:00+00:00"},
            {"id": "unvalued", "name": "Unvalued", "transfermarkt_id": "5",
             "market_value_eur": None, "market_value_at": None,
             "market_value_checked_at": None},
        ]
        selected = select_market_value_refresh_candidates(
            cards, limit=4, priority_limit=2, now=now
        )
        self.assertEqual(
            [card["id"] for card in selected],
            ["elite", "star", "unvalued", "old-low"],
        )
        # A high-value card checked an hour ago is not repeatedly prioritized.
        self.assertNotIn("recent", [card["id"] for card in selected])

    def test_priority_refresh_handles_zero_limit_and_recent_timestamp_formats(self):
        now = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)
        self.assertEqual(select_market_value_refresh_candidates([], 0, now=now), [])
        recent = {"id": "recent", "market_value_eur": 50_000_000,
                  "market_value_checked_at": "2026-10-28T11:00:00Z"}
        stale = {"id": "stale", "market_value_eur": 60_000_000,
                 "market_value_checked_at": "2026-10-27T10:00:00+00:00"}
        selected = select_market_value_refresh_candidates(
            [recent, stale], limit=1, priority_limit=1, now=now
        )
        self.assertEqual(selected, [stale])

    @patch("players_market_value_transfermarkt.urllib.request.urlopen")
    def test_404_marks_source_checked_without_replacing_price(self, urlopen):
        urlopen.side_effect = urllib.error.HTTPError(
            "https://tmapi.transfermarkt.technology/player/999/market-value-history",
            404, "Not Found", {}, None,
        )
        with patch.dict(os.environ, {
            "TMAPI_DIAGNOSTICS": "1",
            "TMAPI_DIAGNOSTIC_FAST": "1",
        }):
            self.assertEqual(fetch_api_market_value("999"), (None, None, True))
        self.assertEqual(urlopen.call_count, 1)

    @patch("players_market_value_transfermarkt.urllib.request.urlopen")
    def test_fetch_uses_native_tmapi_market_value_history_route(self, urlopen):
        response = urlopen.return_value.__enter__.return_value
        response.read.return_value = json.dumps({
            "success": True,
            "data": {
                "current": {"marketValue": {"value": 70_000_000, "currency": "EUR", "determined": "2026-07-22"}},
                "history": [],
            },
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
            "https://tmapi.transfermarkt.technology/player/316264/market-value-history",
        )
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 15)

    def test_tmapi_history_uses_current_value_and_dated_history_fallback(self):
        payload = {
            "success": True,
            "data": {
                "current": {"marketValue": {"value": 70_000_000, "currency": "EUR", "determined": "2026-07-22"}},
                "history": [
                    {"marketValue": {"value": 65_000_000, "currency": "EUR", "determined": "2026-06-03"}},
                ],
            },
        }
        self.assertEqual(parse_tmapi_market_value(payload), (70_000_000, "2026-07-22", True))
        payload["data"]["current"]["marketValue"]["determined"] = None
        self.assertEqual(parse_tmapi_market_value(payload), (65_000_000, "2026-06-03", True))

    def test_tmapi_empty_history_is_a_valid_profile_without_a_published_value(self):
        self.assertEqual(
            parse_tmapi_market_value({"success": True, "data": {"current": {}, "history": []}}),
            (None, None, True),
        )

    def test_tmapi_rejects_malformed_top_level_payload(self):
        self.assertEqual(parse_tmapi_market_value({"error": "not found"}), (None, None, False))
        self.assertEqual(parse_tmapi_market_value([]), (None, None, False))

    def test_tmapi_accepts_string_money_and_slash_dates(self):
        self.assertEqual(
            parse_tmapi_market_value({
                "success": True,
                "data": {
                    "current": {},
                    "history": [
                        {"marketValue": {"value": "€65.00m", "determined": "03/06/2026"}},
                    ],
                },
            }),
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
