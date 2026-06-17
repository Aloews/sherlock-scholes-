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
  2. photos         cards without photo_url -> ruwiki/Wikidata image.  (run.py --cards-photos)
  3. translations   untranslated card names -> card_translations.      (run.py --cards-translations)
  4. legend/career  FREE cache-only reprocess of legend_career+titles. (reprocess, APPLY=1)
  5. tier           recompute tier LAST so new stars/facts/titles count. (tier_build, APPLY=1)

Budget: steps 1-3 spend the shared Wikimedia budget; 4-5 spend ZERO (pure DB).
Putting the free steps last means a budget wall in steps 1-3 still lets tier +
legend reprocess run to completion every day.

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
    ("1/5 newcomers (resolve + facts/tier/wc2026)",
     [PY, os.path.join(HERE, "cards_enrich_newcomers.py"), "--apply"], _env()),
    ("2/5 photos (cards without photo_url)",
     [PY, "run.py", "--cards-photos"], _env()),
    ("3/5 translations (card_translations)",
     [PY, "run.py", "--cards-translations"], _env()),
    ("4/5 legend/career reprocess (free, cache-only)",
     [PY, os.path.join(HERE, "cards_legend_career_reprocess.py")], _env(APPLY="1")),
    ("5/5 tier recompute (after new stars/facts)",
     [PY, os.path.join(HERE, "cards_tier_build.py")], _env(APPLY="1")),
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
