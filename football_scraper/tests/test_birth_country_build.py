import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "docs"))

from cards_birth_country_build import item_ids, resolve_birth_country


def statement(qid, rank="normal"):
    return {
        "rank": rank,
        "mainsnak": {"datavalue": {"value": {"id": qid}}},
    }


class BirthCountryBuildTests(unittest.TestCase):
    def test_prefers_wikidata_preferred_rank(self):
        claims = {"P19": [statement("Q2"), statement("Q1", "preferred")]}
        self.assertEqual(item_ids(claims, "P19"), ["Q1", "Q2"])

    def test_resolves_country_via_birthplace_p19_then_country_p17(self):
        player_claims = {"P19": [statement("Q100")]}
        places = {
            "Q100": {
                "claims": {"P17": [statement("Q200")]},
                "labels": {"ru": {"value": "Йошкар-Ола"}},
            }
        }
        countries = {"Q200": {"ru": "Россия", "en": "Russia"}}
        self.assertEqual(
            resolve_birth_country(player_claims, places, countries),
            ("Россия", "Q200", "Q100", "Йошкар-Ола"),
        )

    def test_does_not_infer_birth_country_from_nationality(self):
        self.assertIsNone(resolve_birth_country({}, {}, {}))
        self.assertIsNone(resolve_birth_country({"P19": [statement("Q100")]}, {}, {}))

    def test_skips_place_without_country_claim(self):
        player_claims = {"P19": [statement("Q100")]}
        places = {"Q100": {"claims": {}, "labels": {"en": {"value": "Somewhere"}}}}
        self.assertIsNone(resolve_birth_country(player_claims, places, {}))


if __name__ == "__main__":
    unittest.main()
