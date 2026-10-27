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
    assert tier_for(card, today=date(2026, 10, 20)) == "prospect"


def test_prospect_requires_current_value_and_verified_birth_date():
    base = {
        "category": "player",
        "born_on": "2007-01-01",
        "market_value_eur": 60_000_000,
    }
    assert tier_for({**base, "market_value_at": "2024-01-01"}, today=date(2026, 10, 20)) == "common"
    assert tier_for({**base, "market_value_at": "2026-10-01", "born_on": None}, today=date(2026, 10, 20)) == "common"


def test_prospect_does_not_override_historic_legend_signals():
    card = {
        "category": "player",
        "born_on": "2007-01-01",
        "market_value_eur": 60_000_000,
        "market_value_at": "2026-10-01",
        "fame": 99,
    }
    assert tier_for(card, today=date(2026, 10, 20)) == "legendary"





def test_odegaard_epic_tier_is_fame_driven_not_just_market_value():
    card = {
        "category": "player",
        "fame": 97,
        "born_on": "1998-12-17",
        "market_value_eur": 70_000_000,
        "market_value_at": "2026-07-22",
    }
    assert tier_for(card, today=date(2026, 10, 27)) == "epic"
    assert signals(card, today=date(2026, 10, 27))["value_tier"] == "rare"


def test_one_award_does_not_promote_a_low_fame_player_to_epic():
    card = {
        "category": "player",
        "fame": 50,
        "facts": {"titles": ["Обладатель Кубка страны"]},
        "born_on": "1998-01-01",
        "market_value_eur": 70_000_000,
        "market_value_at": "2026-10-01",
    }
    assert tier_for(card, today=date(2026, 10, 20)) == "rare"


def test_elite_current_market_value_lifts_low_fame_senior_to_epic():
    card = {
        "category": "player",
        "fame": 50,
        "born_on": "1998-01-01",
        "market_value_eur": 140_000_000,
        "market_value_at": "2026-10-01",
    }
    assert tier_for(card, today=date(2026, 10, 20)) == "epic"


def test_high_value_prospect_does_not_get_downgraded_by_ordinary_fame():
    card = {
        "category": "player",
        "fame": 58,
        "born_on": "2007-02-24",
        "market_value_eur": 60_000_000,
        "market_value_at": "2026-09-06",
    }
    assert tier_for(card, today=date(2026, 10, 27)) == "prospect"


def test_non_player_cannot_be_promoted_by_market_value():
    card = {
        "category": "club",
        "born_on": "2007-01-01",
        "market_value_eur": 60_000_000,
        "market_value_at": "2026-10-01",
    }
    assert tier_for(card, today=date(2026, 10, 20)) == "common"


def test_manually_curated_icon_tier_is_preserved():
    card = {"category": "player", "tier": "icon", "born_on": "2007-01-01", "market_value_eur": 60_000_000, "market_value_at": "2026-10-01"}
    assert tier_for(card, today=date(2026, 10, 20)) == "icon"
