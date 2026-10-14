import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from player_data_audit import audit_cards


class PlayerDataAuditTests(unittest.TestCase):
    def test_missing_profile_flags_and_value_band(self):
        cards = [{
            "id": "card-1", "name": "Example Player", "name_en": "Example Player",
            "market_value_eur": 500000, "photo_url": None, "photo_source": None,
            "transfermarkt_id": "123", "wikidata_qid": "Q123", "career_stats": {},
            "country": None, "position_ru": None, "born_on": None,
        }]
        report = audit_cards(cards, [], [])
        self.assertEqual(report["summary"]["players"], 1)
        self.assertEqual(report["summary"]["missing_photo"], 1)
        self.assertEqual(report["summary"]["missing_season_stats"], 1)
        self.assertEqual(report["value_bands"]["100k-1m"]["players"], 1)
        self.assertTrue(report["profiles"][0]["missing_country"])

    def test_season_rows_match_by_card_id(self):
        cards = [{
            "id": "card-2", "name": "Player", "market_value_eur": None,
            "photo_url": "https://example.test/photo.jpg", "transfermarkt_id": "456",
            "wikidata_qid": None, "career_stats": {"goals": 3},
            "country": "GB", "position_ru": "Нападающий", "born_on": "2000-01-01",
        }]
        seasons = [{"card_id": "card-2", "tm_player_id": "456", "season_id": 2025}]
        report = audit_cards(cards, seasons, [])
        self.assertEqual(report["summary"]["with_season_stats"], 1)
        self.assertEqual(report["summary"]["with_photo"], 1)
        self.assertEqual(report["summary"]["with_career_stats_json"], 1)

    def test_future_and_pre_2000_match_dates_are_reported(self):
        cards = []
        matches = [
            {"card_id": "p1", "match_date": "2099-01-01", "minutes": 0, "goals": 0,
             "assists": 0, "yellow": 0, "red": 0},
            {"card_id": "p2", "match_date": "1998-01-01", "minutes": None, "goals": 0,
             "assists": 0, "yellow": 0, "red": 0},
        ]
        report = audit_cards(cards, [], matches)
        self.assertEqual(report["match_quality"]["future_dated"], 1)
        self.assertEqual(report["match_quality"]["pre_2000"], 1)
        self.assertEqual(report["match_quality"]["all_zero_or_null"], 2)


if __name__ == "__main__":
    unittest.main()
