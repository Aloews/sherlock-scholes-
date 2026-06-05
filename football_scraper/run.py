#!/usr/bin/env python3
"""Pilot runner for the football scraper.

  python3 run.py --dry-run   # fetch + enrich, print the plan, write NOTHING
  python3 run.py             # fetch + enrich, then UPSERT into players_meta

Environment variables (never hardcode keys):
  FOOTBALL_API_KEY   API-Football (api-sports.io) key   [required both modes]
  SUPABASE_URL       Supabase project URL               [required for real run]
  SUPABASE_KEY       Supabase service/anon key          [required for real run]
"""
import argparse
import os

from scraper.api_football import ApiFootballClient, RateLimiter, RequestBudget
from scraper.cache import FileCache
from scraper.config import load_config, require_env
from scraper.pipeline import Pipeline, to_db_rows
from scraper.supabase_writer import SupabaseWriter
from scraper.wikidata import WikidataEnricher

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def build_pipeline(cfg, api_key):
    cache = FileCache(
        os.path.join(BASE_DIR, cfg["cache"]["dir"]), cfg["cache"]["enabled"]
    )
    rate_limiter = RateLimiter(cfg["rate_limit"]["min_pause_seconds"])
    budget = RequestBudget(cfg["rate_limit"]["daily_request_budget"])
    api = ApiFootballClient(
        cfg["base_url"], api_key, cache, rate_limiter, cfg["retry"], budget
    )
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    return Pipeline(cfg, api, wikidata), api, budget


def print_plan(cfg, teams, rows, budget, dry_run):
    with_ru = sum(1 for r in rows if r["name_ru"])
    with_qid = sum(1 for r in rows if r["wikidata_qid"])
    with_minutes = sum(1 for r in rows if r["_minutes"] is not None)
    team_names = ", ".join(t.get("name", "?") for t in teams) or "(none)"

    print("=" * 60)
    print("FOOTBALL SCRAPER — PILOT PLAN")
    print("=" * 60)
    print("Mode             : {}".format("DRY RUN (no write)" if dry_run else "LIVE (upsert)"))
    print("League id        : {}".format(cfg["league_id"]))
    print("Season           : {}".format(cfg["season"]))
    print("Teams (limit {})  : {}".format(cfg.get("pilot_limit_teams", 1), team_names))
    print("Players found    : {}".format(len(rows)))
    print("  with minutes   : {}".format(with_minutes))
    print("  with wikidata  : {}".format(with_qid))
    print("  with name_ru   : {}".format(with_ru))
    print("API-Football reqs: {} / {} budget".format(budget.used, budget.limit))
    print("-" * 60)
    sample = rows[:10]
    for r in sample:
        print(
            "  [{}] {:<26} ru={!s:<22} {}/{}".format(
                r["api_football_id"],
                (r["name_en"] or "")[:26],
                r["name_ru"] or "—",
                r["name_source"],
                r["name_confidence"],
            )
        )
    if len(rows) > len(sample):
        print("  ... and {} more".format(len(rows) - len(sample)))
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Football scraper — pilot run")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and enrich, print the plan, but DO NOT write to Supabase.",
    )
    parser.add_argument(
        "--config", default=os.path.join(BASE_DIR, "config.json")
    )
    args = parser.parse_args()

    cfg = load_config(args.config)

    # Fail fast on missing credentials BEFORE spending any API quota.
    api_key = require_env("FOOTBALL_API_KEY")
    if not args.dry_run:
        supa_url = require_env("SUPABASE_URL")
        supa_key = require_env("SUPABASE_KEY")

    pipeline, _api, budget = build_pipeline(cfg, api_key)

    teams = pipeline.collect_teams()
    players = pipeline.collect_players(teams)
    rows = pipeline.build_rows(players)

    print_plan(cfg, teams, rows, budget, args.dry_run)

    if args.dry_run:
        print("DRY RUN — nothing written to Supabase (players_meta untouched).")
        return

    writer = SupabaseWriter(supa_url, supa_key)
    written = writer.upsert(to_db_rows(rows))
    print("Upserted {} row(s) into players_meta.".format(len(written)))


if __name__ == "__main__":
    main()
