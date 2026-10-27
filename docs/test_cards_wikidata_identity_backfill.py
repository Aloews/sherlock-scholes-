#!/usr/bin/env python3
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cards_wikidata_identity_backfill import (
    entity_matches_card,
    normalize_name,
    transfermarkt_id,
)


def entity(name="Sophia Smith", alias="Sophia Wilson", occupation="Q937857",
           tm_id="12345", description="American soccer player"):
    return {
        "id": "Q123",
        "labels": {"en": {"value": name}},
        "aliases": {"en": [{"value": alias}]},
        "descriptions": {"en": {"value": description}},
        "claims": {
            "P106": [{"mainsnak": {"datavalue": {"value": {"id": occupation}}}}],
            "P2020": [{"mainsnak": {"datavalue": {"value": tm_id}}}],
        },
    }


class WikidataIdentityTests(unittest.TestCase):
    def test_name_normalization_ignores_diacritics_and_punctuation(self):
        self.assertEqual(normalize_name("Aitana Bonmatí"), normalize_name("Aitana-Bonmati"))

    def test_verified_footballer_alias_matches(self):
        card = {"name_en": "Sophia Wilson", "category": "woman"}
        candidate = entity()
        self.assertTrue(entity_matches_card(card, candidate))
        self.assertEqual(transfermarkt_id(candidate), "12345")

    def test_rejects_unrelated_footballer(self):
        card = {"name_en": "Alex Morgan", "category": "woman"}
        candidate = entity(name="Sophia Smith", alias="Sophia Smith")
        self.assertFalse(entity_matches_card(card, candidate))

    def test_rejects_non_footballer(self):
        card = {"name_en": "Sophia Wilson", "category": "woman"}
        candidate = entity(occupation="Q33999", description="American actor")
        self.assertFalse(entity_matches_card(card, candidate))

    def test_transfermarkt_id_must_be_numeric(self):
        candidate = entity(tm_id="not-an-id")
        self.assertIsNone(transfermarkt_id(candidate))


if __name__ == "__main__":
    unittest.main()
