"""READ-ONLY deck-health audit. Writes NOTHING to the DB.

Reports the gaps the daily enrichment is meant to close, plus data-corruption
signals. Designed to be the LAST step of the daily workflow: it prints a report,
writes it to a file (uploaded as a CI artifact), and FAILS the job (exit 1) if
any career_stats row still carries wiki markup — that's corruption, not a gap,
so it must page someone rather than scroll by.

Checks (all over active cards):
  * facts IS NULL            players with no enriched facts (needs newcomers run)
  * no photo_url             cards with no image
  * no continent             players with no continent (filters break without it)
  * tier empty               cards with no rarity tier
  * career_stats MARKUP      '<ref' / '{{' / 'http' leaked into career_stats  [FATAL]
  * tier=common @ high pv    a very-viewed player stuck at 'common' (tier bug)
  * canonical_key dups       multiple active cards that fold to the same key

Run from anywhere:  python docs/cards_audit.py
Report file:        $AUDIT_REPORT or <repo>/cards_audit_report.md
Requires SUPABASE_URL + SUPABASE_KEY in the env (or football_scraper/.env).
"""
import os
import sys
import json

import requests
from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRAPER = os.path.join(ROOT, "football_scraper")
sys.path.insert(0, SCRAPER)
from scraper.dedup import canonical_key  # noqa: E402

# A player this widely viewed should never be 'common' — flag the tier bug.
HIGH_PV = 19000
MARKERS = ("<ref", "{{", "http")
REPORT = os.environ.get("AUDIT_REPORT", os.path.join(ROOT, "cards_audit_report.md"))


def fetch_all(url, key, table, select):
    rows, off = [], 0
    while True:
        r = requests.get(url.rstrip("/") + "/rest/v1/" + table,
                         headers={"apikey": key, "Authorization": "Bearer " + key},
                         params={"select": select, "order": "id.asc",
                                 "limit": 1000, "offset": off}, timeout=60)
        r.raise_for_status()
        b = r.json()
        rows += b
        if len(b) < 1000:
            break
        off += 1000
    return rows


def has_markup(career_stats):
    if not career_stats:
        return False
    blob = json.dumps(career_stats, ensure_ascii=False)
    return any(m in blob for m in MARKERS)


def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"]
    cards = fetch_all(url, key, "cards",
                      "id,name,name_en,category,active,facts,photo_url,"
                      "continent,tier,pageviews,career_stats")
    active = [c for c in cards if c.get("active")]
    players = [c for c in active if c.get("category") == "player"]

    facts_null = [c for c in players if not c.get("facts")]
    no_photo = [c for c in active if not c.get("photo_url")]
    no_continent = [c for c in players if not c.get("continent")]
    no_tier = [c for c in active if not c.get("tier")]
    markup = [c for c in cards if has_markup(c.get("career_stats"))]
    common_high_pv = [c for c in players
                      if c.get("tier") == "common" and (c.get("pageviews") or 0) >= HIGH_PV]

    # canonical_key dups among active cards (the dedup signal).
    by_key = {}
    for c in active:
        k = canonical_key(c.get("name"))
        if k:
            by_key.setdefault(k, []).append(c)
    dups = {k: v for k, v in by_key.items() if len(v) > 1}

    lines = []
    def out(s=""):
        lines.append(s)

    out("# Deck health audit")
    out("")
    out("- active cards: **%d** (players: %d)" % (len(active), len(players)))
    out("")
    out("| check | count |")
    out("| --- | ---: |")
    out("| players: facts IS NULL | %d |" % len(facts_null))
    out("| no photo_url | %d |" % len(no_photo))
    out("| players: no continent | %d |" % len(no_continent))
    out("| tier empty | %d |" % len(no_tier))
    out("| **career_stats MARKUP (FATAL)** | **%d** |" % len(markup))
    out("| tier=common @ pageviews>=%d | %d |" % (HIGH_PV, len(common_high_pv)))
    out("| canonical_key dup groups | %d |" % len(dups))
    out("")

    def sample(title, rows, fmt):
        if not rows:
            return
        out("## %s (%d)" % (title, len(rows)))
        for c in rows[:30]:
            out("- " + fmt(c))
        if len(rows) > 30:
            out("- … +%d more" % (len(rows) - 30))
        out("")

    if markup:
        sample("career_stats with wiki markup", markup,
               lambda c: "#%s %s — %s" % (c["id"], c.get("name"),
                                          json.dumps(c.get("career_stats"), ensure_ascii=False)[:160]))
    sample("tier=common at high pageviews", common_high_pv,
           lambda c: "#%s %s (pv=%s)" % (c["id"], c.get("name"), c.get("pageviews")))
    if dups:
        out("## canonical_key duplicate groups (%d)" % len(dups))
        for k, v in list(dups.items())[:30]:
            out("- `%s`: %s" % (k, ", ".join("#%s %s" % (c["id"], c.get("name")) for c in v)))
        if len(dups) > 30:
            out("- … +%d more groups" % (len(dups) - 30))
        out("")

    report = "\n".join(lines)
    print(report, flush=True)
    try:
        with open(REPORT, "w", encoding="utf-8") as f:
            f.write(report + "\n")
        print("\n[audit] report written to %s" % REPORT, flush=True)
    except Exception as exc:
        print("[audit] could not write report: %r" % exc, flush=True)

    # FAIL the job only on corruption (markup). Gaps are expected day-to-day and
    # are what the enrichment chain is slowly closing — they don't gate.
    if markup:
        print("\n[audit] FAIL: %d card(s) have wiki markup in career_stats." % len(markup),
              flush=True)
        sys.exit(1)
    print("\n[audit] OK: no career_stats markup.", flush=True)


if __name__ == "__main__":
    main()
