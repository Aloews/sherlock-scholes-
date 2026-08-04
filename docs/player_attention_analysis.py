"""READ-ONLY analysis: does attention predict a player's effectiveness?

Recomputes every number quoted in docs/PLAYER_ATTENTION_ANALYSIS.md so the
claims there can be re-derived instead of trusted. Nothing is written: no
tables, no columns, no API-Football calls. Pure GET against PostgREST.

WHAT IT MEASURES, AND THE TRAP IT EXISTS TO PROVE

  cards.pageviews is ru-wiki ONLY. The deck's real recognizability axis is
  cards.fame, the percentile of

      GREATEST(pageviews_ru, max over the 8 languages in pageviews_i18n)

  (supabase/migrations/deck_fame.sql). The two disagree so badly that they
  behave like different variables — this script quantifies that, because
  anything built on cards.pageviews alone inherits the error.

  Effectiveness is career goals per appearance, summed over cards.career_stats
  (an array of per-club {apps, goals} aggregates). It is position-dependent,
  so it is compared WITHIN position, never across.

Correlations are Spearman (Pearson over tie-averaged ranks): pageviews are
heavy-tailed, and a raw Pearson there measures a handful of superstars rather
than the deck.

Run from anywhere:  python docs/player_attention_analysis.py
Requires SUPABASE_URL + SUPABASE_KEY in the env (or football_scraper/.env).
"""
import io
import json
import os
import sys

import requests
from dotenv import load_dotenv

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.join(HERE, "..", "football_scraper")

# Career totals below this are too short to read a rate off: one hot loan at
# 6 goals in 8 games would outrank a career striker.
MIN_APPS = 50


def fetch_all(url, key, table, select, page_size=1000):
    endpoint = url.rstrip("/") + "/rest/v1/" + table
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    rows, offset = [], 0
    while True:
        resp = requests.get(
            endpoint, headers=headers,
            params={"select": select, "order": "id.asc",
                    "limit": page_size, "offset": offset},
            timeout=60,
        )
        resp.raise_for_status()
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def ranks(values):
    """Tie-averaged ranks — ties must share a rank or Spearman is skewed."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    out = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        shared = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            out[order[k]] = shared
        i = j + 1
    return out


def pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = sum((x - mx) ** 2 for x in xs) ** 0.5
    dy = sum((y - my) ** 2 for y in ys) ** 0.5
    return None if dx == 0 or dy == 0 else num / (dx * dy)


def spearman(xs, ys):
    return pearson(ranks(xs), ranks(ys))


def percentiles(values):
    """percent_rank(), 0..100 — the same shape refresh_card_fame() stores.

    percent_rank counts strictly-smaller values, so a tie group takes the
    rank of its FIRST member, not the tie-average used for Spearman.
    """
    n = len(values)
    if n < 2:
        return [0.0] * n
    first_rank = {}
    for idx, v in enumerate(sorted(values)):
        first_rank.setdefault(v, idx)
    return [100.0 * first_rank[v] / (n - 1) for v in values]


def attention_of(card):
    """The deck's real axis: GREATEST(ru, max over the other languages)."""
    i18n = card.get("pageviews_i18n") or {}
    best_i18n = max([int(v) for v in i18n.values()] or [0])
    return max(int(card.get("pageviews") or 0), best_i18n)


def effectiveness_of(card):
    """(apps, goals) summed over the per-club career_stats array."""
    stats = card.get("career_stats")
    if not isinstance(stats, list):
        return None
    apps = goals = 0
    for row in stats:
        if not isinstance(row, dict):
            return None
        if row.get("apps") is None or row.get("goals") is None:
            return None
        apps += int(row["apps"])
        goals += int(row["goals"])
    return (apps, goals) if apps else None


