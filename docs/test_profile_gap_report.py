import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from profile_gap_report import make_report


class ProfileGapReportTests(unittest.TestCase):
    def test_gaps_are_counted_by_card_identity(self):
        cards = [
            {"id": "a", "name": "A", "photo_url": None, "photo_source": None,
             "wikidata_qid": "Q1", "transfermarkt_id": "11", "career_stats": {}},
            {"id": "b", "name": "B", "photo_url": "https://example.com/b.jpg", "photo_source": "test",
             "wikidata_qid": None, "transfermarkt_id": "22", "career_stats": [{"club": "B", "years": "2020–2024", "apps": 40, "goals": 2}]},
            {"id": "c", "name": "C", "photo_url": None, "photo_source": None,
             "wikidata_qid": None, "transfermarkt_id": None, "career_stats": None},
        ]
        seasons = [{"card_id": "b", "tm_player_id": "22"}, {"card_id": "b", "tm_player_id": "22"}]
        report = make_report(cards, seasons)
        self.assertEqual(report["active_player_cards"], 3)
        self.assertEqual(report["players_with_season_stats"], 1)
        self.assertEqual(report["missing_photo"], 2)
        self.assertEqual(report["missing_photo_with_wikidata_qid"], 1)
        self.assertEqual(report["missing_photo_without_wikidata_qid"], 1)
        self.assertEqual(report["missing_season_stats_with_transfermarkt_id"], 1)
        self.assertEqual(report["missing_transfermarkt_id"], 1)
        self.assertEqual(report["missing_career_stats_json"], 2)
        self.assertEqual(len(report["jobs"]["photo"]), 2)
        self.assertEqual(len(report["jobs"]["season_stats"]), 1)


if __name__ == "__main__":
    unittest.main()
