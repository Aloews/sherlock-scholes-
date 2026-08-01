"""Daily deck-enrichment ORCHESTRATOR.

Runs the enrichment steps in dependency order, each as its own subprocess so
one step hitting the daily Wikimedia budget (photos_budget.json /
pageviews_budget.json = 5000) NEVER aborts the chain — the runner logs it and
moves on. Every underlying script is cache-first and idempotent, so re-running
the orchestrator simply RESUMES where the budget ran out (the on-disk cache +
budget files, carried between CI runs, are the checkpoint).

ORDER (why):
  1. newcomers      bare cards (facts IS NULL) need RESOLVE first to warm the
                    caches the later DB-only scripts read; also fills facts/tier/
                    wc2026 for just those cards.            (cards_enrich_newcomers --apply)
  2. career_stats   full Wikipedia career (clubs+apps+goals) for legends and any
                    clubs_minutes-tail player missing it — fixes cards showing 1
                    club instead of the real set. Runs AFTER newcomers so
                    facts.birth_year (its namesake check) is warm. (career_build APPLY=1)
  3. photos         cards without photo_url -> ruwiki/Wikidata image.  (run.py --cards-photos)
  4. translations   untranslated card names -> card_translations.      (run.py --cards-translations)
  5. legend/career  FREE cache-only reprocess of legend_career+titles. (reprocess, APPLY=1)
  6. tier           recompute tier LAST so new stars/facts/titles count. (tier_build, APPLY=1)
  7. fame           recompute cards.fame LAST of all — it is a PERCENTILE, so
                    every step above (new cards, pageviews, active flips) shifts
                    the scale. Also re-derives tier + the Pro 'legend' tag from
                    the refreshed fame, which is why it runs after step 6, not
                    before it.                        (cards_fame_refresh.py)

Budget: steps 1-4 spend the shared Wikimedia budget; 5-7 spend ZERO (pure DB).
Putting the free steps last means a budget wall in steps 1-4 still lets tier +
legend reprocess + fame refresh run to completion every day.

Note: the daily workflow (.github/workflows/daily-enrich.yml) also runs
cards_pageviews_i18n.py AFTER this orchestrator, which changes the very metric
fame is computed from — so the workflow re-runs cards_fame_refresh.py again
after that step. Running it here too keeps a standalone `python
docs/daily_enrich.py` correct on its own.

Run from anywhere:  python docs/daily_enrich.py
CI:                  see .github/workflows/daily-enrich.yml
Requires SUPABASE_URL + SUPABASE_KEY (service_role) in the env (or .env).
"""
import os
import sys
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRAPER = os.path.join(ROOT, "football_scraper")
PY = sys.executable or "python"


def _env(**extra):
    e = dict(os.environ)
    e.update(extra)
    return e


# (label, argv, env) — all run with cwd=SCRAPER (run.py modes need it; the
# docs/ scripts compute their own paths, so cwd is harmless for them).
STEPS = [
    ("1/7 newcomers (resolve + facts/tier/wc2026)",
     [PY, os.path.join(HERE, "cards_enrich_newcomers.py"), "--apply"], _env()),
    ("2/7 career_stats (legends + clubs_minutes-tail players)",
     [PY, os.path.join(HERE, "cards_career_build.py")], _env(APPLY="1")),
    ("3/7 photos (cards without photo_url)",
     [PY, "run.py", "--cards-photos"], _env()),
    ("4/7 translations (card_translations)",
     [PY, "run.py", "--cards-translations"], _env()),
    ("5/7 legend/career reprocess (free, cache-only)",
     [PY, os.path.join(HERE, "cards_legend_career_reprocess.py")], _env(APPLY="1")),
    ("6/7 tier recompute (after new stars/facts)",
     [PY, os.path.join(HERE, "cards_tier_build.py")], _env(APPLY="1")),
    ("7/7 fame recompute (percentile drifts on every import)",
     [PY, os.path.join(HERE, "cards_fame_refresh.py")], _env()),
]


def main():
    print("=" * 70, flush=True)
    print("DAILY ENRICH — %d steps, continue-on-error, resumable" % len(STEPS), flush=True)
    print("=" * 70, flush=True)

    results = []
    for label, argv, env in STEPS:
        print("\n" + "-" * 70, flush=True)
        print(">>> STEP %s" % label, flush=True)
        print("    $ %s" % " ".join(argv), flush=True)
        print("-" * 70, flush=True)
        try:
            rc = subprocess.run(argv, cwd=SCRAPER, env=env).returncode
        except Exception as exc:  # never let a launch failure kill the chain
            print("!!! STEP FAILED TO LAUNCH: %r" % exc, flush=True)
            rc = -1
        # A non-zero exit is logged but NOT fatal — a budget wall or a transient
        # network blip in one step must not stop the free downstream steps.
        results.append((label, rc))
        print("<<< STEP %s -> exit %d%s" % (label, rc, "" if rc == 0 else "  (continuing)"),
              flush=True)

    print("\n" + "=" * 70, flush=True)
    print("DAILY ENRICH SUMMARY", flush=True)
    for label, rc in results:
        print("  [%s] %s" % ("ok " if rc == 0 else "warn", label), flush=True)
    print("=" * 70, flush=True)
    # The orchestrator itself always exits 0: per-step failures are expected
    # (budget walls) and reported. Health is judged by cards_audit.py, the
    # workflow's final gating step.


if __name__ == "__main__":
    main()
