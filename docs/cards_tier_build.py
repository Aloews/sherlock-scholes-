"""Card RARITY TIERS (cards.tier), computed only from verified football data.

Six tiers, from most exceptional to ordinary:
  icon       reserved for manually curated all-time icons
  legendary  Ballon d'Or or proven historic elite
  epic       prestige titles / major tournament plus strong fame
  prospect   age <=20 with current value >= EUR 20m, or age <=23 with value >= EUR 40m
  rare       major tournament or meaningful fame
  common     everyone else

The prospect tier rewards exceptional potential and current market value; it does
not claim the player is already a legend. It requires a verified birth date and
a Transfermarkt valuation updated within 18 months. DRY-RUN by default. Set
APPLY=1 only after reviewing the proposed distribution and examples.
"""
import os, sys, json, statistics
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import requests
from dotenv import load_dotenv

HERE = os.path.dirname(__file__)
SCRAPER = os.path.join(HERE, "..", "football_scraper")
APPLY = os.environ.get("APPLY") == "1"

TIERS = ("icon", "legendary", "epic", "prospect", "rare", "common")

# Tunable pageviews thresholds (Wikipedia pageviews; players only, others NULL).
LEG_PV = 90000     # mega-fame -> legendary, but only with a WC/title (anti-spike)
EPIC_WC_PV = 18000 # a World Cup / Euro player above this -> epic
RARE_PV = 10000    # top-level regular -> rare (above the median crowd)
PROSPECT_VALUE_20 = 20_000_000
PROSPECT_VALUE_23 = 40_000_000
VALUE_MAX_AGE_DAYS = 548


def fetch_all(url, key, table, sel, extra=None):
    out, off = [], 0
    while True:
        p = {"select": sel, "order": "id.asc", "limit": 1000, "offset": off}
        p.update(extra or {})
        r = requests.get(url.rstrip("/") + f"/rest/v1/{table}",
                         headers={"apikey": key, "Authorization": "Bearer " + key},
                         params=p, timeout=30)
        r.raise_for_status()
        b = r.json(); out += b
        if len(b) < 1000:
            break
        off += 1000
    return out


def signals(card, today=None):
    from datetime import date
    today = today or date.today()
    facts = card.get("facts") or {}
    tags = set(card.get("tags") or [])
    titles = facts.get("titles") or []
    tours = facts.get("tournaments") or []
    age = None
    try:
        born = date.fromisoformat(str(card.get("born_on"))[:10])
        age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    except (TypeError, ValueError):
        pass
    value_is_current = False
    try:
        updated = date.fromisoformat(str(card.get("market_value_at"))[:10])
        value_is_current = 0 <= (today - updated).days <= VALUE_MAX_AGE_DAYS
    except (TypeError, ValueError):
        pass
    value = card.get("market_value_eur") or 0
    prospect = (
        card.get("category") in ("player", "woman")
        and age is not None and 16 <= age <= 23
        and value_is_current
        and ((age <= 20 and value >= PROSPECT_VALUE_20)
             or (age <= 23 and value >= PROSPECT_VALUE_23))
    )
    value_tier = "common"
    if card.get("category") in ("player", "woman") and value_is_current:
        if value >= 100_000_000:
            value_tier = "epic"
        elif prospect:
            value_tier = "prospect"
        elif value >= 50_000_000:
            value_tier = "rare"
    return {
        "pv": card.get("pageviews") or 0,
        "fame": card.get("fame") or 0,
        "fame_tier": fame_tier(card.get("fame")),
        "ballon": "ballon_dor" in tags or any("Золотой мяч" in t for t in titles),
        "title": bool(titles),
        "wc": "world_cup" in tags or any(t.startswith("ЧМ") or t.startswith("Евро") for t in tours),
        "star": "star" in tags,
        "nat": bool(facts.get("national_team") or facts.get("national_caps")),
        "value_is_current": value_is_current,
        "value_tier": value_tier,
        "prospect": prospect,
    }


def fame_tier(fame):
    try:
        fame = int(fame)
    except (TypeError, ValueError):
        fame = 0
    if fame >= 99:
        return "legendary"
    if fame >= 95:
        return "epic"
    if fame >= 75:
        return "rare"
    return "common"


def tier_for(card, leg_pv=LEG_PV, epic_wc_pv=EPIC_WC_PV, rare_pv=RARE_PV, today=None):
    if card.get("tier") == "icon":
        return "icon"
    base = fame_tier(card.get("fame"))
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


