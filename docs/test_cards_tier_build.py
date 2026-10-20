from datetime import date
from cards_tier_build import signals, tier_for


def test_nineteen_year_old_player_valued_at_sixty_million_is_prospect():
    card = {
        "category": "player",
        "born_on": "2007-01-01",
        "market_value_eur": 60_000_000,
        "market_value_at": "2026-10-01",
    }
    assert signals(card, today=date(2026, 10, 20))["prospect"] is True
    assert tier_for(card) == "prospect"


def test_prospect_requires_current_value_and_verified_birth_date():
    base = {
        "category": "player",
        "born_on": "2007-01-01",
        "market_value_eur": 60_000_000,
    }
    assert tier_for({**base, "market_value_at": "2024-01-01"}) == "common"
    assert tier_for({**base, "market_value_at": "2026-10-01", "born_on": None}) == "common"


def test_prospect_does_not_override_historic_legend_signals():
    card = {
        "category": "player",
        "born_on": "2007-01-01",
        "market_value_eur": 60_000_000,
        "market_value_at": "2026-10-01",
        "tags": ["ballon_dor"],
    }
    assert tier_for(card) == "legendary"


def test_non_player_cannot_be_promoted_by_market_value():
    card = {
        "category": "club",
        "born_on": "2007-01-01",
        "market_value_eur": 60_000_000,
        "market_value_at": "2026-10-01",
    }
    assert tier_for(card) == "common"
