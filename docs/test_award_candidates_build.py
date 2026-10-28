import unittest
from unittest.mock import Mock, patch

from award_candidates_build import (AWARD_MODEL_VERSION, OVERALL_SPECS, aggregate_player_match_stats, aggregate_women_match_stats, canonical_match_competition, get_player_match_rows, build_team_candidate_payloads, competition_format, competition_strength, current_player_stats_coverage, filter_verified_season_stats, merge_season_stats_with_match_fallback, extract_explicit_award_outcomes, is_rankable_competition, normal_key, normalize_base_url, percentile, remove_stale_award_snapshot_rows, score_population, upsert_rows, canonical_team_tournament)
from datetime import date


class CandidateRankingTests(unittest.TestCase):
    def test_failed_postgrest_upsert_includes_server_error_body(self):
        response = Mock(ok=False, status_code=400, text='{"message":"award_key violates check constraint"}')
        with patch("award_candidates_build.requests.post", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "award_key violates check constraint"):
                upsert_rows("https://example.supabase.co", "test-key", "award_outcome",
                            [{"award_key": "unknown"}], "award_key,award_year,card_id,result,competition_id")


    def test_current_season_coverage_counts_only_fresh_high_value_active_players(self):
        snapshot = date(2026, 10, 27)
        cards = [
            {"id": "a", "name": "A", "active": True, "category": "player",
             "transfermarkt_id": "1", "market_value_eur": 100000000,
             "market_value_at": "2026-07-22", "born_on": "2000-01-01", "fame": 95,
             "player_stats_data_synced_at": "2026-10-26T12:00:00Z",
             "player_stats_checked_at": "2026-10-26T12:00:00Z"},
            {"id": "b", "name": "B", "active": True, "category": "player",
             "transfermarkt_id": "2", "market_value_eur": 80000000,
             "market_value_at": "2026-06-01", "born_on": "1998-01-01", "fame": 90,
             "player_stats_data_synced_at": "2026-10-26T12:00:00Z",
             "player_stats_checked_at": "2026-10-27T12:00:00Z"},
            {"id": "stale", "name": "Stale value", "active": True, "category": "player",
             "transfermarkt_id": "3", "market_value_eur": 70000000,
             "market_value_at": "2025-01-01", "born_on": "2000-01-01", "fame": 90},
            {"id": "retired", "name": "Retired", "active": True, "category": "player",
             "transfermarkt_id": "4", "market_value_eur": 60000000,
             "market_value_at": "2026-07-22", "born_on": "1970-01-01", "fame": 100},
        ]
        coverage = current_player_stats_coverage(cards, {"a"}, snapshot, limit=100)
        self.assertEqual(coverage["sample_size"], 2)
        self.assertEqual(coverage["covered"], 1)
        self.assertEqual(coverage["missing"], 1)
        self.assertEqual(coverage["missing_names"], ["B"])
        self.assertEqual(coverage["coverage"], 0.5)

        # A legacy row does not count as current coverage until the match-feed
        # snapshot has been verified recently.
        coverage_with_legacy_row = current_player_stats_coverage(
            cards, {"a", "b"}, snapshot, limit=100
        )
        self.assertEqual(coverage_with_legacy_row["covered"], 1)
        self.assertEqual(coverage_with_legacy_row["missing_names"], ["B"])

        match_fallback = current_player_stats_coverage(
            cards, set(), snapshot, limit=100, match_card_ids={"a"}
        )
        self.assertEqual(match_fallback["covered"], 1)

    def test_unverified_legacy_season_rows_are_excluded_from_award_scores(self):
        rows = [
            {"card_id": "a", "season_id": 2026, "goals": 37},
            {"card_id": "b", "season_id": 2026, "goals": 2},
        ]
        self.assertEqual(
            filter_verified_season_stats(rows, {"b"}),
            [{"card_id": "b", "season_id": 2026, "goals": 2}],
        )

    def test_verified_season_totals_take_precedence_over_partial_match_feed(self):
        season_totals = {
            "kane": {
                "card_id": "kane", "apps": 16, "minutes": 1288,
                "goals": 16, "assists": 9, "stats_source": "player_season_stat",
            },
        }
        match_totals = {
            # The tracked match feed only has the league and Champions League rows.
            "kane": {
                "card_id": "kane", "apps": 10, "minutes": 810,
                "goals": 8, "assists": 7, "stats_source": "player_match_stats",
            },
            # A player with no verified season snapshot can still use a qualified fallback.
            "palmer": {
                "card_id": "palmer", "apps": 10, "minutes": 836,
                "goals": 4, "assists": 3, "stats_source": "player_match_stats",
            },
            "small-sample": {
                "card_id": "small-sample", "apps": 2, "minutes": 180,
                "goals": 2, "assists": 0, "stats_source": "player_match_stats",
            },
        }

        merged = merge_season_stats_with_match_fallback(season_totals, match_totals)

        self.assertEqual(merged["kane"]["goals"], 16)
        self.assertEqual(merged["kane"]["assists"], 9)
        self.assertEqual(merged["kane"]["stats_source"], "player_season_stat")
        self.assertEqual(merged["palmer"]["goals"], 4)
        self.assertEqual(merged["palmer"]["stats_source"], "player_match_stats")
        self.assertNotIn("small-sample", merged)

    def test_explicit_year_winner_titles_create_outcomes_without_inventing_undated_years(self):
        cards = [
            {
                "id": "kane",
                "category": "player",
                "facts": {
                    "titles": ["Золотой мяч 2026", "Чемпион Германии ×2", "Игрок месяца"],
                    "honours_source": "https://ru.wikipedia.org/wiki/Гарри_Кейн",
                },
            },
            {
                "id": "player-no-source",
                "category": "player",
                "facts": {"titles": ["Золотой мяч 2026"]},
            },
            {
                "id": "other-player",
                "category": "player",
                "facts": {
                    "titles": ["Golden Boy 2025", "The Best FIFA Men's Player 2024"],
                    "honours_source": "https://example.org/player",
                },
            },
            {
                "id": "alexia",
                "category": "woman",
                "facts": {
                    "titles": ["Золотой мяч ×2", "Золотой мяч 2026"],
                    "honours_source": "https://ru.wikipedia.org/wiki/Алексия_Путельяс",
                    "award_sources": {
                        "ballon_dor_feminin:2026": "https://www.uefa.com/news-media/news/2026-ballon-dor/"
                    },
                    "award_announcement_dates": {
                        "ballon_dor_feminin:2026": "2026-10-26T20:00:00+00:00"
                    },
                },
            },
        ]
        outcomes = extract_explicit_award_outcomes(cards)
        identity = {(row["award_key"], row["award_year"], row["card_id"]) for row in outcomes}
        self.assertEqual(identity, {
            ("ballon_dor", 2026, "kane"),
            ("golden_boy", 2025, "other-player"),
            ("the_best", 2024, "other-player"),
            ("ballon_dor_feminin", 2026, "alexia"),
        })
        self.assertTrue(all(row["result"] == "winner" for row in outcomes))
        self.assertTrue(all(row["source_url"].startswith("https://") for row in outcomes))
        female = next(row for row in outcomes if row["card_id"] == "alexia")
        self.assertEqual(female["announced_at"], "2026-10-26T20:00:00+00:00")
        self.assertEqual(female["source_url"], "https://www.uefa.com/news-media/news/2026-ballon-dor/")
        self.assertFalse(any(row["award_year"] == 2026 and row["card_id"] == "player-no-source" for row in outcomes))

    def test_explicit_official_award_keys_support_new_categories_and_club_cards(self):
        source = "https://www.uefa.com/news-media/news/2026-awards/"
        cards = [
            {
                "id": "vicky",
                "category": "woman",
                "facts": {
                    "titles": ["Трофей Копа 2026"],
                    "award_title_keys": {"Трофей Копа 2026": "kopa_trophy_feminin:2026"},
                    "award_sources": {"kopa_trophy_feminin:2026": source},
                    "award_announcement_dates": {"kopa_trophy_feminin:2026": "2026-10-26T20:00:00+00:00"},
                },
            },
            {
                "id": "cata",
                "category": "woman",
                "facts": {
                    "titles": ["Трофей Яшина 2026"],
                    "award_title_keys": {"Трофей Яшина 2026": "yashin_trophy_feminin:2026"},
                    "award_sources": {"yashin_trophy_feminin:2026": source},
                    "award_announcement_dates": {"yashin_trophy_feminin:2026": "2026-10-26T20:00:00+00:00"},
                },
            },
            {
                "id": "psg",
                "category": "club",
                "facts": {
                    "titles": ["Мужской клуб года 2026"],
                    "award_title_keys": {"Мужской клуб года 2026": "club_of_the_year:2026"},
                    "award_sources": {"club_of_the_year:2026": source},
                    "award_announcement_dates": {"club_of_the_year:2026": "2026-10-26T20:00:00+00:00"},
                },
            },
        ]

        outcomes = extract_explicit_award_outcomes(cards)
        self.assertEqual(
            {(row["award_key"], row["award_year"], row["card_id"]) for row in outcomes},
            {
                ("kopa_trophy_feminin", 2026, "vicky"),
                ("yashin_trophy_feminin", 2026, "cata"),
                ("club_of_the_year", 2026, "psg"),
            },
        )
        self.assertTrue(all(row["source_url"] == source for row in outcomes))
        self.assertTrue(all(row["announced_at"] == "2026-10-26T20:00:00+00:00" for row in outcomes))
        self.assertTrue(all(row["verified_by"] == "official_award_source_sync" for row in outcomes))

    def test_normalize_supabase_url_removes_accidental_escape_and_trailing_slash(self):
        self.assertEqual(normalize_base_url("\\\\https://project.supabase.co/"), "https://project.supabase.co")

    def test_normalize_supabase_url_rejects_non_absolute_url(self):
        with self.assertRaises(ValueError):
            normalize_base_url("project.supabase.co")

    def test_percentile_is_monotonic(self):
        values = [10.0, 30.0, 20.0]
        ranks = percentile(values)
        self.assertLess(ranks[0], ranks[2])
        self.assertLess(ranks[2], ranks[1])

    def test_percentile_ties_share_the_same_midrank(self):
        ranks = percentile([5.0, 5.0, 10.0])
        self.assertEqual(ranks[0], ranks[1])
        self.assertGreater(ranks[2], ranks[0])
        self.assertTrue(all(0 <= rank <= 100 for rank in ranks))

    def test_single_candidate_gets_neutral_percentile(self):
        self.assertEqual(percentile([99.0]), [50.0])

    def test_empty_population_is_safe(self):
        self.assertEqual(percentile([]), [])


    def test_award_ranking_returns_explainable_relative_score_not_probability(self):
        players = [
            {"card_id": "a", "name": "Player A", "category": "player", "active": True,
             "apps": 20, "starts": 18, "minutes": 1600, "goals": 18, "assists": 7,
             "team_win_rate": .7, "sw_rating": 90, "market_value_eur": 100000000,
             "age": 24, "stats_rows": 3, "last_fetched": "2026-10-26T00:00:00Z"},
            {"card_id": "b", "name": "Player B", "category": "player", "active": True,
             "apps": 15, "starts": 12, "minutes": 1100, "goals": 5, "assists": 3,
             "team_win_rate": .5, "sw_rating": None, "market_value_eur": 10000000,
             "age": 25, "stats_rows": 2, "last_fetched": "2026-10-25T00:00:00Z"},
        ]
        rows = score_population(players, {"goals": .7, "assists": .3},
                                "golden_boot", 2026, date(2026, 10, 27), "competition-1")
        self.assertEqual(rows[0]["card_id"], "a")
        self.assertEqual(rows[0]["candidate_rank"], 1)
        self.assertEqual(rows[0]["model_version"], AWARD_MODEL_VERSION)
        self.assertEqual(rows[0]["competition_id"], "competition-1")
        self.assertFalse(rows[0]["evidence"]["score_is_probability"])
        self.assertEqual(rows[0]["evidence"]["ranking_scope"], "tracked competition competition-1")

    def test_overall_award_percentiles_use_the_broad_sample_qualified_population(self):
        population = [
            {
                "card_id": "elite-low-output", "name": "Elite Low Output", "category": "player", "active": True,
                "apps": 8, "starts": 7, "minutes": 600, "goals": 5, "assists": 0,
                "goals_per_90": 0.75, "assists_per_90": 0.0, "weighted_goals": 4.5,
                "weighted_assists": 0.0, "sw_rating": 91, "market_value_eur": 30000000,
                "fame": 80, "age": 25, "stats_rows": 2, "competition_strength": 0.9,
                "starts_known": True, "minutes_known": True, "last_fetched": None,
            },
            {
                "card_id": "high-output-low-prior", "name": "High Output Low Prior", "category": "player", "active": True,
                "apps": 10, "starts": 9, "minutes": 700, "goals": 10, "assists": 0,
                "goals_per_90": 1.29, "assists_per_90": 0.0, "weighted_goals": 6.5,
                "weighted_assists": 0.0, "sw_rating": 78, "market_value_eur": 2000000,
                "fame": 10, "age": 24, "stats_rows": 4, "competition_strength": 0.65,
                "starts_known": True, "minutes_known": True, "last_fetched": None,
            },
        ]
        rows = score_population(
            population, {"goals": 1.0}, "ballon_dor", 2026, date(2026, 10, 27)
        )
        self.assertEqual([row["card_id"] for row in rows], ["elite-low-output"])
        self.assertEqual(rows[0]["score_components"]["goals"], 0.0)
        self.assertEqual(rows[0]["evidence"]["candidate_pool_size"], 1)
        self.assertEqual(rows[0]["evidence"]["score_reference_population_size"], 2)

    def test_overall_award_excludes_profiles_without_supported_season_output(self):
        population = [
            {"card_id": "zero-output", "name": "Zero Output Keeper", "category": "player", "active": True,
             "apps": 20, "starts": 20, "minutes": 1800, "goals": 0, "assists": 0,
             "weighted_goals": 0, "weighted_assists": 0, "goals_per_90": 0, "assists_per_90": 0,
             "sw_rating": 89, "market_value_eur": 30000000, "fame": 90, "age": 29,
             "stats_rows": 20, "competition_strength": 0.95, "starts_known": True, "minutes_known": True},
            {"card_id": "productive", "name": "Productive Forward", "category": "player", "active": True,
             "apps": 8, "starts": 7, "minutes": 600, "goals": 4, "assists": 1,
             "weighted_goals": 3.6, "weighted_assists": 0.9, "goals_per_90": 0.6, "assists_per_90": 0.15,
             "sw_rating": 84, "market_value_eur": 30000000, "fame": 80, "age": 24,
             "stats_rows": 8, "competition_strength": 0.9, "starts_known": True, "minutes_known": True},
        ]
        rows = score_population(
            population, {"goals": 0.5, "assists": 0.5}, "ballon_dor", 2026, date(2026, 10, 27)
        )
        self.assertEqual([row["card_id"] for row in rows], ["productive"])
        self.assertEqual(rows[0]["evidence"]["candidate_pool_size"], 1)
        self.assertEqual(rows[0]["evidence"]["score_reference_population_size"], 2)

    def test_award_candidates_exclude_tiny_samples_and_shrink_early_form(self):
        population = [
            {"card_id": "tiny", "name": "Tiny Sample", "category": "player", "active": True,
             "apps": 2, "starts": 2, "minutes": 150, "goals": 5, "assists": 2,
             "weighted_goals": 5, "weighted_assists": 2, "goals_per_90": 3.0,
             "assists_per_90": 1.2, "sw_rating": 99, "market_value_eur": 150000000,
             "fame": 99, "age": 24, "stats_rows": 1},
            {"card_id": "eligible", "name": "Eligible Sample", "category": "player", "active": True,
             "apps": 8, "starts": 7, "minutes": 600, "goals": 6, "assists": 4,
             "weighted_goals": 4.8, "weighted_assists": 3.2, "goals_per_90": .9,
             "assists_per_90": .6, "sw_rating": 82, "market_value_eur": 60000000,
             "fame": 70, "age": 24, "stats_rows": 8},
            {"card_id": "eligible-low", "name": "Eligible Lower Sample", "category": "player", "active": True,
             "apps": 5, "starts": 4, "minutes": 320, "goals": 3, "assists": 2,
             "weighted_goals": 2.4, "weighted_assists": 1.6, "goals_per_90": .84,
             "assists_per_90": .56, "sw_rating": 65, "market_value_eur": 30000000,
             "fame": 50, "age": 23, "stats_rows": 5},
            {"card_id": "low-tier-stat-leader", "name": "Low Tier Stat Leader", "category": "player", "active": True,
             "apps": 10, "starts": 9, "minutes": 600, "goals": 6, "assists": 4,
             "weighted_goals": 3.9, "weighted_assists": 2.6, "goals_per_90": .9,
             "assists_per_90": .6, "sw_rating": 80, "market_value_eur": 2000000,
             "fame": 10, "age": 24, "competition_strength": .65, "stats_rows": 10},
        ]
        rows = score_population(
            population, OVERALL_SPECS["ballon_dor"], "ballon_dor", 2026, date(2026, 10, 27)
        )
        self.assertEqual([row["card_id"] for row in rows], ["eligible", "eligible-low"])
        self.assertNotIn("low-tier-stat-leader", [row["card_id"] for row in rows])
        self.assertLess(rows[0]["candidate_score"], rows[0]["score_components"]["unshrunk_relative_index"])
        self.assertLess(rows[0]["score_components"]["sample_reliability"], 1)
        self.assertEqual(rows[0]["evidence"]["eligibility_rule"],
                         "at least 5 appearances and 300 minutes; if minutes are unavailable, at least 8 appearances")

    def test_golden_boot_requires_goals_and_a_minimum_appearance_sample(self):
        population = [
            {"card_id": "zero-goals", "name": "Zero Goals", "category": "player", "active": True,
             "apps": 15, "starts": 10, "minutes": 900, "goals": 0, "assists": 5,
             "weighted_goals": 0, "weighted_assists": 3, "goals_per_90": 0,
             "assists_per_90": .5, "sw_rating": 80, "market_value_eur": 10000000,
             "fame": 40, "age": 25, "stats_rows": 15},
            {"card_id": "tiny-scorer", "name": "Tiny Scorer", "category": "player", "active": True,
             "apps": 2, "starts": 2, "minutes": 180, "goals": 7, "assists": 0,
             "weighted_goals": 7, "weighted_assists": 0, "goals_per_90": 3.5,
             "assists_per_90": 0, "sw_rating": 70, "market_value_eur": 1000000,
             "fame": 10, "age": 20, "stats_rows": 2},
            {"card_id": "real-scorer", "name": "Real Scorer", "category": "player", "active": True,
             "apps": 5, "starts": 5, "minutes": 450, "goals": 4, "assists": 1,
             "weighted_goals": 3.2, "weighted_assists": .8, "goals_per_90": .8,
             "assists_per_90": .2, "sw_rating": 75, "market_value_eur": 5000000,
             "fame": 20, "age": 22, "stats_rows": 5},
        ]
        rows = score_population(
            population, {"goals": .68, "goals_per_90": .12, "assists": .08, "minutes": .07, "apps": .05},
            "golden_boot", 2026, date(2026, 10, 27), "league-x"
        )
        self.assertEqual([row["card_id"] for row in rows], ["real-scorer"])
        self.assertEqual(rows[0]["evidence"]["eligibility_rule"],
                         "golden_boot: at least 3 appearances and 1 goal in this competition")

    def test_golden_boy_keeps_credible_early_season_prospects(self):
        population = [
            {"card_id": "young-two-contributions", "name": "Young Prospect", "category": "player", "active": True,
             "apps": 5, "starts": 4, "minutes": 320, "goals": 1, "assists": 1,
             "weighted_goals": 0.8, "weighted_assists": 0.8, "goals_per_90": 0.28,
             "assists_per_90": 0.28, "sw_rating": 82, "market_value_eur": 15000000,
             "fame": 70, "age": 20, "stats_rows": 5, "competition_strength": 0.8,
             "starts_known": True, "minutes_known": True},
            {"card_id": "young-zero-output", "name": "Young Zero Output", "category": "player", "active": True,
             "apps": 8, "starts": 6, "minutes": 500, "goals": 0, "assists": 0,
             "weighted_goals": 0, "weighted_assists": 0, "goals_per_90": 0,
             "assists_per_90": 0, "sw_rating": 80, "market_value_eur": 15000000,
             "fame": 70, "age": 20, "stats_rows": 8, "competition_strength": 0.8,
             "starts_known": True, "minutes_known": True},
        ]
        rows = score_population(
            population, OVERALL_SPECS["golden_boy"], "golden_boy", 2026, date(2026, 10, 27)
        )
        self.assertEqual([row["card_id"] for row in rows], ["young-two-contributions"])
        self.assertEqual(rows[0]["evidence"]["candidate_pool_size"], 1)

    def test_golden_boy_only_includes_eligible_male_cards(self):
        players = [
            {"card_id": "young", "name": "Young", "category": "player", "active": True,
             "apps": 10, "starts": 8, "minutes": 700, "goals": 3, "assists": 2,
             "team_win_rate": .5, "sw_rating": 75, "market_value_eur": 15000000,
             "age": 20, "stats_rows": 2},
            {"card_id": "old", "name": "Old", "category": "player", "active": True,
             "apps": 20, "starts": 18, "minutes": 1500, "goals": 10, "assists": 6,
             "team_win_rate": .7, "sw_rating": 90, "age": 22, "stats_rows": 2},
            {"card_id": "young-woman", "name": "Young Woman", "category": "woman", "active": True,
             "apps": 20, "starts": 18, "minutes": 1500, "goals": 10, "assists": 6,
             "team_win_rate": .7, "sw_rating": 90, "age": 19, "stats_rows": 2},
        ]
        rows = score_population(players, {"goals": .5, "assists": .5},
                                "golden_boy", 2026, date(2026, 10, 27))
        self.assertEqual([row["card_id"] for row in rows], ["young"])

    def test_match_rows_are_fetched_in_bounded_card_id_chunks(self):
        with patch("award_candidates_build.get_rows") as mocked:
            mocked.side_effect = [
                [{"card_id": "a", "match_date": "2026-08-01"}],
                [{"card_id": "b", "match_date": "2026-08-02"}],
            ]
            rows = get_player_match_rows(
                "https://example.supabase.co", "test-key", ["a", "b", "c"],
                2026, date(2026, 10, 27), chunk_size=2,
            )
        self.assertEqual([row["card_id"] for row in rows], ["a", "b"])
        self.assertEqual(mocked.call_count, 2)
        first_params = mocked.call_args_list[0].args[3]
        second_params = mocked.call_args_list[1].args[3]
        self.assertEqual(first_params["card_id"], "in.(a,b)")
        self.assertEqual(second_params["card_id"], "in.(c)")

    def test_match_competition_aliases_do_not_merge_different_premier_leagues(self):
        self.assertEqual(
            canonical_match_competition("English Premier League"),
            canonical_match_competition("Англия. Премьер-лига"),
        )
        self.assertNotEqual(
            canonical_match_competition("English Premier League"),
            canonical_match_competition("Россия. Премьер-лига"),
        )

    def test_player_match_stats_deduplicate_sources_and_exclude_friendlies(self):
        rows = [
            {"card_id": "odegaard", "match_date": "2026-08-15",
             "tournament": "English Premier League", "source": "espn",
             "minutes": None, "goals": 1, "assists": 0,
             "fetched_at": "2026-08-16T00:00:00Z", "disputed": False},
            {"card_id": "odegaard", "match_date": "2026-08-15",
             "tournament": "Англия. Премьер-лига", "source": "sports.ru",
             "minutes": 90, "goals": 1, "assists": 0,
             "fetched_at": "2026-08-17T00:00:00Z", "disputed": False},
            {"card_id": "odegaard", "match_date": "2026-08-20",
             "tournament": "UEFA Champions League", "source": "espn",
             "minutes": 75, "goals": 0, "assists": 1,
             "fetched_at": "2026-08-21T00:00:00Z", "disputed": False},
            {"card_id": "odegaard", "match_date": "2026-08-25",
             "tournament": "International Friendly", "source": "sports.ru",
             "minutes": 90, "goals": 5, "assists": 5,
             "fetched_at": "2026-08-26T00:00:00Z", "disputed": False},
            {"card_id": "odegaard", "match_date": "2026-06-15",
             "tournament": "Premier League", "source": "sports.ru",
             "minutes": 90, "goals": 4, "assists": 4,
             "fetched_at": "2026-06-16T00:00:00Z", "disputed": False},
            {"card_id": "woman-a", "match_date": "2026-08-15",
             "tournament": "English Premier League", "source": "sports.ru",
             "minutes": 90, "goals": 2, "assists": 2,
             "fetched_at": "2026-08-16T00:00:00Z", "disputed": False},
        ]
        totals = aggregate_player_match_stats(
            rows, 2026, date(2026, 10, 27), exclude_card_ids={"woman-a"}
        )
        self.assertEqual(set(totals), {"odegaard"})
        self.assertEqual(totals["odegaard"]["apps"], 2)
        self.assertEqual(totals["odegaard"]["minutes"], 165)
        self.assertEqual(totals["odegaard"]["goals"], 1)
        self.assertEqual(totals["odegaard"]["assists"], 1)
        self.assertEqual(totals["odegaard"]["stats_rows"], 2)
        self.assertEqual(totals["odegaard"]["stats_source"], "player_match_stats")
        self.assertFalse(totals["odegaard"]["starts_known"])

    def test_womens_match_stats_use_competition_season_windows_and_keep_unknown_minutes(self):
        rows = [
            {"card_id": "woman-a", "match_date": "2026-08-15", "tournament": "English Women's Super League",
             "minutes": None, "goals": 1, "assists": 1, "fetched_at": "2026-08-16T00:00:00Z"},
            {"card_id": "woman-a", "match_date": "2026-06-15", "tournament": "English Women's Super League",
             "minutes": None, "goals": 4, "assists": 0, "fetched_at": "2026-06-16T00:00:00Z"},
            {"card_id": "woman-b", "match_date": "2026-03-10", "tournament": "National Women's Soccer League",
             "minutes": None, "goals": 2, "assists": 0, "fetched_at": "2026-03-11T00:00:00Z"},
        ]
        totals = aggregate_women_match_stats(rows, 2026, date(2026, 10, 27))
        self.assertEqual(totals["woman-a"]["apps"], 1)
        self.assertEqual(totals["woman-a"]["goals"], 1)
        self.assertEqual(totals["woman-a"]["stats_window_start"], "2026-07-01")
        self.assertEqual(totals["woman-a"]["minutes"], 0)
        self.assertFalse(totals["woman-a"]["minutes_known"])
        self.assertEqual(totals["woman-b"]["apps"], 1)
        self.assertEqual(totals["woman-b"]["goals"], 2)
        self.assertEqual(totals["woman-b"]["stats_window_start"], "2026-01-01")

    def test_verified_season_source_does_not_fabricate_starting_appearances(self):
        population = [{
            "card_id": "kane", "name": "Harry Kane", "category": "player", "active": True,
            "apps": 16, "starts": 0, "starts_known": False, "minutes": 1288,
            "goals": 16, "assists": 9, "weighted_goals": 12.0, "weighted_assists": 7.0,
            "competition_strength": 0.8, "goals_per_90": 1.12, "assists_per_90": 0.63,
            "minutes_known": True, "stats_rows": 5, "stats_source": "player_season_stat",
            "last_fetched": "2026-10-27T22:09:41Z", "market_value_eur": 60000000,
            "fame": 97, "sw_rating": 95, "age": 33,
        }]

        rows = score_population(
            population, OVERALL_SPECS["ballon_dor"], "ballon_dor", 2026, date(2026, 10, 27)
        )

        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["evidence"]["starts"])
        self.assertFalse(rows[0]["evidence"]["starts_available"])
        self.assertEqual(rows[0]["evidence"]["stats_source"], "player_season_stat")

    def test_womens_award_ranking_does_not_fabricate_per90_when_minutes_are_missing(self):
        population = [{
            "card_id": "woman-a", "name": "Player A", "category": "woman", "active": True,
            "apps": 10, "starts": 0, "minutes": 0, "goals": 5, "assists": 2,
            "weighted_goals": 3.2, "weighted_assists": 1.2, "competition_strength": 0.64,
            "goals_per_90": None, "assists_per_90": None, "stats_rows": 10,
            "stats_window_start": "2026-07-01", "stats_source": "espn_player_match_stats",
            "starts_known": False, "minutes_known": False, "sw_rating": None, "market_value_eur": None,
            "fame": 50, "age": 28, "last_fetched": "2026-10-26T00:00:00Z",
        }]
        rows = score_population(population, OVERALL_SPECS["ballon_dor_feminin"],
                                "ballon_dor_feminin", 2026, date(2026, 10, 27))
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["evidence"]["goals_per_90"])
        self.assertIsNone(rows[0]["evidence"]["assists_per_90"])
        self.assertFalse(rows[0]["evidence"]["minutes_available"])
        self.assertFalse(rows[0]["evidence"]["starts_available"])
        self.assertIsNone(rows[0]["evidence"]["minutes"])
        self.assertIsNone(rows[0]["evidence"]["starts"])
        self.assertEqual(rows[0]["evidence"]["stats_source"], "espn_player_match_stats")
        self.assertEqual(rows[0]["evidence"]["candidate_pool_size"], 1)
        self.assertEqual(
            rows[0]["evidence"]["candidate_pool_scope"],
            "eligible active cards after sample-size and award-specific quality gates",
        )
        self.assertEqual(rows[0]["confidence"], "low")

    def test_exhibition_and_friendly_matches_are_not_tournament_candidates(self):
        self.assertFalse(is_rankable_competition("Товарищеские матчи (клубы)"))
        self.assertFalse(is_rankable_competition("Товарищеские матчи (сборные)"))
        self.assertFalse(is_rankable_competition("International Friendlies"))
        self.assertFalse(is_rankable_competition("Pre-season friendly"))
        self.assertTrue(is_rankable_competition("Россия. Премьер-лига"))
        self.assertTrue(is_rankable_competition("Россия. FONBET Кубок России"))
        self.assertTrue(is_rankable_competition("UEFA Nations League"))

    def test_team_candidates_exclude_friendlies_but_keep_real_competitions(self):
        matches = [
            {"tournament": "League A", "match_date": "2026-08-01", "home_key": "a",
             "away_key": "b", "home_team": "Alpha", "away_team": "Beta",
             "home_score": 2, "away_score": 0},
            {"tournament": "International Friendlies", "match_date": "2026-08-02", "home_key": "a",
             "away_key": "c", "home_team": "Alpha", "away_team": "Gamma",
             "home_score": 8, "away_score": 0},
            {"tournament": "National Cup", "match_date": "2026-08-03", "home_key": "b",
             "away_key": "c", "home_team": "Beta", "away_team": "Gamma",
             "home_score": 1, "away_score": 0},
        ]
        rows = build_team_candidate_payloads(matches, {}, date(2026, 10, 27))
        self.assertEqual({row["tournament"] for row in rows}, {"League A", "National Cup"})
        self.assertFalse(any("Friendly" in row["tournament"] for row in rows))

    def test_localized_team_tournament_aliases_merge_without_cross_competition_merges(self):
        matches = [
            {"tournament": "English Premier League", "match_date": "2026-08-22",
             "home_key": "alpha", "away_key": "beta", "home_team": "Alpha",
             "away_team": "Beta", "home_score": 1, "away_score": 0},
            {"tournament": "Англия. Премьер-лига", "match_date": "2026-08-29",
             "home_key": "beta", "away_key": "alpha", "home_team": "Beta",
             "away_team": "Alpha", "home_score": 1, "away_score": 1},
            {"tournament": "English Premier League", "match_date": "2026-08-22",
             "home_key": "alpha", "away_key": "beta", "home_team": "Alpha",
             "away_team": "Beta", "home_score": 1, "away_score": 0},
        ]
        rows = build_team_candidate_payloads(matches, {}, date(2026, 10, 27))
        self.assertEqual({row["tournament"] for row in rows}, {"English Premier League"})
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["evidence"]["matches_played"] for row in rows}, {2})

    def test_team_tournament_aliases_keep_similar_leagues_separate(self):
        self.assertEqual(canonical_team_tournament("German Bundesliga"), "German Bundesliga")
        self.assertEqual(canonical_team_tournament("Austrian Bundesliga"), "Austrian Bundesliga")
        self.assertEqual(canonical_team_tournament("German 2. Bundesliga"), "German 2. Bundesliga")
        self.assertEqual(canonical_team_tournament("Italian Serie A"), "Italian Serie A")
        self.assertEqual(canonical_team_tournament("Brazilian Serie A"), "Brazilian Serie A")
        self.assertEqual(canonical_team_tournament("UEFA Champions League"), "UEFA Champions League")
        self.assertEqual(canonical_team_tournament("AFC Champions League Elite"), "AFC Champions League Elite")

    def test_world_cup_is_classified_as_a_tournament_not_a_league(self):
        self.assertEqual(competition_format("Чемпионат мира"), "international_tournament_form_proxy")
        self.assertEqual(competition_format("Чемпионат мира U-17"), "international_tournament_form_proxy")

    def test_stale_tournaments_are_not_current_contender_shortlists(self):
        matches = [
            {"tournament": "Active League", "match_date": "2026-10-01", "home_key": "a",
             "away_key": "b", "home_team": "Alpha", "away_team": "Beta",
             "home_score": 2, "away_score": 0},
            {"tournament": "Active League", "match_date": "2026-10-08", "home_key": "b",
             "away_key": "c", "home_team": "Beta", "away_team": "Gamma",
             "home_score": 1, "away_score": 1},
            {"tournament": "Active League", "match_date": "2026-10-15", "home_key": "c",
             "away_key": "a", "home_team": "Gamma", "away_team": "Alpha",
             "home_score": 0, "away_score": 1},
            {"tournament": "Completed Cup", "match_date": "2026-07-20", "home_key": "x",
             "away_key": "y", "home_team": "X", "away_team": "Y",
             "home_score": 2, "away_score": 0},
            {"tournament": "Completed Cup", "match_date": "2026-07-25", "home_key": "y",
             "away_key": "z", "home_team": "Y", "away_team": "Z",
             "home_score": 1, "away_score": 0},
        ]
        rows = build_team_candidate_payloads(
            matches, {}, date(2026, 10, 27), max_days_since_last_match=75
        )
        self.assertEqual({row["tournament"] for row in rows}, {"Active League"})

    def test_team_key_is_stable_and_url_safe(self):
        self.assertEqual(normal_key("Manchester City"), "manchester-city")
        self.assertEqual(normal_key("ПСЖ"), "псж")
        self.assertEqual(normal_key("AFC / Team 2"), "afc-team-2")


    def test_team_candidates_cover_every_competition_and_use_stable_team_keys(self):
        matches = [
            {"tournament": "League A", "match_date": "2026-08-01", "home_key": "club-a",
             "away_key": "club-b", "home_team": "Alpha FC", "away_team": "Beta FC",
             "home_score": 2, "away_score": 0, "fetched_at": "2026-10-26T00:00:00Z"},
            {"tournament": "League A", "match_date": "2026-08-08", "home_key": "club-b",
             "away_key": "club-c", "home_team": "Beta FC", "away_team": "Gamma FC",
             "home_score": 1, "away_score": 1, "fetched_at": "2026-10-26T00:00:00Z"},
            {"tournament": "League A", "match_date": "2026-08-15", "home_key": "club-c",
             "away_key": "club-a", "home_team": "Gamma FC", "away_team": "Alpha FC",
             "home_score": 0, "away_score": 3, "fetched_at": "2026-10-26T00:00:00Z"},
            {"tournament": "National Cup", "match_date": "2026-09-01", "home_key": "club-a",
             "away_key": "club-d", "home_team": "Alpha FC", "away_team": "Delta FC",
             "home_score": 1, "away_score": 0, "fetched_at": "2026-10-26T00:00:00Z"},
            {"tournament": "National Cup", "match_date": "2026-09-08", "home_key": "club-d",
             "away_key": "club-e", "home_team": "Delta FC", "away_team": "Epsilon FC",
             "home_score": 2, "away_score": 1, "fetched_at": "2026-10-26T00:00:00Z"},
            {"tournament": "National Cup", "match_date": "2026-09-15", "home_key": "club-e",
             "away_key": "club-a", "home_team": "Epsilon FC", "away_team": "Alpha FC",
             "home_score": 0, "away_score": 2, "fetched_at": "2026-10-26T00:00:00Z"},
        ]
        rows = build_team_candidate_payloads(
            matches,
            {"club-a": {"elo": 1800}, "club-b": {"elo": 1600}, "club-c": {"elo": 1500}},
            date(2026, 10, 27),
        )
        self.assertEqual({row["tournament"] for row in rows}, {"League A", "National Cup"})
        alpha = next(row for row in rows if row["tournament"] == "League A" and row["team_key"] == "club-a")
        self.assertEqual(alpha["team_name"], "Alpha FC")
        self.assertEqual(alpha["candidate_rank"], 1)
        self.assertIn("club_elo_percentile", alpha["score_components"])
        self.assertFalse(alpha["evidence"]["score_is_probability"])
        self.assertEqual(alpha["evidence"]["competition_format"], "league_standings_proxy")
        # A missing rating is unknown, not zero strength.
        delta = next(row for row in rows if row["tournament"] == "National Cup" and row["team_key"] == "club-d")
        self.assertEqual(delta["score_components"]["club_elo_percentile"], 50.0)

    def test_team_candidates_deduplicate_results_and_keep_sparse_competitions_low_confidence(self):
        match = {"tournament": "League A", "match_date": "2026-08-01", "home_key": "a",
                 "away_key": "b", "home_team": "A", "away_team": "B", "home_score": 1,
                 "away_score": 0, "fetched_at": "2026-10-26T00:00:00Z"}
        rows = build_team_candidate_payloads(
            [match, match, {**match, "tournament": "Single match cup"}],
            {}, date(2026, 10, 27),
        )
        self.assertEqual({row["tournament"] for row in rows}, {"League A", "Single match cup"})
        self.assertEqual(len(rows), 4)  # two teams per competition; duplicate source row counted once
        self.assertTrue(all(row["confidence"] == "low" for row in rows))
        self.assertTrue(all(row["candidate_score"] < 60 for row in rows))
        self.assertTrue(all(row["score_components"]["sample_reliability"] < 0.2 for row in rows))

    def test_competition_format_distinguishes_leagues_and_knockout_cups(self):
        self.assertEqual(competition_format("Англия. Премьер-лига"), "league_standings_proxy")
        self.assertEqual(competition_format("Англия. Кубок"), "knockout_form_proxy")
        self.assertEqual(competition_format("Лига чемпионов"), "international_tournament_form_proxy")


    def test_competition_strength_downweights_lower_divisions(self):
        self.assertGreater(competition_strength("UEFA Champions League"), competition_strength("1.Lig"))
        self.assertGreater(competition_strength("Premier League"), competition_strength("1.Lig"))
        self.assertGreater(competition_strength("Premier League"), competition_strength("Russian Premier League"))
        self.assertEqual(competition_strength("Unmapped competition"), 0.5)

    def test_ballondor_and_the_best_use_distinct_weight_profiles(self):
        self.assertNotEqual(OVERALL_SPECS["ballon_dor"], OVERALL_SPECS["the_best"])
        self.assertNotEqual(OVERALL_SPECS["ballon_dor"], OVERALL_SPECS["golden_boy"])
        self.assertAlmostEqual(sum(OVERALL_SPECS["ballon_dor"].values()), 1.0)
        self.assertAlmostEqual(sum(OVERALL_SPECS["the_best"].values()), 1.0)
        self.assertAlmostEqual(sum(OVERALL_SPECS["golden_boy"].values()), 1.0)


    def test_missing_market_value_is_neutral_not_zero(self):
        players = [
            {"card_id": "unknown", "name": "Unknown value", "category": "player", "active": True,
             "apps": 10, "starts": 8, "minutes": 700, "goals": 4, "assists": 2,
             "market_value_eur": None, "fame": 80, "stats_rows": 1},
            {"card_id": "known", "name": "Known value", "category": "player", "active": True,
             "apps": 10, "starts": 8, "minutes": 700, "goals": 4, "assists": 2,
             "market_value_eur": 100000000, "fame": 50, "stats_rows": 1},
        ]
        rows = score_population(players, {"market_value_eur": 0.5, "goals": 0.5},
                                "ballon_dor", 2026, date(2026, 10, 27))
        self.assertEqual(
            next(row for row in rows if row["card_id"] == "unknown")["score_components"]["market_value_eur"],
            50.0,
        )


    @patch("award_candidates_build.requests.delete")
    def test_stale_award_rows_are_removed_only_for_the_current_snapshot(self, delete):
        response = Mock()
        response.json.return_value = [{"card_id": "stale-1"}, {"card_id": "stale-2"}]
        delete.return_value = response

        removed = remove_stale_award_snapshot_rows(
            "https://project.supabase.co/", "service-key", date(2026, 10, 27)
        )

        self.assertEqual(removed, 2)
        args, kwargs = delete.call_args
        self.assertEqual(
            args[0],
            "https://project.supabase.co/rest/v1/award_candidate_snapshot",
        )
        self.assertEqual(
            kwargs["params"],
            {
                "snapshot_date": "eq.2026-10-27",
                "model_version": f"neq.{AWARD_MODEL_VERSION}",
            },
        )
        self.assertEqual(kwargs["headers"]["Prefer"], "return=representation")
        response.raise_for_status.assert_called_once_with()

    @patch("award_candidates_build.requests.delete")
    def test_stale_award_cleanup_propagates_database_errors(self, delete):
        response = Mock()
        response.raise_for_status.side_effect = RuntimeError("database unavailable")
        delete.return_value = response
        with self.assertRaisesRegex(RuntimeError, "database unavailable"):
            remove_stale_award_snapshot_rows(
                "https://project.supabase.co", "service-key", date(2026, 10, 27)
            )

if __name__ == "__main__":
    unittest.main()
