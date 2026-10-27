#!/usr/bin/env python3
"""Regression tests for the seasonal-stat collection queue."""
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from players_stats_transfermarkt import (  # noqa: E402
    filter_candidates,
    latest_stat_fetch_by_tm,
    parse_seasons,
    refresh_priority_key,
    select_refresh_candidates,
    valid_season_payload,
)


class CandidateSelectionTests(unittest.TestCase):
    def test_threshold_keeps_equal_and_higher_values(self):
        cards = [
            {"transfermarkt_id": "1", "market_value_eur": 599999},
            {"transfermarkt_id": "2", "market_value_eur": 600000},
            {"transfermarkt_id": "3", "market_value_eur": "1200000"},
        ]
        self.assertEqual(
            [c["transfermarkt_id"] for c in filter_candidates(cards, 600000)],
            ["2", "3"],
        )

    def test_unvalued_players_are_included_only_when_requested(self):
        cards = [
            {"transfermarkt_id": "1", "market_value_eur": None},
            {"transfermarkt_id": "2", "market_value_eur": 200000},
        ]
        self.assertEqual(
            [c["transfermarkt_id"] for c in filter_candidates(cards, 0)],
            ["2"],
        )
        self.assertEqual(
            [c["transfermarkt_id"] for c in filter_candidates(
                cards, 0, include_unvalued=True)],
            ["1", "2"],
        )


    def test_refresh_prioritizes_missing_and_oldest_stats(self):
        cards = [
            {"id": "1", "transfermarkt_id": "1", "market_value_eur": 120000000},
            {"id": "2", "transfermarkt_id": "2", "market_value_eur": 60000000},
            {"id": "3", "transfermarkt_id": "3", "market_value_eur": 90000000},
        ]
        latest = latest_stat_fetch_by_tm([
            {"tm_player_id": "1", "fetched_at": "2026-10-26T10:00:00Z"},
            {"tm_player_id": "2", "fetched_at": "2026-09-07T03:00:00Z"},
        ])
        ordered = sorted(cards, key=lambda card: refresh_priority_key(card, latest))
        self.assertEqual([card["transfermarkt_id"] for card in ordered], ["3", "2", "1"])

    def test_daily_top_value_cohort_precedes_the_rolling_queue(self):
        cards = [
            {"id": "daily-star", "category": "player", "transfermarkt_id": "1",
             "market_value_eur": 100000000, "market_value_at": "2026-10-07",
             "born_on": "2000-01-01", "fame": 97,
             "player_stats_checked_at": "2026-10-26T00:00:00Z"},
            {"id": "stale-price", "category": "player", "transfermarkt_id": "2",
             "market_value_eur": 80000000, "market_value_at": "2025-01-01",
             "born_on": "2000-01-01"},
            {"id": "rotating", "category": "player", "transfermarkt_id": "3",
             "market_value_eur": 50000000, "market_value_at": "2026-10-01",
             "born_on": "2000-01-01"},
            {"id": "woman", "category": "woman", "transfermarkt_id": "4",
             "market_value_eur": 60000000, "market_value_at": "2026-10-01",
             "born_on": "2000-01-01"},
        ]
        selected = select_refresh_candidates(
            cards, {"3": "2026-10-20T00:00:00Z"},
            limit=2, priority_limit=1, today=date(2026, 10, 27),
        )
        self.assertEqual([card["id"] for card in selected], ["daily-star", "stale-price"])

    def test_match_level_payload_is_aggregated_by_actual_season_competition_and_club(self):
        def game(season, competition, club, minutes, goals=0, assists=0,
                 participation="played", yellow=False, red=False):
            return {
                "gameInformation": {
                    "seasonId": season,
                    "competitionId": competition,
                    "competitionTypeId": 1,
                },
                "clubsInformation": {"club": {"clubId": club}},
                "statistics": {
                    "generalStatistics": {"participationState": participation},
                    "goalStatistics": {
                        "goalsScoredTotal": goals,
                        "assists": assists,
                        "ownGoalsScored": 0,
                        "penaltyGoalsScored": 0,
                        "teamGoalsOnThePitch": 2,
                        "opponentGoalsOnThePitch": 1,
                    },
                    "cardStatistics": {
                        "yellowCard": yellow,
                        "yellowRedCard": False,
                        "redCard": red,
                    },
                    "playingTimeStatistics": {"playedMinutes": minutes},
                },
            }

        rows = parse_seasons({"success": True, "data": {"performance": [
            game(2026, "GB1", "11", 90, goals=1, assists=1, yellow=True),
            game(2026, "GB1", "11", 35, goals=0, assists=1),
            game(2026, "CL", "11", 80, goals=1, red=True),
            game(2025, "GB1", "11", 90, goals=2),
            game(2026, "GB1", "11", 90, goals=9, participation="unusedSubstitute"),
        ]}})
        by_key = {(r["season_id"], r["competition_id"], r["club_id"]): r for r in rows}
        premier_league = by_key[(2026, "GB1", "11")]
        self.assertEqual(
            (premier_league["apps"], premier_league["minutes"],
             premier_league["goals"], premier_league["assists"], premier_league["yellow"]),
            (2, 125, 1, 2, 1),
        )
        self.assertEqual(by_key[(2026, "CL", "11")]["apps"], 1)
        self.assertEqual(by_key[(2025, "GB1", "11")]["goals"], 2)
        self.assertFalse(any(row["goals"] == 9 for row in rows))

    def test_only_valid_tmapi_success_envelopes_are_checkpointable(self):
        self.assertTrue(valid_season_payload({
            "success": True, "data": {"performance": []}
        }))
        self.assertFalse(valid_season_payload({"error": "temporary upstream failure"}))
        self.assertFalse(valid_season_payload({
            "success": True, "data": {"unexpected": []}
        }))
        self.assertFalse(valid_season_payload({
            "success": True,
            "data": {"performance": [{"generalInformation": {"seasonId": 2026}}]},
        }))
        self.assertFalse(valid_season_payload({
            "success": True,
            "data": {"performance": [{
                "gameInformation": {"competitionId": "GB1"},
                "clubsInformation": {"club": {"clubId": "11"}},
                "statistics": {},
            }]},
        }))
        self.assertFalse(valid_season_payload(None))

    def test_empty_source_attempts_rotate_behind_never_checked_players(self):
        cards = [
            {"id": "never", "transfermarkt_id": "1", "market_value_eur": 10_000_000,
             "player_stats_checked_at": None},
            {"id": "empty-old", "transfermarkt_id": "2", "market_value_eur": 20_000_000,
             "player_stats_checked_at": "2026-10-01T00:00:00Z"},
            {"id": "empty-new", "transfermarkt_id": "3", "market_value_eur": 30_000_000,
             "player_stats_checked_at": "2026-10-26T00:00:00Z"},
        ]
        ordered = sorted(cards, key=lambda card: refresh_priority_key(card, {}))
        self.assertEqual([card["id"] for card in ordered], ["never", "empty-old", "empty-new"])

    def test_latest_stats_timestamp_uses_most_recent_row(self):
        latest = latest_stat_fetch_by_tm([
            {"tm_player_id": "316264", "fetched_at": "2026-09-07T03:00:00Z"},
            {"tm_player_id": "316264", "fetched_at": "2026-10-26T13:15:00Z"},
            {"tm_player_id": None, "fetched_at": "2026-10-27T00:00:00Z"},
        ])
        self.assertEqual(latest, {"316264": "2026-10-26T13:15:00Z"})

    def test_old_career_rows_do_not_count_as_current_season_refresh(self):
        stored = [
            {"tm_player_id": "316264", "season_id": 2025, "fetched_at": "2026-10-26T13:15:00Z"},
            {"tm_player_id": "132098", "season_id": 2024, "fetched_at": "2026-10-26T13:15:00Z"},
            {"tm_player_id": "2", "season_id": 2026, "fetched_at": "2026-10-27T10:00:00Z"},
        ]
        latest = latest_stat_fetch_by_tm(stored, season_id=2026)
        self.assertEqual(latest, {"2": "2026-10-27T10:00:00Z"})

        cards = [
            {"id": "odegaard", "transfermarkt_id": "316264", "market_value_eur": 70000000},
            {"id": "kane", "transfermarkt_id": "132098", "market_value_eur": 60000000},
            {"id": "refreshed", "transfermarkt_id": "2", "market_value_eur": 100000000},
        ]
        ordered = sorted(cards, key=lambda card: refresh_priority_key(card, latest))
        self.assertEqual(
            [card["transfermarkt_id"] for card in ordered],
            ["316264", "132098", "2"],
        )

    def test_current_season_timestamp_wins_over_newer_historical_timestamp(self):
        latest = latest_stat_fetch_by_tm([
            {"tm_player_id": "316264", "season_id": 2025, "fetched_at": "2026-10-27T12:00:00Z"},
            {"tm_player_id": "316264", "season_id": 2026, "fetched_at": "2026-10-20T12:00:00Z"},
            {"tm_player_id": "316264", "season_id": 2026, "fetched_at": "2026-10-26T13:15:00Z"},
        ], season_id=2026)
        self.assertEqual(latest, {"316264": "2026-10-26T13:15:00Z"})

    def test_invalid_values_do_not_break_the_queue(self):
        cards = [
            {"transfermarkt_id": "1", "market_value_eur": "unknown"},
            {"transfermarkt_id": "2", "market_value_eur": 0},
        ]
        self.assertEqual(
            [c["transfermarkt_id"] for c in filter_candidates(
                cards, 0, include_unvalued=True)],
            ["2"],
        )


if __name__ == "__main__":
    unittest.main()
