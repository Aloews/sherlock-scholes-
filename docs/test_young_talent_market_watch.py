import unittest
from datetime import date

from young_talent_market_watch import (
    base_talent_score,
    build_snapshots,
    verified_honour_totals,
)


class YoungTalentMarketWatchTests(unittest.TestCase):
    def test_only_young_players_with_recent_source_dated_values_are_ranked(self):
        cards = [
            {
                "id": "young",
                "name": "Young Winner",
                "category": "player",
                "born_on": "2005-06-01",
                "market_value_eur": 50_000_000,
                "market_value_at": "2026-09-01",
                "transfermarkt_id": "123",
                "facts": {"honours": [{"title": "Победитель Лиги чемпионов УЕФА", "count": 1, "kind": "team"}]},
            },
            {
                "id": "stale",
                "name": "Stale Value",
                "category": "player",
                "born_on": "2005-06-01",
                "market_value_eur": 50_000_000,
                "market_value_at": "2025-01-01",
                "facts": {"honours": [{"title": "Трофей", "count": 3, "kind": "personal"}]},
            },
            {
                "id": "old",
                "name": "Older Player",
                "category": "player",
                "born_on": "2000-01-01",
                "market_value_eur": 100_000_000,
                "market_value_at": "2026-09-01",
            },
            {
                "id": "no-birth",
                "name": "Unknown Age",
                "category": "player",
                "born_on": None,
                "market_value_eur": 100_000_000,
                "market_value_at": "2026-09-01",
            },
        ]
        rows = build_snapshots(cards, date(2026, 10, 28))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["card_id"], "young")
        self.assertEqual(rows[0]["verified_award_wins"], 1)
        self.assertEqual(rows[0]["source_url"], "https://www.transfermarkt.com/spieler/profil/spieler/123")

    def test_award_count_excludes_malformed_and_non_winning_outcomes(self):
        facts = {
            "honours": [
                {"title": "Золотой мяч", "count": 8, "kind": "personal"},
                {"title": "Победитель Лиги чемпионов УЕФА", "count": 3, "kind": "team"},
                {"title": "Финалист Лиги чемпионов УЕФА", "count": 2, "kind": "team"},
                {"title": "{{cite web |url=https", "count": 2022, "kind": "team"},
                {"title": "Награда", "count": 1, "kind": "personal"},
            ]
        }
        self.assertEqual(verified_honour_totals(facts), (3, 11))

    def test_score_rewards_verified_awards_and_higher_current_value(self):
        low, low_components = base_talent_score(22, 5_000_000, 0)
        high, high_components = base_talent_score(19, 50_000_000, 8)
        self.assertGreater(high, low)
        self.assertGreater(high_components["verified_award_wins"], low_components["verified_award_wins"])
        self.assertGreater(high_components["market_value"], low_components["market_value"])
        self.assertLessEqual(high, 80)
        self.assertGreaterEqual(low, 0)

    def test_duplicate_award_records_do_not_double_count(self):
        facts = {
            "honours": [
                {"title": "Золотой мяч", "count": 8, "kind": "personal"},
                {"title": "Золотой мяч", "count": 8, "kind": "personal"},
            ]
        }
        self.assertEqual(verified_honour_totals(facts), (1, 8))


if __name__ == "__main__":
    unittest.main()