def section(title):
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")

    cards = fetch_all(
        url, key, "cards",
        "id,name,name_en,category,active,position_ru,pageviews,pageviews_i18n,"
        "fame,career_stats")
    players = [c for c in cards if c.get("category") == "player" and c.get("active")]

    section("SAMPLE")
    print("  cards total            : %d" % len(cards))
    print("  active player cards    : %d" % len(players))

    # ---- 1. the two attention metrics disagree -------------------------
    scored = [(c, attention_of(c)) for c in players]
    scored = [(c, a) for c, a in scored if a > 0]
    ru = [float(c.get("pageviews") or 0) for c, _ in scored]
    att = [float(a) for _, a in scored]

    pct_ru, pct_att = percentiles(ru), percentiles(att)
    shifts = [abs(a - r) for a, r in zip(pct_att, pct_ru)]

    section("1. cards.pageviews (ru only) vs the real attention axis")
    print("  players with attention > 0     : %d" % len(scored))
    print("  Spearman(ru-only, true axis)   : %.3f" % spearman(ru, att))
    print("  mean |percentile shift|        : %.1f points" % (sum(shifts) / len(shifts)))
    print("  moved >= 25 percentile points  : %d  (%.0f%%)"
          % (sum(1 for s in shifts if s >= 25), 100.0 * sum(1 for s in shifts if s >= 25) / len(shifts)))
    print("  moved >= 50 percentile points  : %d  (%.0f%%)"
          % (sum(1 for s in shifts if s >= 50), 100.0 * sum(1 for s in shifts if s >= 50) / len(shifts)))

    worst = sorted(scored, key=lambda p: p[1] / max(float(p[0].get("pageviews") or 0), 1.0),
                   reverse=True)
    print("\n  Worst ru-only misreads (high global attention, ~none on ru-wiki):")
    for c, a in [p for p in worst if p[1] > 50000][:5]:
        print("    %-26s ru=%-7s true=%-9d fame=%s"
              % (c["name"][:26], c.get("pageviews"), a, c.get("fame")))

    # ---- 2. no-i18n cards are ranked on the broken signal ---------------
    no_i18n = [c for c in players if not c.get("pageviews_i18n")]
    section("2. Coverage gap")
    print("  players with no pageviews_i18n : %d  (%.0f%% — ranked on ru only)"
          % (len(no_i18n), 100.0 * len(no_i18n) / len(players)))
    print("  players with fame IS NULL      : %d"
          % sum(1 for c in players if c.get("fame") is None))

    # ---- 3. attention vs effectiveness ---------------------------------
    rows = []
    for c, a in scored:
        eff = effectiveness_of(c)
        if eff and eff[0] >= MIN_APPS:
            rows.append((c, a, eff[1] / float(eff[0])))

    section("3. Does attention track effectiveness? (goals per appearance)")
    print("  players with both signals      : %d  (min %d apps)" % (len(rows), MIN_APPS))
    print("  Spearman(true attention, g/app): %+.3f"
          % spearman([r[1] for r in rows], [r[2] for r in rows]))
    print("  Spearman(ru-only,       g/app) : %+.3f"
          % spearman([float(r[0].get("pageviews") or 0) for r in rows], [r[2] for r in rows]))

    print("\n  Within position (g/app only means something inside one):")
    by_pos = {}
    for c, a, gpa in rows:
        by_pos.setdefault(c.get("position_ru") or "—", []).append((a, gpa))
    for pos, vals in sorted(by_pos.items(), key=lambda kv: -len(kv[1])):
        if len(vals) < 30:
            continue
        rho = spearman([v[0] for v in vals], [v[1] for v in vals])
        print("    %-16s n=%-5d Spearman %+.3f" % (pos, len(vals), rho))

    # ---- 4. identical career blobs -------------------------------------
    blobs = {}
    for c in players:
        if isinstance(c.get("career_stats"), list) and c["career_stats"]:
            blobs.setdefault(json.dumps(c["career_stats"], sort_keys=True,
                                        ensure_ascii=False), []).append(c)
    clashes = {k: v for k, v in blobs.items() if len(v) > 1}
    section("4. Cards sharing one identical career_stats blob")
    print("  distinct blobs shared by >1 card : %d" % len(clashes))
    print("  cards involved                   : %d" % sum(len(v) for v in clashes.values()))
    print("\n  Sample (same name_en = duplicate card; differing = namesake collision):")
    for v in sorted(clashes.values(), key=lambda v: -sum(r["apps"] for r in v[0]["career_stats"]))[:5]:
        kind = "duplicate" if len({c.get("name_en") for c in v}) == 1 else "COLLISION"
        print("    [%-9s] %s" % (kind, "  ||  ".join(
            "%s (%s, fame %s)" % (c["name"], c.get("name_en") or "?", c.get("fame")) for c in v)))

    print("\n" + "=" * 70)
    print("Read docs/PLAYER_ATTENTION_ANALYSIS.md for what these numbers mean.")
    print("=" * 70)


if __name__ == "__main__":
    main()
