import unittest

from cards_honours_build import parse_honours


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
