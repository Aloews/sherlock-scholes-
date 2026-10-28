"""Dry-run or apply the same rarity-tier rules as public.card_tier_for_signals."""
import os
import re
import sys
from datetime import date

import requests
from dotenv import load_dotenv

HERE = os.path.dirname(__file__)
SCRAPER = os.path.join(HERE, "..", "football_scraper")
APPLY = os.environ.get("APPLY") == "1"

TIERS = ("icon", "legendary", "epic", "prospect", "rare", "common")
VALUE_MAX_AGE_DAYS = 548
PROSPECT_VALUE_20 = 20_000_000
PROSPECT_VALUE_23 = 40_000_000
RARE_VALUE = 50_000_000
EPIC_VALUE = 100_000_000


def fetch_all(url, key, table, sel):
    out, offset = [], 0
    while True:
        response = requests.get(
            url.rstrip("/") + f"/rest/v1/{table}",
            headers={"apikey": key, "Authorization": "Bearer " + key},
            params={"select": sel, "order": "id.asc", "limit": 1000, "offset": offset},
            timeout=30,
        )
        response.raise_for_status()
        page = response.json()
        out.extend(page)
        if len(page) < 1000:
            return out
        offset += 1000


def has_verified_honours(card):
    facts = card.get("facts")
    honours = facts.get("honours") if isinstance(facts, dict) else None
    if not isinstance(honours, list):
        return False
    for item in honours:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        try:
            count = int(item.get("count") or 1)
        except (TypeError, ValueError):
            count = 0
        if (len(title) >= 3 and count >= 1
                and not re.search(r"\{\{|\}\}|\|url\s*=|https?://", title, re.I)
                and title.casefold().strip(" «»„“”\\\".,:;!?") not in {"награда", "награды"}):
            return True
    return False


def fame_tier(fame, verified_honours=False):
    try:
        fame = int(fame or 0)
    except (TypeError, ValueError):
        fame = 0
    # Popularity alone cannot grant legendary: require a structured, source-backed
    # award record. High fame without award evidence remains rare.
    if fame >= 99 and verified_honours:
        return "legendary"
    if fame >= 75:
        return "rare"
    return "common"


def signals(card, today=None):
    today = today or date.today()
    age = None
    try:
        born = date.fromisoformat(str(card.get("born_on"))[:10])
        age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    except (TypeError, ValueError):
        pass

    value = 0
    try:
        value = int(card.get("market_value_eur") or 0)
    except (TypeError, ValueError):
        pass

    value_is_current = False
    try:
        valued_at = date.fromisoformat(str(card.get("market_value_at"))[:10])
        value_is_current = 0 <= (today - valued_at).days <= VALUE_MAX_AGE_DAYS
    except (TypeError, ValueError):
        pass

    prospect = (
        card.get("category") in ("player", "woman")
        and age is not None
        and 16 <= age <= 23
        and value_is_current
        and ((age <= 20 and value >= PROSPECT_VALUE_20)
             or (age <= 23 and value >= PROSPECT_VALUE_23))
    )

    value_tier = "common"
    if card.get("category") in ("player", "woman") and value_is_current:
        if value >= EPIC_VALUE:
            value_tier = "epic"
        elif prospect:
            value_tier = "prospect"
        elif value >= RARE_VALUE:
            value_tier = "rare"

    return {
        "age": age,
        "value": value,
        "value_is_current": value_is_current,
        "value_tier": value_tier,
        "has_verified_honours": has_verified_honours(card),
        "fame_tier": fame_tier(card.get("fame"), has_verified_honours(card)),
        "prospect": prospect,
    }


def tier_for(card, today=None):
    if card.get("tier") == "icon":
        return "icon"

    base = fame_tier(card.get("fame"), has_verified_honours(card))
    if card.get("category") not in ("player", "woman"):
        return base

    s = signals(card, today=today)
    if not s["value_is_current"]:
        return base

    value_tier = s["value_tier"]
    if base == "legendary":
        return "legendary"
    if base == "epic" or value_tier == "epic":
        return "epic"
    if base == "prospect" or value_tier == "prospect":
        return "prospect"
    if base == "rare" or value_tier == "rare":
        return "rare"
    return "common"


def dist(cards):
    result = {tier: 0 for tier in TIERS}
    for card in cards:
        result[tier_for(card)] += 1
    return result


def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")

    headers = {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    columns = "id,name,category,fame,born_on,market_value_eur,market_value_at,tier,facts"
    cards = fetch_all(url, key, "cards", columns)
    players = [card for card in cards if card.get("category") in ("player", "woman")]

    print("CARD TIERS — " + ("APPLY" if APPLY else "DRY-RUN"))
    print("cards=%d players=%d" % (len(cards), len(players)))
    counts = dist(cards)
    for tier in TIERS:
        print("%-10s %6d (%5.1f%%)" % (
            tier, counts[tier], 100 * counts[tier] / max(len(cards), 1)
        ))

    print("\nExamples by tier:")
    for tier in TIERS:
        examples = sorted(
            (card for card in players if tier_for(card) == tier),
            key=lambda card: (
                -(int(card.get("market_value_eur") or 0)),
                -(int(card.get("fame") or 0)),
                card.get("name") or "",
            ),
        )
        print("\n%s (%d)" % (tier.upper(), len(examples)))
        for card in examples[:8]:
            s = signals(card)
            reasons = ["fame=%s/%s" % (card.get("fame"), s["fame_tier"])]
            if s["value_is_current"] and s["value"]:
                reasons.append("value=€%s/%s" % (format(s["value"], ","), s["value_tier"]))
            elif card.get("market_value_eur") is not None:
                reasons.append("value=stale-or-undated")
            print("  %-28s %s" % ((card.get("name") or "")[:28], "; ".join(reasons)))

    changed = [card for card in cards if tier_for(card) != card.get("tier")]
    print("\nTier corrections required: %d" % len(changed))
    if not APPLY:
        print("DRY-RUN — no database changes.")
        return

    for card in changed:
        response = requests.patch(
            url.rstrip("/") + "/rest/v1/cards",
            headers=headers,
            params={"id": "eq." + str(card["id"])},
            json={"tier": tier_for(card)},
            timeout=30,
        )
        response.raise_for_status()
    print("Updated tiers: %d" % len(changed))


if __name__ == "__main__":
    main()
