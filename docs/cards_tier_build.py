"""Card RARITY TIERS (cards.tier) — foundation for the future collectible
mechanic. DRY-RUN by default: computes a tier for every card from data we
ALREADY have (pageviews + facts.titles/tournaments + tags), prints the
distribution (should be a pyramid), pageviews percentiles, a threshold sweep,
and example cards per tier. Set APPLY=1 to PATCH cards.tier (needs the ALTER in
supabase/migrations/cards_tier.sql). 0 Wikidata budget — pure DB read.

Four tiers, most-rare first:
  legendary  Ballon d'Or (tag/ title "Золотой мяч") OR mega-fame pageviews
  epic       any prestige title, OR World Cup + high pageviews, OR star tag,
             OR high pageviews
  rare       played a major tournament, OR has national-team facts, OR
             mid pageviews
  common     everyone else (incl. non-player cards: no player signals)

Run from football_scraper/:  python ../docs/cards_tier_build.py
"""
import os, sys, json, statistics
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import requests
from dotenv import load_dotenv

HERE = os.path.dirname(__file__)
SCRAPER = os.path.join(HERE, "..", "football_scraper")
APPLY = os.environ.get("APPLY") == "1"

TIERS = ("legendary", "epic", "rare", "common")

# Tunable pageviews thresholds (Wikipedia pageviews; players only, others NULL).
LEG_PV = 90000     # mega-fame -> legendary, but only with a WC/title (anti-spike)
EPIC_WC_PV = 18000 # a World Cup / Euro player above this -> epic
RARE_PV = 10000    # top-level regular -> rare (above the median crowd)


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


def signals(card):
    facts = card.get("facts") or {}
    tags = set(card.get("tags") or [])
    titles = facts.get("titles") or []
    tours = facts.get("tournaments") or []
    return {
        "pv": card.get("pageviews") or 0,
        "ballon": "ballon_dor" in tags or any("Золотой мяч" in t for t in titles),
        "title": bool(titles),
        "wc": "world_cup" in tags or any(t.startswith("ЧМ") or t.startswith("Евро") for t in tours),
        "star": "star" in tags,
        "nat": bool(facts.get("national_team") or facts.get("national_caps")),
    }


def tier_for(card, leg_pv=LEG_PV, epic_wc_pv=EPIC_WC_PV, rare_pv=RARE_PV):
    s = signals(card)
    # legendary: a Ballon d'Or, or mega pageviews BACKED by a real football
    # signal (World Cup/Euro or a prestige title). The wc/title gate keeps
    # recency spikes out — a backup keeper or a transfer-saga journeyman can
    # outscore Pelé on raw pageviews, but has no tournament/title.
    # ("star" reserved for a future composite-fame backfill; empty today.)
    if s["ballon"] or s["star"] or (s["pv"] >= leg_pv and (s["wc"] or s["title"])):
        return "legendary"
    # epic: a prestige individual title (Ballon d'Or etc.), or a notable
    # World Cup / Euro player. Pure pageviews does NOT promote to epic —
    # Wikipedia hits are too recency-biased (Лунин/Мудрик outscore legends);
    # mega-famous-but-no-tournament names are curated up by hand in the admin.
    if s["title"] or (s["wc"] and s["pv"] >= epic_wc_pv):
        return "epic"
    # rare: a major-tournament player, or a mid-fame regular. ("nat" — having a
    # national team — is NOT used: nearly every player has one, so it floods.)
    if s["wc"] or s["pv"] >= rare_pv:
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

    sel = "id,name,category,pageviews,facts,tags" + (",tier" if APPLY else "")
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
