# -*- coding: utf-8 -*-
import importlib.util
import os
import unittest

PATH = os.path.join(os.path.dirname(__file__), "cards_name_en_from_soccerwiki.py")
SPEC = importlib.util.spec_from_file_location("cards_name_en_from_soccerwiki", PATH)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class SoccerWikiNameFallbackTests(unittest.TestCase):
    def setUp(self):
        self.card = {"id": "card-1", "name": "Игрок", "name_en": None,
                     "born_on": "2001-02-10"}

    def test_uses_exact_linked_card(self):
        profile = {"card_id": "card-1", "full_name": "Luca Alberto Calabrò",
                   "born_on": "2001-02-10"}
        self.assertEqual(MOD.candidate(self.card, profile), "Luca Alberto Calabrò")

    def test_rejects_other_card(self):
        self.assertIsNone(MOD.candidate(
            self.card, {"card_id": "card-2", "full_name": "Luca Alberto Calabrò"}))

    def test_never_overwrites_existing_name(self):
        self.card["name_en"] = "Verified English Name"
        self.assertIsNone(MOD.candidate(
            self.card, {"card_id": "card-1", "full_name": "Other Name"}))

    def test_rejects_conflicting_birth_date(self):
        self.assertIsNone(MOD.candidate(self.card, {
            "card_id": "card-1", "full_name": "Luca Alberto Calabrò",
            "born_on": "1999-01-01"}))

    def test_rejects_non_latin_and_placeholder_names(self):
        self.assertIsNone(MOD.clean_name("未知の選手"))
        self.assertIsNone(MOD.clean_name("Unknown"))
        self.assertIsNone(MOD.clean_name("Ângelo Samuel Chaves"))
        self.assertEqual(MOD.clean_name("  James   Santos  "), "James Santos")


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SoccerWikiNameFallbackTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
