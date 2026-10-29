#!/usr/bin/env python3
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from players_market_value_transfermarkt import write_batch  # noqa: E402


class MarketValueProvenanceTests(unittest.TestCase):
    def test_market_value_write_includes_source_url_and_observation_time(self):
        row = {"id": "00000000-0000-0000-0000-000000000001", "eur": 65_000_000,
               "at": "2026-06-03", "qid": "Q123", "tm_id": "316264"}
        with patch("players_market_value_transfermarkt.sb_rpc",
                   side_effect=[{"written": 1, "seen": 1}, {"conflicts": 0}]) as rpc:
            self.assertEqual(write_batch("https://example.supabase.co", "service-key", [row]), 1)
        first_payload = rpc.call_args_list[0].args[3]["p_rows"][0]
        self.assertEqual(first_payload["source"], "Transfermarkt TMAPI market-value-history")
        self.assertEqual(first_payload["source_url"],
                         "https://www.transfermarkt.com/spieler/profil/spieler/316264")
        self.assertEqual(first_payload["observed_at"][:4], "2026")
        self.assertEqual(first_payload["valued_at"], "2026-06-03")

    def test_market_value_provenance_does_not_claim_etv(self):
        row = {"id": "00000000-0000-0000-0000-000000000001", "eur": 65_000_000,
               "at": "2026-06-03", "qid": "Q123", "tm_id": "316264"}
        with patch("players_market_value_transfermarkt.sb_rpc",
                   side_effect=[{"written": 1, "seen": 1}, {"conflicts": 0}]) as rpc:
            write_batch("https://example.supabase.co", "service-key", [row])
        payload = rpc.call_args_list[0].args[3]["p_rows"][0]
        self.assertNotIn("etv", payload["source"].casefold())
        self.assertNotIn("estimated transfer value", payload["source"].casefold())


if __name__ == "__main__":
    unittest.main()
