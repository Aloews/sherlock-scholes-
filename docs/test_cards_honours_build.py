import unittest

from cards_honours_build import merge_legacy_titles, parse_honours


class ParseHonoursTests(unittest.TestCase):
    def test_parses_new_personal_award_from_player_page(self):
        source = """
== Достижения ==
=== Командные достижения ===
* [[Чемпион Германии]] (2): 2024/25, 2025/26
=== Личные достижения ===
* Обладатель [[Золотой мяч|«Золотого мяча»]] по версии France Football: 2026
* [[Трофей Герда Мюллера]]: 2025/26
"""
        honours = parse_honours(source)
        self.assertIn(
            {"title": "Обладатель «Золотого мяча»", "count": 1, "kind": "personal"},
            honours,
        )
        self.assertIn(
            {"title": "Трофей Герда Мюллера", "count": 1, "kind": "personal"},
            honours,
        )
        self.assertIn(
            {"title": "Чемпион Германии", "count": 2, "kind": "team"},
            honours,
        )

    def test_parses_three_wins_and_deduplicates_repeated_sections(self):
        source = """
== Достижения ==
=== Личные достижения ===
* Обладатель «Золотого мяча» (3): 2021, 2022, 2026
== Награды ==
=== Личные достижения ===
* Обладатель «Золотого мяча» (3): 2021, 2022, 2026
"""
        honours = parse_honours(source)
        golden_ball = [item for item in honours if "Золотого мяча" in item["title"]]
        self.assertEqual(len(golden_ball), 1)
        self.assertEqual(golden_ball[0]["count"], 3)

    def test_ignores_tournament_appearances_outside_honours_sections(self):
        source = """
== Карьера ==
* Участник чемпионата мира 2026 года
== Достижения ==
=== Командные достижения ===
* [[Кубок Германии]]
"""
        honours = parse_honours(source)
        self.assertEqual(honours, [{"title": "Кубок Германии", "count": 1, "kind": "team"}])

    def test_empty_source_does_not_create_honours(self):
        self.assertEqual(parse_honours(""), [])
        self.assertEqual(parse_honours("== Биография ==\nТекст"), [])

    def test_legacy_titles_keep_new_awards_visible_to_deployed_clients(self):
        merged = merge_legacy_titles(
            [],
            [{"title": "Обладатель «Золотого мяча» по версии France Football",
              "count": 1, "kind": "personal"}],
        )
        self.assertEqual(merged, ["Золотой мяч"])

    def test_legacy_award_count_is_updated_without_duplicates(self):
        merged = merge_legacy_titles(
            ["Золотой мяч ×2", "Чемпион Германии ×2"],
            [{"title": "Обладатель «Золотого мяча» по версии France Football",
              "count": 3, "kind": "personal"}],
        )
        self.assertEqual(merged, ["Золотой мяч ×3", "Чемпион Германии ×2"])

    def test_existing_year_label_is_preserved_when_award_count_is_unchanged(self):
        merged = merge_legacy_titles(
            ["Золотой мяч 2026"],
            [{"title": "Обладатель «Золотого мяча» по версии France Football",
              "count": 1, "kind": "personal"}],
        )
        self.assertEqual(merged, ["Золотой мяч 2026"])

    def test_nested_citation_templates_do_not_pollute_award_titles(self):
        source = """
== Достижения ==
=== Личные достижения ===
* Игрок месяца английской Премьер-лиги (7): {{cite web |url=https://example.com |title={{lang|en|Player of the Month}}}}
* Награда {{cite web |url=https://example.com}}
* Узбекистон ифтихори (6 июня 2025 года){{Cite web |url=https
* Награда «Личность года» по версии Kicker
"""
        honours = parse_honours(source)
        self.assertIn(
            {"title": "Игрок месяца английской Премьер-лиги", "count": 7, "kind": "personal"},
            honours,
        )
        self.assertIn(
            {"title": "Награда «Личность года» по версии Kicker", "count": 1, "kind": "personal"},
            honours,
        )
        self.assertIn(
            {"title": "Узбекистон ифтихори (6 июня 2025 года)", "count": 1, "kind": "personal"},
            honours,
        )
        self.assertFalse(any("{{" in item["title"] or "|url=" in item["title"] for item in honours))
        self.assertFalse(any(item["title"].strip() == "Награда" for item in honours))

    def test_legacy_title_merge_salvages_titles_before_truncated_citations(self):
        merged = merge_legacy_titles(
            [
                "Золотой мяч 2026",
                "Игрок месяца {{cite web |url=https ×7",
                "Орден Хорватской звезды с ликом Франьо Бучара (15 ноября 2023 года){{Cite web |url=https",
                "Игрок года в «Тоттенхэм Хотспур",
                "Награда",
                "Чемпион Германии ×2",
            ],
            [{"title": "Золотой мяч", "count": 1, "kind": "personal"}],
        )
        self.assertEqual(
            merged,
            [
                "Золотой мяч 2026",
                "Игрок месяца",
                "Орден Хорватской звезды с ликом Франьо Бучара (15 ноября 2023 года)",
                "Чемпион Германии ×2",
            ],
        )

    def test_legacy_title_label_preserves_balanced_internal_quotes(self):
        merged = merge_legacy_titles(
            [],
            [{"title": "Игрок года в «Тоттенхэм Хотспур»", "count": 3, "kind": "personal"}],
        )
        self.assertEqual(merged, ["Игрок года в «Тоттенхэм Хотспур» ×3"])

    def test_messi_ballondor_eras_are_combined_into_eight(self):
        source = """
== Достижения ==
=== Личные достижения ===
* Обладатель «Золотого мяча» по версии France Football (4): 2009, 2019, 2021, 2023
* Обладатель «Золотого мяча ФИФА» (4): 2010, 2011, 2012, 2015
"""
        honours = parse_honours(source)
        ballons = [h for h in honours if "Золотого мяча" in h["title"]]
        self.assertEqual(len(ballons), 1)
        self.assertEqual(ballons[0]["count"], 8)
        self.assertEqual(merge_legacy_titles(["Золотой мяч ×4"], ballons), ["Золотой мяч ×8"])

    def test_year_in_parentheses_is_not_parsed_as_award_count(self):
        source = """
== Достижения ==
=== Личные достижения ===
* Орден «За заслуги перед Итальянской Республикой» (2022)
"""
        honours = parse_honours(source)
        self.assertEqual(
            honours,
            [{"title": "Орден «За заслуги перед Итальянской Республикой» (2022)",
              "count": 1, "kind": "personal"}],
        )

    def test_player_and_manager_champions_league_titles_are_separate(self):
        source = """
== Достижения ==
=== В качестве игрока ===
* Обладатель Кубка европейских чемпионов (2): 1988/89, 1989/90
=== В качестве главного тренера ===
* Победитель Лиги чемпионов УЕФА (5): 2002/03, 2006/07, 2013/14, 2021/22, 2023/24
"""
        honours = parse_honours(source)
        player = next(h for h in honours if h["title"] == "Обладатель Кубка европейских чемпионов")
        manager = next(h for h in honours if h["title"] == "Победитель Лиги чемпионов УЕФА")
        self.assertEqual((player["count"], player.get("role")), (2, "player"))
        self.assertEqual((manager["count"], manager.get("role")), (5, "manager"))

    def test_champions_league_wins_sum_across_clubs_but_not_duplicate_sections(self):
        source = """
== Достижения ==
=== В качестве главного тренера ===
==== «Милан» ====
* Победитель Лиги чемпионов УЕФА (2): 2002/03, 2006/07
==== «Реал Мадрид» ====
* Победитель Лиги чемпионов УЕФА (3): 2013/14, 2021/22, 2023/24
== Награды и достижения ==
=== В качестве главного тренера ===
==== «Милан» ====
* Победитель Лиги чемпионов УЕФА (2): 2002/03, 2006/07
"""
        honours = parse_honours(source)
        ucl = [h for h in honours if h["title"] == "Победитель Лиги чемпионов УЕФА"]
        self.assertEqual(len(ucl), 1)
        self.assertEqual(ucl[0]["count"], 5)
        self.assertEqual(ucl[0]["role"], "manager")

    def test_guardiola_three_champions_league_titles_across_two_clubs(self):
        source = """
== Достижения ==
=== В качестве главного тренера ===
==== «Барселона» ====
* Победитель Лиги чемпионов УЕФА (2): 2008/09, 2010/11
==== «Манчестер Сити» ====
* Победитель Лиги чемпионов УЕФА: 2022/23
"""
        ucl = [h for h in parse_honours(source) if h["title"] == "Победитель Лиги чемпионов УЕФА"]
        self.assertEqual(len(ucl), 1)
        self.assertEqual(ucl[0]["count"], 3)
        self.assertEqual(ucl[0]["role"], "manager")

    def test_non_numeric_parenthetical_is_preserved(self):
        source = """
== Достижения ==
=== Командные достижения ===
* Чемпион MLS (обладатель Кубка MLS)
"""
        honours = parse_honours(source)
        self.assertEqual(
            honours,
            [{"title": "Чемпион MLS (обладатель Кубка MLS)", "count": 1, "kind": "team"}],
        )


if __name__ == "__main__":
    unittest.main()
