#!/usr/bin/env python3
"""Offline regression tests for the player-stat and portrait parsers."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from players_stats_transfermarkt import parse_seasons
from cards_photo_transfermarkt import portrait_url
from cards_photo_from_qid import may_use_pageimage, photo_url
from cards_photo_credits import credit_from_imageinfo, file_title_from_url, plain


class SeasonParserTests(unittest.TestCase):
    def test_keeps_competition_and_club_rows_without_gender_filtering(self):
        payload = {
            "data": {
                "performance": [
                    {
                        "generalInformation": {
                            "seasonId": 2025,
                            "competitionId": "women-league-1",
                            "clubId": "women-club-1",
                        },
                        "statistics": {
                            "goalStatistics": {"goalsSum": 12, "assistsSum": 4},
                            "cardStatistics": {"yellowCardNetSum": 2},
                            "playingTimeStatistics": {
                                "appearancesCount": 18,
                                "startingCount": 16,
                                "playedMinutesSum": 1400,
                            },
                        },
                    }
                ]
            }
        }
        rows = parse_seasons(payload)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["competition_id"], "women-league-1")
        self.assertEqual(rows[0]["club_id"], "women-club-1")
        self.assertEqual(rows[0]["goals"], 12)
        self.assertEqual(rows[0]["assists"], 4)

    def test_rejects_rows_missing_a_competition_or_club_key(self):
        payload = {"data": {"performance": [
            {"generalInformation": {"seasonId": 2025, "competitionId": "c"}},
            {"generalInformation": {"seasonId": 2025, "clubId": "club"}},
        ]}}
        self.assertEqual(parse_seasons(payload), [])


class PortraitParserTests(unittest.TestCase):
    def test_transfermarkt_portrait_is_read_from_og_image(self):
        html = '<meta property="og:image" content="https://img.transfermarkt.technology/portrait/big/123-456.jpg">'
        self.assertEqual(
            portrait_url(html),
            "https://img.transfermarkt.technology/portrait/big/123-456.jpg",
        )

    def test_transfermarkt_placeholder_is_rejected(self):
        for filename in ("default.jpg", "dummy.png"):
            html = '<meta property="og:image" content="https://img.transfermarkt.technology/portrait/big/%s">' % filename
            self.assertIsNone(portrait_url(html))

    def test_wikidata_photo_url_encodes_filename_and_limits_width(self):
        self.assertEqual(
            photo_url("Player Portrait.jpg"),
            "https://commons.wikimedia.org/wiki/Special:FilePath/Player_Portrait.jpg?width=400",
        )
        self.assertIsNone(photo_url(""))

    def test_pageimage_remains_player_only(self):
        self.assertTrue(may_use_pageimage("player"))
        self.assertFalse(may_use_pageimage("club"))
        self.assertFalse(may_use_pageimage("competition"))

    def test_commons_file_title_parser_handles_special_filepath_and_thumbnails(self):
        self.assertEqual(
            file_title_from_url("https://commons.wikimedia.org/wiki/Special:FilePath/Player%20Photo.jpg?width=400"),
            "Player Photo.jpg",
        )
        self.assertEqual(
            file_title_from_url("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Player_Photo.jpg/256px-Player_Photo.jpg"),
            "Player Photo.jpg",
        )
        self.assertIsNone(file_title_from_url("https://example.com/photo.jpg"))

    def test_commons_credit_markup_is_plain_text(self):
        credit = credit_from_imageinfo({
            "extmetadata": {
                "Artist": {"value": '<a href="/wiki/User:Test">Test Artist</a>'},
                "LicenseShortName": {"value": "CC BY-SA 4.0"},
                "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0/"},
            },
            "descriptionurl": "https://commons.wikimedia.org/wiki/File:Photo.jpg",
        })
        self.assertEqual(credit["author"], "Test Artist")
        self.assertEqual(credit["license"], "CC BY-SA 4.0")
        self.assertEqual(credit["credit_url"], "https://commons.wikimedia.org/wiki/File:Photo.jpg")
        self.assertEqual(plain("<span> A &amp; B </span>"), "A & B")


if __name__ == "__main__":
    unittest.main()
