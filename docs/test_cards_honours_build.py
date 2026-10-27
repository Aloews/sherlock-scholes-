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
            {"title": "Обладатель «Золотого мяча» по версии France Football", "count": 1, "kind": "personal"},
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
        self.assertFalse(any("{{" in item["title"] or "|url=" in item["title"] for item in honours))
        self.assertFalse(any(item["title"].strip() == "Награда" for item in honours))

    def test_legacy_title_merge_removes_old_template_fragments(self):
        merged = merge_legacy_titles(
            [
                "Золотой мяч 2026",
                "Игрок месяца {{cite web |url=https ×7",
                "Игрок года в «Тоттенхэм Хотспур",
                "Награда",
                "Чемпион Германии ×2",
            ],
            [{"title": "Золотой мяч", "count": 1, "kind": "personal"}],
        )
        self.assertEqual(merged, ["Золотой мяч 2026", "Чемпион Германии ×2"])

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