def dist(cards, **kw):
    d = {t: 0 for t in TIERS}
    for c in cards:
        d[tier_for(c, **kw)] += 1
    return d


def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")
    patch_h = {"apikey": key, "Authorization": "Bearer " + key,
               "Content-Type": "application/json", "Prefer": "return=minimal"}

    sel = "id,name,category,pageviews,facts,tags,born_on,market_value_eur,market_value_at,tier"
    cards = fetch_all(url, key, "cards", sel)
    players = [c for c in cards if c.get("category") in ("player", "woman")]
    total = len(cards)

    print("=" * 64)
    print("CARD TIERS — DRY-RUN" if not APPLY else "CARD TIERS — APPLY")
    print("=" * 64)
    print("total cards   : {}".format(total))
    print("  player+woman: {}".format(len(players)))
    print("  other       : {}".format(total - len(players)))

    pvs = sorted((c.get("pageviews") or 0) for c in players if c.get("pageviews"))
    if pvs:
        def pct(p):
            return pvs[min(len(pvs) - 1, int(len(pvs) * p))]
        print("\npageviews (players with a score, n={}):".format(len(pvs)))
        print("  max {} | p99 {} | p95 {} | p90 {} | p80 {} | p75 {} | p50 {:.0f}".format(
            pvs[-1], pct(0.99), pct(0.95), pct(0.90), pct(0.80), pct(0.75),
            statistics.median(pvs)))

    # signal prevalence (how rare is each signal across player+woman cards)
    sg = {k: 0 for k in ("ballon", "title", "wc", "star", "nat")}
    for c in players:
        s = signals(c)
        for k in sg:
            sg[k] += 1 if s[k] else 0
    print("\nsignal prevalence (of {} player+woman):".format(len(players)))
    for k in sg:
        print("  {:7}: {:5} ({:.1f}%)".format(k, sg[k], 100 * sg[k] / max(len(players), 1)))

    d = dist(cards)
    print("\n=== DISTRIBUTION (chosen thresholds) ===")
    print("  LEG_PV={} EPIC_WC_PV={} RARE_PV={}".format(
        LEG_PV, EPIC_WC_PV, RARE_PV))
    for t in TIERS:
        bar = "█" * max(1, round(60 * d[t] / max(total, 1)))
        print("  {:10}: {:5} ({:4.1f}%)  {}".format(t, d[t], 100 * d[t] / max(total, 1), bar))
    pyramid = d["legendary"] <= d["epic"] <= d["rare"] <= d["common"]
    print("  pyramid (leg<=epic<=rare<=common): {}".format("YES" if pyramid else "NO"))

    print("\n=== THRESHOLD SWEEP (legendary / epic / rare / common) ===")
    for lp, ewc, rp in [(90000, 18000, 12000), (90000, 18000, 9000),
                        (120000, 20000, 10000), (70000, 15000, 8000)]:
        dd = dist(cards, leg_pv=lp, epic_wc_pv=ewc, rare_pv=rp)
        print("  LEG>={:>6} WC>={:>5} RARE>={:>5} -> {:>4} / {:>4} / {:>5} / {:>5}".format(
            lp, ewc, rp, dd["legendary"], dd["epic"], dd["rare"], dd["common"]))

    print("\n=== EXAMPLES per tier (players, by pageviews desc) ===")
    for t in TIERS:
        ex = sorted([c for c in players if tier_for(c) == t],
                    key=lambda c: -(c.get("pageviews") or 0))
        print("\n  {} ({}):".format(t.upper(), sum(1 for c in cards if tier_for(c) == t)))
        for c in ex[:8]:
            s = signals(c)
            why = ",".join(k for k in ("ballon", "title", "wc", "star", "nat") if s[k])
            print("    {:28} pv={:>6} [{}]".format(c["name"][:28], s["pv"], why))

    if not APPLY:
        print("\nDRY-RUN — nothing written. Set APPLY=1 to PATCH cards.tier.")
        return

    changed = 0
    for c in cards:
        t = tier_for(c)
        if t != c.get("tier"):
            requests.patch(url.rstrip("/") + "/rest/v1/cards", headers=patch_h,
                           params={"id": "eq." + str(c["id"])},
                           json={"tier": t}, timeout=30).raise_for_status()
            changed += 1
    print("\nAPPLIED — cards.tier PATCHed on {} cards.".format(changed))


if __name__ == "__main__":
    main()
