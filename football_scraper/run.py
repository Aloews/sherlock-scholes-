#!/usr/bin/env python3
"""Pilot runner for the football scraper.

  python3 run.py --dry-run   # fetch + enrich, print the plan, write NOTHING
  python3 run.py             # fetch + enrich, then UPSERT into players_meta

  # Pageviews step (Wikimedia — separate from API-Football, no API key):
  python3 run.py --pageviews --dry-run   # plan: players, requests, seasons
  python3 run.py --pageviews             # fetch pageviews, UPSERT player_seasons

  # Transfer step (players_meta -> cards, no external API at all):
  python3 run.py --to-cards --dry-run    # plan: how many NEW players, how many dups
  python3 run.py --to-cards              # INSERT new 'player' cards (with pageviews)

  # Cards pageviews backfill (Wikimedia, key-less; makes Easy/Hard work):
  python3 run.py --cards-pageviews --dry-run   # plan: cards, requests, cache
  python3 run.py --cards-pageviews             # fetch views, PATCH cards.pageviews

  # Photos step (Wikidata P18 -> Commons Special:FilePath URL, key-less):
  python3 run.py --photos --dry-run      # plan: players with qid, requests, cache
  python3 run.py --photos                # fetch P18, write players_meta.photo_url

  # Cards photos: any card with photo_url IS NULL except terms/positions
  # (clubs, stadiums, referees, coaches, ... and old manual player cards):
  python3 run.py --cards-photos --dry-run  # plan: cards, requests, cache
  python3 run.py --cards-photos            # ruwiki title -> QID -> P154/P18,
                                           # PATCH cards.photo_url

  # Cards name_en backfill (people cards without an English name):
  python3 run.py --cards-name-en --dry-run # plan: cards, NEW requests (cache)
  python3 run.py --cards-name-en           # ruwiki -> QID -> enwiki sitelink,
                                           # PATCH cards.name_en

  # Duplicate finder (cards only, READ-ONLY, no external API, never writes):
  python3 run.py --find-dups             # list probable duplicate card pairs by id
  python3 run.py --find-dups --dup-ratio 0.80   # looser threshold = more pairs

Environment variables (never hardcode keys):
  FOOTBALL_API_KEY   API-Football (api-sports.io) key   [required: players step]
  SUPABASE_URL       Supabase project URL  [players: live; pageviews: both modes]
  SUPABASE_KEY       Supabase service/anon key  [same as SUPABASE_URL]

The --pageviews step reads players_meta from Supabase (so it needs SUPABASE_*
in BOTH modes), then queries the Wikimedia Pageviews API — which is key-less
and does NOT spend the API-Football daily budget.
"""
import sys

# Windows PowerShell defaults to cp1251 — accented player names crash print()
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import argparse
import json
import os
import re
from difflib import SequenceMatcher

import requests
from dotenv import load_dotenv

from scraper.api_football import ApiFootballClient, RateLimiter, RequestBudget
from scraper.cache import FileCache
from scraper.config import load_config, require_env
from scraper.history import run_collect_history
from scraper.dedup import (
    DEFAULT_RATIO,
    canonical_key,
    find_duplicate_pairs,
    normalize_display_name,
    strip_patronymic,
)
from scraper.pageviews import (
    PROJECT_EN,
    PROJECT_RU,
    PageviewsClient,
    WikiPagePropsClient,
    WikimediaBudget,
    resolve_article,
    season_window,
)
from scraper.pipeline import Pipeline, to_db_rows
from scraper.supabase_writer import (
    CardsClient,
    PlayerSeasonsClient,
    SupabaseWriter,
    build_forbidden_words,
)
from scraper.wikidata import WikidataEnricher, commons_filepath_url

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# League codes -> API-Football league id. --league accepts either a readable
# code (PL/PD/SA/BL1/FL1/RPL) or a raw numeric id; player_seasons.league
# stores the readable code so the table stays human-readable across leagues.
LEAGUE_CODES = {
    "PL": 39,    # Premier League (England)
    "PD": 140,   # La Liga (Spain)
    "SA": 135,   # Serie A (Italy)
    "BL1": 78,   # Bundesliga (Germany)
    "FL1": 61,   # Ligue 1 (France)
    "RPL": 235,  # Russian Premier League
    "ERE": 88,   # Eredivisie (Netherlands)
    "PRI": 94,   # Primeira Liga (Portugal)
}
LEAGUE_ID_TO_CODE = {v: k for k, v in LEAGUE_CODES.items()}


def resolve_league(value):
    """Map a --league value to (league_id, code).

    Accepts a known code (case-insensitive: SA, pl, ...) or a numeric id
    ("135" / 135). Returns (int id, text code). For a numeric id outside the
    table the code falls back to the number as a string, so any league still
    works; an unknown non-numeric value is a usage error.
    """
    text = str(value).strip()
    code = text.upper()
    if code in LEAGUE_CODES:
        return LEAGUE_CODES[code], code
    try:
        league_id = int(text)
    except ValueError:
        raise SystemExit(
            "Unknown --league '{}'. Use a code ({}) or a numeric id.".format(
                value, "/".join(LEAGUE_CODES)))
    return league_id, LEAGUE_ID_TO_CODE.get(league_id, str(league_id))


def get_league_code(cfg):
    """The league's readable code (PL/PD/...) for config lookups, or None.

    Derived from league_id via the league map, then the configured pageviews
    text (kept in sync with --league). Used to pick the right teams_filter list.
    """
    code = LEAGUE_ID_TO_CODE.get(cfg.get("league_id"))
    if not code:
        pv = cfg.get("pageviews")
        if isinstance(pv, dict):
            code = pv.get("league")
    return code


def league_label(cfg):
    """Readable 'CODE (id)' for run headers. The code comes from the league
    map, then the configured pageviews text, then falls back to just the id."""
    code = get_league_code(cfg)
    league_id = cfg.get("league_id")
    return "{} ({})".format(code, league_id) if code else str(league_id)


def teams_filter_for(cfg):
    """Explicit club list for the current league, or [] for 'whole league'.

    Reads config["teams_filter"][<league code>]. A non-empty list restricts the
    run to exactly those clubs (matched fuzzily, see scraper/team_filter.py);
    an empty/absent list (or unknown league) keeps the previous whole-league
    behaviour.
    """
    table = cfg.get("teams_filter")
    if not isinstance(table, dict):
        return []
    names = table.get(get_league_code(cfg))
    return list(names) if names else []


def _notify_pause(seconds):
    """Print a short line while the rate limiter holds us, so the long
    free-tier pause doesn't look like a freeze. The pause itself is unchanged.
    """
    print("    ...пауза ~{:.0f}s, ждём API (rate-limit)".format(seconds), flush=True)


def build_pipeline(cfg, api_key):
    cache = FileCache(
        os.path.join(BASE_DIR, cfg["cache"]["dir"]), cfg["cache"]["enabled"]
    )
    rate_limiter = RateLimiter(
        cfg["rate_limit"]["min_pause_seconds"], on_long_pause=_notify_pause
    )
    # Persist the daily request tally under cache/ (already gitignored) so
    # several runs on the same UTC day share one 100-request budget.
    budget = RequestBudget(
        cfg["rate_limit"]["daily_request_budget"],
        os.path.join(BASE_DIR, cfg["cache"]["dir"], "budget.json"),
    )
    api = ApiFootballClient(
        cfg["base_url"], api_key, cache, rate_limiter, cfg["retry"], budget
    )
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    return Pipeline(cfg, api, wikidata), api, budget


def print_run_header(cfg, teams, budget, dry_run, wanted=None, missing=None):
    """Up-front summary so the user knows what's about to happen and that the
    long pauses between teams are expected (printed BEFORE the crawl loop).

    When `wanted` (an explicit club list) is given, the header shows the filter
    mode, how many of the listed clubs were found, their API names, and any
    listed club that was not found (also in `missing`).
    """
    max_page = int(cfg.get("max_page", 3))
    est_requests = 1 + len(teams) * max_page
    print("=" * 60)
    print("СТАРТ — сбор игроков (API-Football)")
    print("=" * 60)
    print("Режим            : {}".format(
        "DRY RUN (без записи)" if dry_run else "LIVE (запись в players_meta)"))
    print("Лига / сезон     : {} / {}".format(league_label(cfg), cfg["season"]))
    if wanted:
        print("Отбор клубов     : ЯВНЫЙ СПИСОК ({} из {} найдено в API)".format(
            len(teams), len(wanted)))
    else:
        print("Отбор клубов     : вся лига (список не задан)")
    print("Команд к обработке: {}".format(len(teams)))
    print("  {}".format(", ".join(t.get("name", "?") for t in teams) or "(нет)"))
    if missing:
        print("Не найдено в API : {} -> {}".format(
            len(missing), ", ".join(missing)))
    print("Оценка запросов  : ~{} (1 /teams + {} команд x {} стр.)".format(
        est_requests, len(teams), max_page))
    print("Бюджет API сейчас: {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("Пауза между запр.: {} c (rate-limit, не сокращается)".format(
        cfg["rate_limit"]["min_pause_seconds"]))
    print("=" * 60, flush=True)


def print_plan(cfg, teams, rows, budget, dry_run):
    with_ru = sum(1 for r in rows if r["name_ru"])
    with_qid = sum(1 for r in rows if r["wikidata_qid"])
    with_minutes = sum(1 for r in rows if r["_minutes"] is not None)
    team_names = ", ".join(t.get("name", "?") for t in teams) or "(none)"

    raw_limit = cfg.get("pilot_limit_teams")
    limit_label = (
        str(int(raw_limit)) if raw_limit and int(raw_limit) > 0 else "ALL"
    )
    # Worst-case API-Football request estimate: 1 /teams call + max_page
    # /players pages per team. Real squads need fewer pages, so budget.used
    # is the true count; this is the upper bound to sanity-check the budget.
    max_page = int(cfg.get("max_page", 3))
    est_requests = 1 + len(teams) * max_page

    print("=" * 60)
    print("FOOTBALL SCRAPER — LEAGUE PLAN")
    print("=" * 60)
    print("Mode             : {}".format("DRY RUN (no write)" if dry_run else "LIVE (upsert)"))
    print("League           : {}".format(league_label(cfg)))
    print("Season           : {}".format(cfg["season"]))
    print("Teams (limit {})  : {} team(s)".format(limit_label, len(teams)))
    print("  {}".format(team_names))
    print("Players found    : {}".format(len(rows)))
    print("  with minutes   : {}".format(with_minutes))
    print("  with wikidata  : {}".format(with_qid))
    print("  with name_ru   : {}".format(with_ru))
    print("API reqs (today) : {} / {} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("  worst-case est : {} (1 + {} teams x {} pages)".format(
        est_requests, len(teams), max_page))
    # Warn if the worst-case estimate gets close to the daily budget. The
    # RequestBudget hard-stops at the limit regardless; this is an early
    # heads-up so a league run isn't aborted mid-way by the free-tier cap.
    warn_threshold = budget.limit - 10
    if est_requests > budget.limit:
        print("  [!] WARNING: worst-case estimate EXCEEDS the {}-request daily "
              "budget — the run may abort mid-league.".format(budget.limit))
    elif est_requests >= warn_threshold:
        print("  [!] WARNING: worst-case estimate is close to the {}-request "
              "daily budget. Watch the free-tier limit.".format(budget.limit))
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


def print_pageviews_plan(cfg, players, resolvable, seasons, windows, budget,
                         dry_run, to_process=None, skipped=0):
    pv = cfg["pageviews"]
    n_requests = resolvable * len(seasons)
    print("=" * 60)
    print("FOOTBALL SCRAPER — PAGEVIEWS PLAN (Wikimedia)")
    print("=" * 60)
    print("Mode             : {}".format(
        "DRY RUN (no write)" if dry_run else "LIVE (upsert player_seasons)"))
    print("League           : {} (written to player_seasons.league as '{}')".format(
        league_label(cfg), pv.get("league", "PL")))
    print("Seasons          : {}".format(", ".join(str(s) for s in seasons)))
    for season in seasons:
        start, end = windows[season]
        print("  {} window      : {} .. {}".format(
            season, start.isoformat(), end.isoformat()))
    print("Players in meta  : {}".format(players))
    if to_process is not None:
        print("  with name_ru   : {} (will be processed)".format(to_process))
        print("  skipped        : {} (no Russian article)".format(skipped))
    print("  resolvable     : {} (have an article to query)".format(resolvable))
    print("Wikimedia reqs   : {} (= {} players x {} season(s))".format(
        n_requests, resolvable, len(seasons)))
    print("  cached reqs cost 0; budget used {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("API-Football     : NOT touched (separate, key-less source)")
    print("=" * 60)


def _has_ru_article(player):
    """True if the player has a non-empty name_ru (a Russian Wikipedia
    article). We treat null and whitespace-only as 'no article'."""
    return bool((player.get("name_ru") or "").strip())


def run_pageviews(cfg, dry_run, process_all=False):
    """Collect Wikipedia pageviews per season -> player_seasons.pageviews.

    By default only players with a non-empty name_ru (recognisable players
    with a Russian article) are queried; the rest have ~0 views and would
    only waste Wikimedia requests. Pass process_all=True (CLI --all) to
    collect for every player regardless of name_ru.
    """
    pv = cfg["pageviews"]
    league = pv.get("league", "PL")
    seasons = [int(s) for s in pv.get("seasons", [cfg.get("season")])]
    window_cfg = pv.get("window", {})
    windows = {s: season_window(s, window_cfg) for s in seasons}

    # The pageviews step reads players_meta in BOTH modes, so it needs creds up
    # front (unlike the players step, whose dry-run needs no Supabase).
    supa_url = require_env("SUPABASE_URL")
    supa_key = require_env("SUPABASE_KEY")

    cache = FileCache(
        os.path.join(BASE_DIR, cfg["cache"]["dir"]), cfg["cache"]["enabled"]
    )
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    budget = WikimediaBudget(
        pv.get("daily_request_budget", 2000),
        os.path.join(BASE_DIR, cfg["cache"]["dir"], "pageviews_budget.json"),
    )
    client = PageviewsClient(pv, cache, budget)
    supa = PlayerSeasonsClient(supa_url, supa_key)

    players = supa.fetch_players_meta()

    # Default: only players with a Russian article (name_ru) are worth a
    # pageviews query. --all (process_all) restores the full list.
    if process_all:
        selected = players
    else:
        selected = [p for p in players if _has_ru_article(p)]
    skipped = len(players) - len(selected)

    # DRY RUN: resolve only from already-known fields (no Wikidata calls, no
    # pageviews fetches) so the plan is fast — just counts and windows.
    if dry_run:
        resolvable = 0
        for player in selected:
            _, article, _ = resolve_article(player, wikidata, allow_network=False)
            if article:
                resolvable += 1
        print_pageviews_plan(
            cfg, len(players), resolvable, seasons, windows, budget,
            dry_run=True, to_process=len(selected), skipped=skipped,
        )
        print("DRY RUN — nothing written to player_seasons.")
        if not process_all:
            print("(Only players with name_ru are queried; pass --all for every "
                  "player.)")
        print("(Live run may resolve a few more via Wikidata QID sitelinks.)")
        return

    # LIVE: resolve each article (Wikidata sitelink lookup allowed), fetch the
    # pageviews for every season window, and UPSERT in flushed batches so an
    # interrupted run keeps what it already wrote.
    rows_buffer = []
    flush_size = 200
    written = 0
    resolved = 0
    unresolved = 0
    missing_article = 0  # resolved a title but Wikimedia had no data (404)

    # Up-front header: counts, seasons and budget, so the user knows the scope
    # before the per-player crawl (each cached window costs 0 budget).
    total_players = len(players)
    n_selected = len(selected)
    print("=" * 60)
    print("СТАРТ — сбор просмотров Wikipedia (Wikimedia, без API-ключа)")
    print("=" * 60)
    print("Лига             : {} (в player_seasons.league: '{}')".format(
        league_label(cfg), league))
    print("Сезоны           : {}".format(", ".join(str(s) for s in seasons)))
    print("Игроков в meta   : {}".format(total_players))
    if process_all:
        print("  будет обработано: {} (--all: все игроки)".format(n_selected))
    else:
        print("  с name_ru      : {} (будут обработаны)".format(n_selected))
        print("  пропущено      : {} (нет русской статьи)".format(skipped))
    print("Оценка запросов  : до ~{} ({} игроков x {} сезон(ов))".format(
        n_selected * len(seasons), n_selected, len(seasons)))
    print("Бюджет Wikimedia : {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("API-Football     : НЕ затрагивается (отдельный источник)")
    print("=" * 60, flush=True)

    def flush():
        nonlocal written
        if rows_buffer:
            written += len(supa.upsert_player_seasons(rows_buffer))
            rows_buffer.clear()

    for p_idx, player in enumerate(selected, 1):
        project, article, source = resolve_article(player, wikidata, allow_network=True)
        label = article or player.get("name_ru") or player.get("name_en") or (
            "id={}".format(player.get("id")))
        if not article:
            unresolved += 1
            print("[{}/{}] игрок {} — пропуск (нет статьи для запроса)".format(
                p_idx, n_selected, label), flush=True)
            continue
        resolved += 1
        for season in seasons:
            start, end = windows[season]
            result = client.views_for_window(project, article, start, end)
            if not result["found"]:
                missing_article += 1
            print("[{}/{}] игрок {} (сезон {}) — {} просмотров{}".format(
                p_idx, n_selected, label, season, result["views"],
                "" if result["found"] else " [нет данных]"), flush=True)
            rows_buffer.append(
                {
                    "player_id": player["id"],
                    "league": league,
                    "season": season,
                    "pageviews": result["views"],
                }
            )
            if len(rows_buffer) >= flush_size:
                flush()
    flush()

    print_pageviews_plan(
        cfg, len(players), resolved, seasons, windows, budget, dry_run=False,
        to_process=n_selected, skipped=skipped,
    )
    print("WRITE SUMMARY (player_seasons)")
    print("  players resolved : {}".format(resolved))
    print("  unresolvable     : {} (no name_ru/qid/name_en)".format(unresolved))
    print("  skipped (no ru)  : {} (no Russian article, not queried)".format(
        skipped))
    print("  rows written     : {}".format(written))
    print("  no-data windows  : {} (article had 0 pageviews / 404)".format(
        missing_article))
    print("=" * 60)


# Disambiguation suffixes tried when the exact card name has no ruwiki
# pageviews data, keyed by card category. Order matters: most specific first.
CARDS_PV_VARIANTS = {
    "player":        ["(футболист)"],
    "woman":         ["(футболистка)", "(футболист)"],
    "club":          ["(футбольный клуб)"],
    "club_nickname": ["(футбольный клуб)"],
}

# --cards-pageviews enwiki fallback: a card without a ruwiki article but with
# a name_en gets its ENGLISH pageviews, multiplied by this discount — the
# en audience is roughly 10x the ru one, so raw enwiki numbers would be
# incomparable with the rest of the deck.
EN_PAGEVIEWS_DISCOUNT = 0.1


def run_cards_pageviews(cfg, dry_run):
    """Backfill cards.pageviews for cards that have none (ANY category) so the
    Easy/Hard difficulty filter finally sees the whole deck — today ~1800
    manual cards carry NULL, and NULL passes every threshold.

    For each card the ruwiki article is assumed to be titled exactly like the
    card; its pageviews over the configured season window are summed via the
    same Wikimedia per-article API as --pageviews (a 404 = "no such article /
    no data"). If the exact title misses, category-specific disambiguation
    variants are tried (CARDS_PV_VARIANTS); if those miss too and the card
    has a name_en, the ENGLISH article's views are taken instead, multiplied
    by EN_PAGEVIEWS_DISCOUNT (0.1) and rounded — raw enwiki numbers would be
    incomparable with the ru deck. A card with neither stays NULL and is
    logged. Same politeness contract as --pageviews: 1s
    pause, per-(article, window) on-disk cache (404s cached too), shared
    Wikimedia daily budget. Each hit is PATCHed immediately, so an interrupted
    run keeps its progress; only pageviews IS NULL cards are ever read, so a
    re-run is idempotent and re-checks only the still-NULL ones (from cache,
    for free).
    """
    pv = cfg["pageviews"]
    season = int(cfg.get("season", 2023))
    start, end = season_window(season, pv.get("window", {}))

    supa_url = require_env("SUPABASE_URL")
    supa_key = require_env("SUPABASE_KEY")

    cache = FileCache(
        os.path.join(BASE_DIR, cfg["cache"]["dir"]), cfg["cache"]["enabled"]
    )
    # Same budget FILE as --pageviews: one polite per-day cap for all our
    # Wikimedia Pageviews traffic, whichever mode generates it.
    budget = WikimediaBudget(
        pv.get("daily_request_budget", 2000),
        os.path.join(BASE_DIR, cfg["cache"]["dir"], "pageviews_budget.json"),
    )
    client = PageviewsClient(pv, cache, budget)
    # Last-resort article search for cards whose ruwiki article is spelled
    # differently than the card ("Садьо Мане" vs "Мане, Садио") — shares the
    # ruwiki_pageprops/_search caches with --cards-photos/--cards-name-en and
    # consumes the same pageviews budget as the rest of this mode.
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget
    )
    cards_client = CardsClient(supa_url, supa_key)

    print("Читаю cards (pageviews IS NULL)...", flush=True)
    cards = cards_client.fetch_cards_missing_pageviews()

    def candidates(card):
        name = (card.get("name") or "").strip()
        if not name:
            return []
        variants = CARDS_PV_VARIANTS.get(card.get("category"), [])
        return [name] + ["{} {}".format(name, v) for v in variants]

    def is_cached(article):
        key = "|".join([
            PROJECT_RU, article,
            start.strftime("%Y%m%d"), end.strftime("%Y%m%d"),
            client.access, client.agent, client.granularity,
        ])
        return cache.get("pageviews", key) is not None

    by_category = {}
    for c in cards:
        by_category[c.get("category")] = by_category.get(c.get("category"), 0) + 1
    cached_exact = sum(
        1 for c in cards if candidates(c) and is_cached(candidates(c)[0]))
    with_name_en = sum(
        1 for c in cards if (c.get("name_en") or "").strip())
    # The enwiki fallback adds at most one request per card with a name_en
    # (only fired when every ruwiki title missed).
    worst_requests = sum(len(candidates(c)) for c in cards) + with_name_en

    print("=" * 60)
    print("FOOTBALL SCRAPER — CARDS PAGEVIEWS ({})".format(
        "DRY RUN, без записи" if dry_run else "LIVE, запись cards.pageviews"))
    print("=" * 60)
    print("Окно             : {} .. {} (сезон {})".format(
        start.isoformat(), end.isoformat(), season))
    print("Карточек к обработке: {} (pageviews IS NULL, все категории)".format(
        len(cards)))
    for cat in sorted(by_category):
        print("  {:<14} : {}".format(cat or "?", by_category[cat]))
    print("Оценка запросов  : от ~{} (точное имя) до ~{} (с вариантами "
          "'(футболист)' и т.п. + enwiki)".format(
              len(cards) - cached_exact, worst_requests))
    print("  точных имён в кеше: {} (бесплатно)".format(cached_exact))
    print("  с name_en (шанс через enwiki x{}): {}".format(
        EN_PAGEVIEWS_DISCOUNT, with_name_en))
    print("Бюджет Wikimedia : {}/{} (UTC {}) — общий с --pageviews".format(
        budget.used, budget.limit, budget.date))
    print("Пауза            : >={}s между запросами".format(
        pv.get("min_pause_seconds", 1.0)))
    print("API-Football     : НЕ затрагивается")
    print("=" * 60, flush=True)

    if dry_run:
        print("DRY RUN — ничего не записано в cards.")
        return

    n_cards = len(cards)
    found_exact = 0
    found_variant = 0
    found_search = 0
    found_enwiki = 0
    not_found = 0
    errors = 0

    for idx, card in enumerate(cards, 1):
        names = candidates(card)
        label = (card.get("name") or "id={}".format(card.get("id")))
        if not names:
            not_found += 1
            continue
        wrote = False
        failed = False
        for j, article in enumerate(names):
            try:
                result = client.views_for_window(PROJECT_RU, article, start, end)
            except RuntimeError:
                raise  # daily budget exhausted — stop politely, progress is saved
            except Exception as exc:  # noqa: BLE001 — log, keep crawling
                errors += 1
                failed = True
                print("[{}/{}] {} — ошибка запроса, пропуск: {}".format(
                    idx, n_cards, label, exc), flush=True)
                break
            if result["found"]:
                cards_client.set_card_pageviews(card["id"], result["views"])
                wrote = True
                if j == 0:
                    found_exact += 1
                    print("[{}/{}] {} — {} просмотров".format(
                        idx, n_cards, label, result["views"]), flush=True)
                else:
                    found_variant += 1
                    print("[{}/{}] {} — {} просмотров (статья «{}»)".format(
                        idx, n_cards, label, result["views"], article),
                        flush=True)
                break
        # Search fallback: every exact-title guess missed — the article may
        # exist under an alternative spelling ("Садьо Мане" -> "Мане, Садио").
        # Take the first close, non-disambig search hit and sum ITS views.
        if not wrote and not failed:
            try:
                for article in search_close_titles(resolver, names[0],
                                                   card.get("category")):
                    if resolver.qid_for_title(article).get("disambig"):
                        continue
                    result = client.views_for_window(
                        PROJECT_RU, article, start, end)
                    if result["found"]:
                        cards_client.set_card_pageviews(
                            card["id"], result["views"])
                        wrote = True
                        found_search += 1
                        print("[{}/{}] {} — {} просмотров (поиск, статья "
                              "«{}»)".format(idx, n_cards, label,
                                             result["views"], article),
                              flush=True)
                        break
            except RuntimeError:
                raise  # daily budget exhausted — stop politely
            except Exception as exc:  # noqa: BLE001 — log, keep crawling
                errors += 1
                failed = True
                print("[{}/{}] {} — ошибка запроса (поиск), пропуск: {}".format(
                    idx, n_cards, label, exc), flush=True)
        # enwiki fallback: no ruwiki article, but the card knows its English
        # name — take the ENGLISH views, discounted to the ru audience scale.
        name_en = (card.get("name_en") or "").strip()
        if not wrote and not failed and name_en:
            try:
                result = client.views_for_window(PROJECT_EN, name_en, start, end)
            except RuntimeError:
                raise  # daily budget exhausted — stop politely, progress is saved
            except Exception as exc:  # noqa: BLE001 — log, keep crawling
                errors += 1
                failed = True
                print("[{}/{}] {} — ошибка запроса (enwiki), пропуск: {}".format(
                    idx, n_cards, label, exc), flush=True)
            else:
                if result["found"]:
                    views = int(round(result["views"] * EN_PAGEVIEWS_DISCOUNT))
                    cards_client.set_card_pageviews(card["id"], views)
                    wrote = True
                    found_enwiki += 1
                    print("[{}/{}] {} — {} просмотров (enwiki x{}, статья "
                          "«{}»)".format(idx, n_cards, label, views,
                                         EN_PAGEVIEWS_DISCOUNT, name_en),
                          flush=True)
        if not wrote and not failed:
            not_found += 1
            print("[{}/{}] {} — статья не найдена, pageviews остаётся NULL".format(
                idx, n_cards, label), flush=True)

    print("=" * 60)
    print("WRITE SUMMARY (cards.pageviews)")
    print("  written (exact)   : {}".format(found_exact))
    print("  written (variant) : {}".format(found_variant))
    print("  written (search)  : {}".format(found_search))
    print("  written (enwiki x{}): {}".format(
        EN_PAGEVIEWS_DISCOUNT, found_enwiki))
    print("  no article (NULL) : {}".format(not_found))
    print("  errors skipped    : {}".format(errors))
    print("  budget used       : {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("=" * 60)


def _fetch_players_meta_compat(client):
    """fetch_players_meta WITH photo_url, falling back to the legacy column
    list when the migration (supabase/migrations/photo_url.sql) has not been
    applied yet. Returns (players, has_photo_column)."""
    try:
        return client.fetch_players_meta(with_photo=True), True
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 400:
            print("[warn] players_meta.photo_url ещё не создана — выполните "
                  "supabase/migrations/photo_url.sql; продолжаю без фото",
                  flush=True)
            return client.fetch_players_meta(), False
        raise


def run_photos(cfg, dry_run):
    """Collect player photos: Wikidata P18 -> Commons Special:FilePath URL
    (?width=N) -> players_meta.photo_url.

    Same politeness contract as the pageviews step: a contact User-Agent and
    >=1s pause (the shared WikidataEnricher), an on-disk cache per QID — the
    NEGATIVE result (no P18) is cached too — and a per-UTC-day request budget,
    so a re-run only pays for players it has never asked about. Players
    without a wikidata_qid, and players whose photo_url is already set, are
    skipped. No P18 -> photo_url stays NULL; a per-player failure is logged
    and never aborts the crawl.
    """
    photos_cfg = cfg.get("photos", {})
    width = int(photos_cfg.get("width", 256))

    supa_url = require_env("SUPABASE_URL")
    supa_key = require_env("SUPABASE_KEY")

    cache = FileCache(
        os.path.join(BASE_DIR, cfg["cache"]["dir"]), cfg["cache"]["enabled"]
    )
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    budget = WikimediaBudget(
        photos_cfg.get("daily_request_budget", 5000),
        os.path.join(BASE_DIR, cfg["cache"]["dir"], "photos_budget.json"),
    )
    client = PlayerSeasonsClient(supa_url, supa_key)

    print("Читаю players_meta...", flush=True)
    players, has_photo = _fetch_players_meta_compat(client)

    with_qid = [p for p in players if (p.get("wikidata_qid") or "").strip()]
    todo = [p for p in with_qid if not (p.get("photo_url") or "").strip()]
    already = len(with_qid) - len(todo)
    cached = sum(
        1 for p in todo
        if cache.get("wikidata_p18", p["wikidata_qid"].strip()) is not None
    )

    print("=" * 60)
    print("FOOTBALL SCRAPER — PHOTOS ({})".format(
        "DRY RUN, без записи" if dry_run else "LIVE, запись players_meta.photo_url"))
    print("=" * 60)
    print("Источник         : Wikidata P18 -> Commons Special:FilePath "
          "?width={}".format(width))
    print("Игроков в meta   : {}".format(len(players)))
    print("  с wikidata_qid : {} (только они опрашиваются)".format(len(with_qid)))
    print("  без qid        : {} (photo_url остаётся NULL)".format(
        len(players) - len(with_qid)))
    print("  уже с фото     : {} (пропуск — идемпотентный перезапуск)".format(
        already))
    print("  к обработке    : {}".format(len(todo)))
    print("  из них в кеше  : {} (бесплатно, без запроса)".format(cached))
    print("Оценка запросов  : ~{} (Wikidata wbgetclaims, пауза >={}s)".format(
        len(todo) - cached, cfg["wikidata"]["min_pause_seconds"]))
    print("Бюджет Wikidata  : {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("API-Football     : НЕ затрагивается (отдельный источник)")
    if not has_photo:
        print("[!] players_meta.photo_url отсутствует — live-запуск невозможен "
              "до применения supabase/migrations/photo_url.sql")
    print("=" * 60, flush=True)

    if dry_run:
        print("DRY RUN — ничего не записано в players_meta.")
        return

    if not has_photo:
        raise SystemExit(
            "players_meta.photo_url не существует. Выполните "
            "supabase/migrations/photo_url.sql и запустите снова.")

    found = 0
    no_image = 0
    errors = 0
    n_todo = len(todo)

    for idx, player in enumerate(todo, 1):
        qid = player["wikidata_qid"].strip()
        label = (player.get("name_ru") or player.get("name_en")
                 or "id={}".format(player.get("id")))
        # The budget counts only real network calls: a cached qid is free.
        if cache.get("wikidata_p18", qid) is None:
            budget.consume()
        try:
            filename = wikidata.image_filename_for_qid(qid)
        except Exception as exc:  # noqa: BLE001 — log, keep crawling
            errors += 1
            print("[{}/{}] {} ({}) — ошибка запроса, пропуск: {}".format(
                idx, n_todo, label, qid, exc), flush=True)
            continue

        if not filename:
            no_image += 1
            print("[{}/{}] {} ({}) — нет P18, photo_url остаётся NULL".format(
                idx, n_todo, label, qid), flush=True)
            continue

        url = commons_filepath_url(
            filename, width, photos_cfg.get(
                "filepath_base", "https://commons.wikimedia.org/wiki/Special:FilePath"))
        try:
            client.set_player_photo(player["id"], url)
        except Exception as exc:  # noqa: BLE001 — log, keep crawling
            errors += 1
            print("[{}/{}] {} ({}) — запись не удалась: {}".format(
                idx, n_todo, label, qid, exc), flush=True)
            continue
        found += 1
        print("[{}/{}] {} ({}) — фото записано".format(
            idx, n_todo, label, qid), flush=True)

    print("=" * 60)
    print("WRITE SUMMARY (players_meta.photo_url)")
    print("  photos written : {}".format(found))
    print("  no P18 (NULL)  : {}".format(no_image))
    print("  errors skipped : {}".format(errors))
    print("  already had    : {} (пропущены до запуска)".format(already))
    print("  budget used    : {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("=" * 60)


# --cards-photos: categories that are NOT processed — terms and positions are
# abstract concepts with no sensible photo. Player cards ARE processed: the
# scraped ones get photos earlier (--photos + --to-cards / docs backfill), so
# the photo_url IS NULL filter leaves exactly the old manual cards (legends
# absent from players_meta) for this mode.
CARDS_PHOTOS_EXCLUDED = ("term", "position")

# Clubs (and nicknames) get their Wikidata LOGO first, then the generic image.
CARDS_PHOTOS_CLUB_CATEGORIES = ("club", "club_nickname")

# Categories whose '<name> (qualifier)' variants are tried BEFORE the bare
# name: clubs ("Челси" = the city) AND stadiums — "Сантьяго Бернабеу" is the
# club president the stadium is named after, "Велодром" is the common noun.
CARDS_PHOTOS_VARIANT_FIRST = CARDS_PHOTOS_CLUB_CATEGORIES + ("stadium",)

# P31 (instance of) guard: even with the variant order fixed, a resolved
# QID must look like the right KIND of entity — a stadium card must not pick
# the person/city it is named after ("Сантьяго Бернабеу" the president), a
# club card must not pick the city/common noun ("Зенит" -> Q82806 "zenith",
# "Брест" -> the city). Classes seen on the deck's entities; extend when a
# new type appears.
STADIUM_P31_ALLOW = frozenset((
    "Q483110",    # stadium
    "Q1154710",   # association football venue
    "Q641226",    # arena
    "Q1076486",   # sports venue
    "Q1049757",   # multi-purpose sports venue (Сан-Сиро, Парк де Пренс)
    "Q589481",    # Olympic stadium
    "Q4728370",   # all-seater stadium
    "Q15303456",  # rugby union venue
))
CLUB_P31_ALLOW = frozenset((
    "Q476028",     # association football club (Челси)
    "Q103229495",  # men's association football team (Барселона)
    "Q20639856",   # professional sports team
    "Q10651067",   # representation team
    "Q847017",     # sports club
    "Q12973014",   # sports team
))
CARD_P31_ALLOW = {
    "stadium":       STADIUM_P31_ALLOW,
    "club":          CLUB_P31_ALLOW,
    "club_nickname": CLUB_P31_ALLOW,
}


def make_card_qid_validator(card, wikidata, cache, budget):
    """For stadium/club cards: a callback that accepts a QID only when its
    P31 intersects the category's allow-set (so the namesake person, city or
    common noun is rejected and the next title variant / search hit is
    tried). Other categories get None — no validation."""
    allow = CARD_P31_ALLOW.get(card.get("category"))
    if not allow:
        return None

    def _ok(qid):
        # Budget counts only real network calls, as everywhere else.
        if cache.get("wikidata_p31", qid) is None:
            budget.consume()
        return bool(set(wikidata.instance_of_qids(qid)) & allow)

    return _ok


# Back-compat name (stadium_photo_audit.py imports it).
make_stadium_qid_validator = make_card_qid_validator

# Ruwiki title variants per category for the QID lookup, appended to the bare
# card name (same idea as CARDS_PV_VARIANTS). Most specific first.
CARDS_PHOTOS_VARIANTS = {
    "player":        ["(футболист)"],
    "club":          ["(футбольный клуб)"],
    "club_nickname": ["(футбольный клуб)"],
    "stadium":       ["(стадион)"],
    "referee":       ["(футбольный судья)", "(судья)"],
    "coach":         ["(футбольный тренер)", "(тренер)", "(футболист)"],
    "commentator":   ["(комментатор)", "(журналист)"],
    "woman":         ["(футболистка)", "(футболист)"],
}


# Generic venue words opening a stadium card name; the ruwiki article often
# drops them ("Эстадио Ацтека" -> "Ацтека (стадион)", "Эстадио Месталья" ->
# "Месталья"). Stripped candidates go AFTER the full-name ones, and the P31
# guard keeps a false hit ("Стад де Жерлан" -> "де Жерлан") from sticking.
STADIUM_NAME_PREFIXES = (
    "Эстадио ", "Эстадиу ", "Эштадиу ", "Стадио ", "Стадион ", "Стад ",
)


def cards_photos_candidates(card):
    """Ruwiki titles to try for a card, in order. Clubs and stadiums try the
    disambiguated '<name> (футбольный клуб)'/'<name> (стадион)' BEFORE the
    bare name — 'Челси'/'Арсенал' land on the city/disambiguation page,
    'Сантьяго Бернабеу' on the person; everyone else tries the exact name
    first. Stadium names also retry with the generic venue word stripped
    (see STADIUM_NAME_PREFIXES)."""
    name = (card.get("name") or "").strip()
    if not name:
        return []
    category = card.get("category")

    def with_variants(base):
        variants = [
            "{} {}".format(base, v)
            for v in CARDS_PHOTOS_VARIANTS.get(category, [])
        ]
        if category in CARDS_PHOTOS_VARIANT_FIRST:
            return variants + [base]
        return [base] + variants

    titles = with_variants(name)
    if category == "stadium":
        for prefix in STADIUM_NAME_PREFIXES:
            if name.startswith(prefix) and len(name) > len(prefix) + 1:
                titles += with_variants(name[len(prefix):])
                break
    return titles


# Last-resort full-text search (list=search): a result title must be THIS
# close to the card name on canonical keys (word order / alphabet /
# punctuation folded by canonical_key) to be taken — "Садьо Мане" matches the
# article "Мане, Садио", but "Валенсия" cannot grab an unrelated hit.
SEARCH_MATCH_RATIO = 0.85
SEARCH_LIMIT = 3

# Search-hit qualifier guard for PEOPLE cards: a close title carrying a
# '(...)' qualifier is taken only when the qualifier looks like a person in
# football (or is a bare disambiguation year, ruwiki's standard for people).
# Without it "Оскар (кинопремия)" or "Варди (кишлак)" would match a player
# card by name alone. Titles WITHOUT a qualifier are not filtered.
SEARCH_PEOPLE_QUALIFIER_RE = re.compile(
    r"футбол|вратар|тренер|судья|арбитр|комментатор|журналист", re.I)
SEARCH_YEAR_QUALIFIER_RE = re.compile(r"^[\d\s,—–-]+$")
SEARCH_PEOPLE_CATEGORIES = ("player", "woman", "coach", "referee",
                            "commentator")
_TITLE_QUALIFIER_RE = re.compile(r"\(([^()]*)\)\s*$")


def _search_qualifier_ok(title, category):
    """False when a search hit's '(...)' qualifier rules it out for this
    card category (people only — clubs/stadiums keep every close hit)."""
    if category not in SEARCH_PEOPLE_CATEGORIES:
        return True
    match = _TITLE_QUALIFIER_RE.search(title or "")
    if not match:
        return True
    qualifier = match.group(1).strip()
    return bool(SEARCH_PEOPLE_QUALIFIER_RE.search(qualifier)
                or SEARCH_YEAR_QUALIFIER_RE.match(qualifier))


def search_close_titles(resolver, name, category=None, limit=SEARCH_LIMIT):
    """Titles from the wiki's full-text search whose canonical_key is close
    to the card name's (difflib ratio >= SEARCH_MATCH_RATIO). Relevance order
    is preserved; a title's '(...)' qualifier is ignored for the comparison
    but, for people categories, must pass _search_qualifier_ok. One
    cached/budgeted search request per name."""
    key = canonical_key(name)
    if not key:
        return []
    out = []
    for title in resolver.search_titles(name, limit):
        title_key = canonical_key(strip_title_parenthetical(title))
        if not title_key:
            continue
        if SequenceMatcher(None, key, title_key).ratio() < SEARCH_MATCH_RATIO:
            continue
        if not _search_qualifier_ok(title, category):
            continue
        out.append(title)
    return out


def resolve_card_qid(resolver, card, titles, validate=None):
    """(qid, title, via_search) for a card: the known title variants first,
    then the last-resort full-text search (close titles only) — so a card
    with an alternative Russian spelling still finds its article instead of
    falling through to worse fallbacks. Disambiguation pages are skipped at
    every step, and a `validate(qid)` callback (when given) must accept the
    QID — the stadium P31 guard rejects the person/city namesake and the
    next candidate is tried. Returns (None, None, False) when nothing fits.
    """
    for title in titles:
        info = resolver.qid_for_title(title)
        if info.get("disambig") or not info.get("qid"):
            continue
        if validate is not None and not validate(info["qid"]):
            continue
        return info["qid"], title, False
    for title in search_close_titles(resolver,
                                     (card.get("name") or "").strip(),
                                     card.get("category")):
        info = resolver.qid_for_title(title)
        if info.get("disambig") or not info.get("qid"):
            continue
        if validate is not None and not validate(info["qid"]):
            continue
        return info["qid"], title, True
    return None, None, False


# enwiki disambiguation suffixes for the fallback search by name_en.
CARDS_PHOTOS_EN_VARIANTS = {
    "player": ["(footballer)"],
    "woman":  ["(footballer)"],
    "coach":  ["(footballer)"],
}


def cards_photos_en_candidates(card):
    """enwiki titles for the fallback, in order — used only after every
    ruwiki title missed. The card name is Russian ('Зион Судзуки'), so the
    search needs the Latin name: cards.name_en (player cards carry it).
    No name_en -> no fallback (clubs etc. almost always have a ru article).
    """
    name_en = (card.get("name_en") or "").strip()
    if not name_en:
        return []
    return [name_en] + [
        "{} {}".format(name_en, v)
        for v in CARDS_PHOTOS_EN_VARIANTS.get(card.get("category"), [])
    ]


# pageimages fallback (article infobox thumbnail) when Wikidata has no
# P154/P18: PEOPLE ONLY. On enwiki the pageimage of a club/stadium is often a
# non-free (fair-use) logo we are not allowed to use; a person's pageimage is
# a portrait hosted on Commons.
CARDS_PHOTOS_PAGEIMAGE_CATEGORIES = SEARCH_PEOPLE_CATEGORIES


def cards_photos_props(category):
    """Wikidata media properties to try for a category, in order: clubs prefer
    the logo (P154) and fall back to the generic image (P18); everything else
    (people, stadiums) only has P18."""
    if category in CARDS_PHOTOS_CLUB_CATEGORIES:
        return ("P154", "P18")
    return ("P18",)


def run_cards_photos(cfg, dry_run):
    """Collect photos for cards: ruwiki article (title variants) ->
    wikibase_item QID (prop=pageprops) -> Wikidata P154/P18 -> Commons
    Special:FilePath URL (?width=N) -> cards.photo_url.

    Covers every category except terms/positions — including player cards,
    whose NULL photo_url means the player is NOT in players_meta (old manual
    legend cards); scraped players got their photo via --photos/--to-cards.
    When no ruwiki title matches, the same chain is tried on ENWIKI by the
    card's name_en (the card name itself is Russian and useless for the
    English search); cards without name_en skip the fallback. Hits are
    logged with an "enwiki" mark.

    When the QID resolved but Wikidata has no media (P154/P18 empty), PEOPLE
    cards (CARDS_PHOTOS_PAGEIMAGE_CATEGORIES) get one more step: the article
    infobox thumbnail via prop=pageimages from the SAME wiki that resolved
    the QID, logged as "pageimage". Clubs/stadiums never take this step —
    enwiki pageimages are often non-free (fair-use) logos.

    Only cards with photo_url IS NULL outside CARDS_PHOTOS_EXCLUDED are read,
    so a re-run is idempotent and each hit is PATCHed immediately — an
    interrupted run keeps its progress. Same politeness contract as --photos:
    contact User-Agent, >=1s pauses, on-disk caches (negative results too:
    missing articles and entities without media), and the photos daily budget
    shared across the ruwiki and Wikidata calls. Disambiguation pages are
    detected via the same pageprops call and skipped (their QID belongs to
    the wrong entity). No article / no media -> photo_url stays NULL, logged.
    """
    photos_cfg = cfg.get("photos", {})
    width = int(photos_cfg.get("width", 256))
    pv = cfg["pageviews"]  # contact User-Agent + pause for the ruwiki API

    supa_url = require_env("SUPABASE_URL")
    supa_key = require_env("SUPABASE_KEY")

    cache = FileCache(
        os.path.join(BASE_DIR, cfg["cache"]["dir"]), cfg["cache"]["enabled"]
    )
    # Same budget FILE as --photos: one per-day cap for all photo traffic.
    budget = WikimediaBudget(
        photos_cfg.get("daily_request_budget", 5000),
        os.path.join(BASE_DIR, cfg["cache"]["dir"], "photos_budget.json"),
    )
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget
    )
    # enwiki fallback for cards without a ruwiki article (searched by the
    # card's name_en). Separate instance = separate API host and cache.
    en_resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget,
        api_url="https://en.wikipedia.org/w/api.php", cache_prefix="enwiki",
    )
    cards_client = CardsClient(supa_url, supa_key)

    print("Читаю cards (photo_url IS NULL, категории кроме {})...".format(
        "/".join(CARDS_PHOTOS_EXCLUDED)), flush=True)
    try:
        cards = cards_client.fetch_cards_missing_photo(CARDS_PHOTOS_EXCLUDED)
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 400:
            raise SystemExit(
                "cards.photo_url не существует. Выполните "
                "supabase/migrations/photo_url.sql и запустите снова.")
        raise

    # Priority: player legends (all have name_en, best enwiki hit-rate) first,
    # then club logos, then the rest — so the limited daily budget reaches the
    # legends before it runs low. Stable within each group (keeps id order).
    _photo_cat_rank = {"player": 0, "club": 1, "club_nickname": 1}
    cards.sort(key=lambda c: _photo_cat_rank.get(c.get("category"), 2))

    by_category = {}
    for c in cards:
        by_category[c.get("category")] = by_category.get(c.get("category"), 0) + 1
    # Request estimate: 1 ruwiki lookup per card in the best case (first title
    # hits), every variant in the worst; then 1-2 Wikidata wbgetclaims per
    # resolved card (2 for clubs: P154 miss -> P18). Cached titles cost 0.
    ruwiki_best = len(cards)
    ruwiki_worst = sum(len(cards_photos_candidates(c)) for c in cards)
    # enwiki fallback: fired only when every ruwiki title missed, costs at
    # most len(en_candidates) extra lookups per card with a name_en.
    with_name_en = sum(
        1 for c in cards if cards_photos_en_candidates(c))
    en_worst = sum(len(cards_photos_en_candidates(c)) for c in cards)
    wd_worst = sum(len(cards_photos_props(c.get("category"))) for c in cards)
    cached_first = sum(
        1 for c in cards
        if cards_photos_candidates(c)
        and cache.get("ruwiki_pageprops", cards_photos_candidates(c)[0])
        is not None
    )

    print("=" * 60)
    print("FOOTBALL SCRAPER — CARDS PHOTOS ({})".format(
        "DRY RUN, без записи" if dry_run else "LIVE, запись cards.photo_url"))
    print("=" * 60)
    print("Источник         : ruwiki pageprops (QID, промахи добираются "
          "поиском list=search) -> Wikidata P154/P18 -> "
          "Commons Special:FilePath ?width={} (люди без P18 — "
          "pageimages той же вики)".format(width))
    print("Карточек к обработке: {} (photo_url IS NULL, без {})".format(
        len(cards), "/".join(CARDS_PHOTOS_EXCLUDED)))
    for cat in sorted(by_category):
        print("  {:<14} : {}".format(cat or "?", by_category[cat]))
    print("Оценка запросов  : ruwiki от ~{} до ~{} (варианты названий), "
          "enwiki до ~{}, Wikidata до ~{}".format(
              ruwiki_best, ruwiki_worst, en_worst, wd_worst))
    print("  итого худший случай: ~{}".format(
        ruwiki_worst + en_worst + wd_worst))
    print("  с name_en (шанс через enwiki): {}".format(with_name_en))
    print("  первых названий в кеше: {} (бесплатно)".format(cached_first))
    print("Бюджет           : {}/{} (UTC {}) — общий файл с --photos".format(
        budget.used, budget.limit, budget.date))
    print("Пауза            : >={}s ruwiki, >={}s Wikidata".format(
        pv.get("min_pause_seconds", 1.0), cfg["wikidata"]["min_pause_seconds"]))
    print("API-Football     : НЕ затрагивается")
    print("=" * 60, flush=True)

    if dry_run:
        print("DRY RUN — ничего не записано в cards.")
        return

    n_cards = len(cards)
    found = 0
    found_logo = 0
    found_enwiki = 0
    found_search = 0
    found_pageimage = 0
    no_article = 0
    no_image = 0
    errors = 0

    for idx, card in enumerate(cards, 1):
        label = (card.get("name") or "id={}".format(card.get("id")))
        titles = cards_photos_candidates(card)
        if not titles:
            no_article += 1
            continue
        try:
            used_wiki = "ruwiki"
            # Title variants, then the last-resort ruwiki full-text search
            # (close titles only) — alternative Russian spellings included.
            # Stadium cards carry a P31 guard (no person/city namesakes).
            qid, used_title, via_search = resolve_card_qid(
                resolver, card, titles,
                validate=make_stadium_qid_validator(
                    card, wikidata, cache, budget))
            if not qid:
                # No ruwiki article — same chain on enwiki via name_en.
                for title in cards_photos_en_candidates(card):
                    info = en_resolver.qid_for_title(title)
                    if info.get("disambig") or not info.get("qid"):
                        continue
                    qid = info["qid"]
                    used_title = title
                    used_wiki = "enwiki"
                    break
            if not qid:
                no_article += 1
                print("[{}/{}] {} — статья не найдена, photo_url остаётся "
                      "NULL".format(idx, n_cards, label), flush=True)
                continue

            filename = None
            used_prop = None
            for prop in cards_photos_props(card.get("category")):
                # The budget counts only real network calls: cached pairs are
                # free (the ruwiki resolver consumes internally the same way).
                if cache.get("wikidata_" + prop.lower(), qid) is None:
                    budget.consume()
                filename = wikidata.media_filename_for_qid(qid, prop)
                if filename:
                    used_prop = prop
                    break
            if filename:
                url = commons_filepath_url(
                    filename, width, photos_cfg.get(
                        "filepath_base",
                        "https://commons.wikimedia.org/wiki/Special:FilePath"))
            else:
                # P154/P18 empty — people only: the article's infobox
                # thumbnail (prop=pageimages) from the wiki that resolved
                # the QID. Clubs/stadiums skip this: enwiki pageimages are
                # often fair-use logos.
                url = None
                if card.get("category") in CARDS_PHOTOS_PAGEIMAGE_CATEGORIES:
                    pi_resolver = (en_resolver if used_wiki == "enwiki"
                                   else resolver)
                    url = pi_resolver.pageimage_for_title(used_title, width)
                    if url:
                        used_prop = "pageimage"
            if not url:
                no_image += 1
                print("[{}/{}] {} ({}) — нет изображения в Wikidata, "
                      "photo_url остаётся NULL".format(
                          idx, n_cards, label, qid), flush=True)
                continue

            cards_client.set_card_photo(card["id"], url)
        except RuntimeError:
            raise  # daily budget exhausted — stop politely, progress is saved
        except Exception as exc:  # noqa: BLE001 — log, keep crawling
            errors += 1
            print("[{}/{}] {} — ошибка, пропуск: {}".format(
                idx, n_cards, label, exc), flush=True)
            continue
        found += 1
        if used_prop == "P154":
            found_logo += 1
        if used_prop == "pageimage":
            found_pageimage += 1
        if used_wiki == "enwiki":
            found_enwiki += 1
        if used_wiki == "ruwiki" and via_search:
            found_search += 1
        print("[{}/{}] {} — фото записано ({}, статья «{}»{}{})".format(
            idx, n_cards, label, used_prop, used_title,
            ", enwiki" if used_wiki == "enwiki" else "",
            ", найдено поиском" if used_wiki == "ruwiki" and via_search
            else ""), flush=True)

    print("=" * 60)
    print("WRITE SUMMARY (cards.photo_url)")
    print("  photos written   : {} (из них логотипов P154: {}, "
          "pageimage: {}, через enwiki: {}, найдено поиском: {})".format(
              found, found_logo, found_pageimage, found_enwiki,
              found_search))
    print("  no article (NULL): {}".format(no_article))
    print("  no image (NULL)  : {}".format(no_image))
    print("  errors skipped   : {}".format(errors))
    print("  budget used      : {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("=" * 60)


# --cards-name-en: every category except club_nickname gets an English
# display name from the enwiki sitelink / en label. People additionally fall
# back to BGN transliteration (it's a NAME); for clubs/terms/stadiums etc.
# translit is meaningless ("Пентакампеоны" -> gibberish), so an unresolved
# non-people card keeps name_en NULL and the frontend shows the Russian name.
# club_nickname is excluded entirely: the resolver lands either on the CLUB
# article ("Дьяволы" -> "A.C. Milan" — not a nickname) or, via the search, on
# a common noun ("Железнодорожники" -> "railway worker"); the real English
# nickname ("The Gunners") is not derivable this way -> stays NULL.
CARDS_NAME_EN_CATEGORIES = ("player", "woman", "coach", "referee",
                            "commentator")
CARDS_NAME_EN_ALL_CATEGORIES = ("player", "club", "term", "referee", "coach",
                                "stadium", "commentator", "position", "woman")


def strip_title_parenthetical(title):
    """Drop a trailing ' (...)' qualifier from a Wikipedia title:
    'Ronaldo (Brazilian footballer)' -> 'Ronaldo'. cards.name_en is a display
    name (the EN language toggle), so it must look like the manual deck names,
    not like an article title."""
    return re.sub(r"\s*\([^()]*\)\s*$", "", title or "").strip()


# Russian -> Latin transliteration table (BGN/PCGN-style, lowercase): ж->zh,
# х->kh, ц->ts, ч->ch, ш->sh, щ->shch, ю->yu, я->ya, ё->yo, й->y; ь/ъ are
# dropped. The LAST resort for cards.name_en when Wikidata has neither an
# enwiki sitelink nor an English label. People only: --cards-name-en already
# reads only CARDS_NAME_EN_CATEGORIES, so clubs/terms never get here.
RU_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def transliterate_ru(name):
    """Transliterate a Russian display name to Latin (see RU_TRANSLIT):
    'Наиль Умяров' -> 'Nail Umyarov'. Every word (space- or hyphen-separated)
    starts with a capital; non-Cyrillic characters pass through unchanged, so
    an already-Latin part of a mixed name survives as-is."""
    out = []
    word_start = True
    for ch in (name or "").strip():
        if ch in " -":
            out.append(ch)
            word_start = True
            continue
        mapped = RU_TRANSLIT.get(ch.lower())
        if mapped is None:  # not a Russian letter — pass through
            out.append(ch)
            if ch.isalpha():
                word_start = False
        elif mapped:  # ь/ъ map to '' and do NOT consume the capital
            out.append(mapped.capitalize() if word_start else mapped)
            word_start = False
    return "".join(out)


def run_cards_name_en(cfg, dry_run, redo_translit=False):
    """Backfill cards.name_en for ALL card categories (people, clubs, terms,
    stadiums, ...):
    card name -> ruwiki article (the same title variants as --cards-photos,
    misses rescued by the full-text search via resolve_card_qid — an
    alternative Russian spelling like "Садьо Мане" still finds "Мане, Садио")
    -> wikibase_item QID via pageprops (disambigs skipped) -> Wikidata enwiki
    sitelink -> PATCH cards.name_en (trailing '(...)' qualifier stripped).

    redo_translit=True (--redo-translit) REWRITES suspect name_en values
    instead: it walks cards whose name_en is ALREADY SET and re-resolves the
    article (search included); when a sitelink/label is found it replaces
    the stored value — upgrading transliterated foreign names ("Ris
    Dzheyms" -> "Reece James"). No article found -> the card keeps what it
    has (the transliterator is NEVER applied in this mode), and a Russian
    player whose translit was fine just gets his equally-fine sitelink.

    Two fallbacks when the sitelink chain misses (many Russian players have
    no English article at all):
      1. QID found but no enwiki sitelink -> the entity's ENGLISH LABEL
         (labels.en via wbgetentities — many entities have a label without
         an article); logged "(wd label)".
      2. Neither sitelink nor label (or no article/QID at all) -> BGN-style
         transliteration of the Russian card name ('Наиль Умяров' ->
         'Nail Umyarov'); logged "(translit)". PEOPLE ONLY
         (CARDS_NAME_EN_CATEGORIES): a club/term/stadium name is not a
         personal name, so an unresolved non-people card keeps name_en NULL
         and the frontend falls back to the Russian name.
    So every processed PEOPLE card ends up with a name_en (except empty
    names and request errors); non-people cards get one only when Wikidata
    actually knows it. Stadium cards resolve with the P31 venue guard (see
    make_stadium_qid_validator) so the person the stadium is named after
    cannot supply the English name.

    Cache-first by design: after a --cards-photos run the ruwiki titles and
    QIDs of these very cards are already in the ruwiki_pageprops cache, so
    re-resolving them costs nothing; the new network calls are one
    wbgetentities(sitelinks) per QID (namespace wikidata_sitelinks, shared
    with --pageviews) plus one wbgetentities(labels.en) per QID without an
    enwiki sitelink (namespace wikidata_label_en, negative result cached).
    Idempotent: only name_en IS NULL cards are read.
    Budget: the same photos_budget.json file as --photos/--cards-photos.
    """
    photos_cfg = cfg.get("photos", {})
    pv = cfg["pageviews"]  # contact User-Agent + pause for the ruwiki API

    supa_url = require_env("SUPABASE_URL")
    supa_key = require_env("SUPABASE_KEY")

    cache = FileCache(
        os.path.join(BASE_DIR, cfg["cache"]["dir"]), cfg["cache"]["enabled"]
    )
    budget = WikimediaBudget(
        photos_cfg.get("daily_request_budget", 5000),
        os.path.join(BASE_DIR, cfg["cache"]["dir"], "photos_budget.json"),
    )
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget
    )
    cards_client = CardsClient(supa_url, supa_key)

    if redo_translit:
        # Redo touches translit suspects — only people ever got a translit.
        print("Читаю cards (name_en IS NOT NULL, категории {}) — режим "
              "redo-translit...".format("/".join(CARDS_NAME_EN_CATEGORIES)),
              flush=True)
        cards = cards_client.fetch_cards_having_name_en(
            CARDS_NAME_EN_CATEGORIES)
    else:
        print("Читаю cards (name_en IS NULL, все категории кроме "
              "club_nickname)...", flush=True)
        cards = cards_client.fetch_cards_missing_name_en(
            CARDS_NAME_EN_ALL_CATEGORIES)

    # Cache walk-through, mirroring the live loop, so the plan counts the NEW
    # requests only — and predicts the name_en SOURCE per card where the cache
    # already knows the answer. Per card: titles already cached resolve (or
    # miss) for free; the first uncached title is >=1 ruwiki request (min
    # assumes it hits, max assumes every later uncached title is queried too);
    # a known QID then needs one sitelinks call unless that's cached, and —
    # when the cached sitelinks carry no enwiki — one labels.en call unless
    # that's cached too.
    resolved_cached = 0     # QID known straight from cache, 0 ruwiki requests
    sitelink_cached = 0     # ... and the sitelinks answer is cached too
    known_miss = 0          # cache: every title variant missed (-> search)
    unresolved = 0          # needs at least one ruwiki request
    new_sitelinks = 0       # sitelinks calls for cache-resolved QIDs
    new_labels = 0          # labels.en calls knowable from cache (no enwiki)
    new_ruwiki_min = 0
    new_ruwiki_max = 0
    pred_sitelink = 0       # cache: enwiki sitelink present
    pred_label = 0          # cache: no sitelink, en label present
    pred_translit = 0       # cache: QID known, no sitelink/label (people)
    pred_null = 0           # ... same for non-people: name_en stays NULL
    pred_unknown = 0        # needs network — source resolves in live run
    miss_cards = []         # known_miss cards: the dry-run search sweep input
    by_category = {}
    for c in cards:
        by_category[c.get("category")] = by_category.get(c.get("category"), 0) + 1
        titles = cards_photos_candidates(c)
        qid = None
        unknown = False
        req_min = 0
        req_max = 0
        for t in titles:
            info = cache.get("ruwiki_pageprops", t)
            if info is None:
                req_max += 1
                if not unknown:
                    unknown = True
                    req_min += 1
            elif not unknown and info.get("qid") and not info.get("disambig"):
                qid = info["qid"]
                break
        if qid:
            resolved_cached += 1
            sl = cache.get("wikidata_sitelinks", qid)
            if sl is None:
                new_sitelinks += 1
                pred_unknown += 1
            else:
                sitelink_cached += 1
                if (sl.get("enwiki") or "").strip():
                    pred_sitelink += 1
                else:
                    lab = cache.get("wikidata_label_en", qid)
                    if lab is None:
                        new_labels += 1
                        pred_unknown += 1
                    elif (lab.get("label") or "").strip():
                        pred_label += 1
                    elif c.get("category") in CARDS_NAME_EN_CATEGORIES:
                        pred_translit += 1
                    else:
                        pred_null += 1
        elif unknown:
            unresolved += 1
            pred_unknown += 1
            new_ruwiki_min += req_min
            new_ruwiki_max += req_max
        else:
            known_miss += 1
            miss_cards.append(c)

    # Worst case adds one labels.en call behind every still-unknown sitelink
    # answer (new sitelinks fetches and not-yet-resolved articles alike),
    # plus one list=search per card whose every title variant misses.
    total_min = (new_ruwiki_min + new_sitelinks + unresolved + new_labels
                 + known_miss)
    total_max = (new_ruwiki_max + new_sitelinks + unresolved + new_labels
                 + new_sitelinks + unresolved + known_miss + unresolved)

    print("=" * 60)
    print("FOOTBALL SCRAPER — CARDS NAME_EN ({}{})".format(
        "DRY RUN, без записи" if dry_run else "LIVE, запись cards.name_en",
        ", режим REDO-TRANSLIT" if redo_translit else ""))
    print("=" * 60)
    print("Источник         : ruwiki pageprops (QID, промахи добираются "
          "поиском list=search) -> Wikidata sitelinks.enwiki -> labels.en"
          "{}".format("" if redo_translit
                      else " -> транслитерация (только люди)"))
    print("Карточек к обработке: {} (name_en {})".format(
        len(cards), "IS NOT NULL — кандидаты на перезапись, люди"
        if redo_translit else "IS NULL, все категории"))
    for cat in sorted(by_category):
        print("  {:<14} : {}".format(cat or "?", by_category[cat]))
    print("Кеш (после --cards-photos):")
    print("  QID уже в кеше : {} (0 ruwiki-запросов)".format(resolved_cached))
    print("    из них sitelinks тоже в кеше: {} (совсем бесплатно)".format(
        sitelink_cached))
    print("  промах вариантов: {} (кеш: точные названия не нашлись — "
          "решает поиск)".format(known_miss))
    print("  не разрешено в кеше: {} (нужны ruwiki-запросы)".format(unresolved))
    print("Прогноз источников name_en (по кешу):")
    print("  enwiki sitelink : {}".format(pred_sitelink))
    print("  wd label (en)   : {}".format(pred_label))
    print("  {} : {} (QID есть, но ни сайтлинка, ни метки)".format(
        "name_en сохраняется" if redo_translit else "translit       ",
        pred_translit))
    if not redo_translit:
        print("  остаётся NULL   : {} (не-люди без сайтлинка/метки — "
              "без транслита)".format(pred_null))
    print("  решает поиск    : {} (см. блок ниже в dry-run)".format(known_miss))
    print("  неизвестно      : {} (нужны запросы — решится в live)".format(
        pred_unknown))
    print("НОВЫХ запросов   : от ~{} до ~{} (ruwiki {}..{} + sitelinks "
          "{}+{} + labels.en {}..{} + поиск {}..{})".format(
              total_min, total_max, new_ruwiki_min, new_ruwiki_max,
              new_sitelinks, unresolved, new_labels,
              new_labels + new_sitelinks + unresolved,
              known_miss, known_miss + unresolved))
    print("Бюджет           : {}/{} (UTC {}) — общий файл с --photos".format(
        budget.used, budget.limit, budget.date))
    print("API-Football     : НЕ затрагивается")
    print("=" * 60, flush=True)

    if dry_run:
        # The search stage is new, so the cache can't predict it — run the
        # REAL searches for the known-miss cards (network, budgeted, ~1-2
        # requests each). Read-only for the DB, and every answer lands in
        # the cache, so the live run gets these for free.
        if miss_cards:
            print("Поиск list=search по промахам кеша: {} карточек "
                  "(сетевые запросы, кешируются)...".format(len(miss_cards)),
                  flush=True)
            search_found = 0
            for i, c in enumerate(miss_cards, 1):
                c_label = (c.get("name") or "id={}".format(c.get("id")))
                hit = None
                for title in search_close_titles(
                        resolver, (c.get("name") or "").strip(),
                        c.get("category")):
                    info = resolver.qid_for_title(title)
                    if info.get("disambig") or not info.get("qid"):
                        continue
                    hit = title
                    break
                if hit:
                    search_found += 1
                    print("  [{}/{}] {} -> статья «{}»".format(
                        i, len(miss_cards), c_label, hit), flush=True)
                elif i % 25 == 0:
                    print("  [{}/{}] ...".format(i, len(miss_cards)),
                          flush=True)
            print("-" * 60)
            print("Поиск нашёл статью: {} из {} карточек-промахов".format(
                search_found, len(miss_cards)))
            if redo_translit:
                print("  -> live перезапишет их name_en (sitelink/label; "
                      "без изменений, если совпадёт)")
            else:
                print("  -> в live они получат sitelink/label вместо "
                      "транслитерации")
            print("  поиск не помог  : {} ({})".format(
                len(miss_cards) - search_found,
                "name_en сохраняется" if redo_translit else "-> translit"))
            print("Бюджет после поиска: {}/{} (UTC {})".format(
                budget.used, budget.limit, budget.date))
            print("=" * 60)
        print("DRY RUN — ничего не записано в cards.")
        return

    n_cards = len(cards)
    written = 0
    via_sitelink = 0
    via_label = 0
    via_translit = 0
    via_search = 0       # of the written: the article came from the search
    unchanged = 0        # redo: resolution returned the SAME name_en
    kept = 0             # redo: no article/sitelink/label -> name_en kept
    kept_null = 0        # non-people without sitelink/label: NULL, no translit
    empty_name = 0
    errors = 0

    for idx, card in enumerate(cards, 1):
        label = (card.get("name") or "id={}".format(card.get("id")))
        titles = cards_photos_candidates(card)
        if not titles:
            empty_name += 1  # no card name -> nothing to resolve OR translit
            continue
        try:
            # Title variants, then the last-resort full-text search.
            # Stadium cards carry the P31 guard (no person/city namesakes).
            qid, _title, from_search = resolve_card_qid(
                resolver, card, titles,
                validate=make_stadium_qid_validator(
                    card, wikidata, cache, budget))

            name_en = None
            kind = None
            note = ""
            if qid:
                # Budget counts only real network calls; cached qids are free.
                if cache.get("wikidata_sitelinks", qid) is None:
                    budget.consume()
                en_title = (wikidata.titles_for_qid(qid).get("enwiki")
                            or "").strip()
                if en_title:
                    name_en = strip_title_parenthetical(en_title) or en_title
                    kind = "sitelink"
                    if name_en != en_title:
                        note = " (статья «{}»)".format(en_title)
                else:
                    # Fallback 1: the entity's English LABEL — present for
                    # many players who have no English article.
                    if cache.get("wikidata_label_en", qid) is None:
                        budget.consume()
                    wd_label = (wikidata.label_en_for_qid(qid) or "").strip()
                    if wd_label:
                        name_en = (strip_title_parenthetical(wd_label)
                                   or wd_label)
                        kind = "label"
                        note = " (wd label)"
            if name_en and from_search:
                note += " (найдено поиском)"
            if redo_translit:
                # Rewrite mode: only a fresh sitelink/label may replace the
                # stored name_en (likely a transliteration to upgrade); the
                # transliterator is NEVER applied here, and an unresolved
                # card keeps what it has.
                current = (card.get("name_en") or "").strip()
                if not name_en:
                    kept += 1
                    continue
                if name_en == current:
                    unchanged += 1
                    continue
            else:
                if not name_en:
                    if card.get("category") not in CARDS_NAME_EN_CATEGORIES:
                        # Non-people (club/term/stadium/...): translit makes
                        # no sense — keep NULL, the frontend shows Russian.
                        kept_null += 1
                        continue
                    # Fallback 2: transliterate the Russian card name —
                    # people only, it's a personal NAME.
                    name_en = transliterate_ru(card.get("name"))
                    kind = "translit"
                    note = " (translit{})".format(
                        "" if qid else ", статья не найдена")
                if not name_en:
                    empty_name += 1
                    continue
            cards_client.set_card_name_en(card["id"], name_en)
        except RuntimeError:
            raise  # daily budget exhausted — stop politely, progress is saved
        except Exception as exc:  # noqa: BLE001 — log, keep crawling
            errors += 1
            print("[{}/{}] {} — ошибка, пропуск: {}".format(
                idx, n_cards, label, exc), flush=True)
            continue
        written += 1
        if kind == "sitelink":
            via_sitelink += 1
        elif kind == "label":
            via_label += 1
        else:
            via_translit += 1
        if from_search:
            via_search += 1
        if redo_translit:
            print("[{}/{}] {} — name_en «{}» -> «{}»{}".format(
                idx, n_cards, label, current, name_en, note), flush=True)
        else:
            print("[{}/{}] {} — name_en = «{}»{}".format(
                idx, n_cards, label, name_en, note), flush=True)

    print("=" * 60)
    print("WRITE SUMMARY (cards.name_en{})".format(
        ", redo-translit" if redo_translit else ""))
    print("  name_en written  : {}".format(written))
    print("    via sitelink   : {}".format(via_sitelink))
    print("    via wd label   : {}".format(via_label))
    if not redo_translit:
        print("    via translit   : {}".format(via_translit))
    print("    найдено поиском: {}".format(via_search))
    if redo_translit:
        print("  без изменений    : {} (резолв дал тот же name_en)".format(
            unchanged))
        print("  сохранено как есть: {} (статья не нашлась — без "
              "перезаписи)".format(kept))
    else:
        print("  остаётся NULL    : {} (не-люди без сайтлинка/метки)".format(
            kept_null))
    print("  empty name (NULL): {}".format(empty_name))
    print("  errors skipped   : {}".format(errors))
    print("  budget used      : {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("=" * 60)


# --cards-translations: card-name translations into these languages by
# default. For the LATIN languages a missing sitelink/label on a PEOPLE card
# falls back to copying name_en (names in es/pt/fr are written as in en);
# zh/ja/ko/ar never take that fallback — Latin script is out of place there,
# no row is written and the frontend falls back to name_en itself.
CARDS_TRANSLATIONS_DEFAULT_LANGS = "es,pt,fr,zh,ja,ko,ar"
CARDS_TRANSLATIONS_LATIN_COPY = ("es", "pt", "fr")

# Trailing parenthetical qualifier in ANY of the target wikis' titles —
# ASCII and fullwidth (zh/ja) parentheses alike.
TRANSLATION_PAREN_RE = re.compile(r"\s*[（(][^()（）]*[)）]\s*$")


def strip_translation_parenthetical(title):
    """'Lionel Messi (futbolista)' -> 'Lionel Messi'; handles the fullwidth
    （…） pair used by zh/ja article titles too."""
    return TRANSLATION_PAREN_RE.sub("", (title or "").strip()).strip()


def run_cards_translations(cfg, dry_run, langs_csv):
    """Backfill card_translations: one display name per (card, lang).

    Chain per card: QID (players_meta.wikidata_qid matched by name first —
    free; else the same cached ruwiki resolver as --cards-photos, stadium
    P31 guard included) -> ONE wbgetentities per QID with sitelinks+labels
    for ALL requested languages at once (the budget does not multiply by
    the language count) -> per language: sitelink title (parenthetical
    stripped, fullwidth included) -> label -> for es/pt/fr PEOPLE cards a
    copy of name_en -> otherwise no row at all.

    Idempotent: existing (card_id, lang) pairs are skipped up front, and
    writes go through UPSERT on (card_id, lang) anyway. Rows are flushed
    every 50 cards, so a budget abort keeps its progress. Requires
    docs/card_translations.sql (the table + service_role grants).
    """
    langs = sorted({l.strip().lower()
                    for l in (langs_csv or "").split(",") if l.strip()})
    if not langs:
        raise SystemExit("--langs is empty; expected e.g. --langs "
                         + CARDS_TRANSLATIONS_DEFAULT_LANGS)
    photos_cfg = cfg.get("photos", {})
    pv = cfg["pageviews"]

    supa_url = require_env("SUPABASE_URL")
    supa_key = require_env("SUPABASE_KEY")

    cache = FileCache(
        os.path.join(BASE_DIR, cfg["cache"]["dir"]), cfg["cache"]["enabled"]
    )
    budget = WikimediaBudget(
        photos_cfg.get("daily_request_budget", 5000),
        os.path.join(BASE_DIR, cfg["cache"]["dir"], "photos_budget.json"),
    )
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget
    )
    cards_client = CardsClient(supa_url, supa_key)

    def fetch_paged(endpoint, select, extra=None, page_size=1000):
        rows, offset = [], 0
        while True:
            params = {"select": select, "order": "id.asc",
                      "limit": page_size, "offset": offset}
            params.update(extra or {})
            resp = requests.get(endpoint, headers=cards_client.read_headers,
                                params=params, timeout=30)
            resp.raise_for_status()
            batch = resp.json()
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return rows

    print("Читаю cards (active) и players_meta...", flush=True)
    cards = fetch_paged(cards_client.endpoint, "id,name,name_en,category",
                        {"active": "eq.true"})
    meta = fetch_paged(
        cards_client.endpoint.replace("/cards", "/players_meta"),
        "id,name_ru,name_en,wikidata_qid")

    # Existing (card_id, lang) pairs -> skip. Tolerated to fail before the
    # migration ran (dry-run still estimates; live aborts later anyway).
    table_ok = True
    existing = set()
    try:
        existing = cards_client.fetch_translation_pairs()
    except requests.HTTPError as exc:
        table_ok = False
        print("ВНИМАНИЕ: card_translations недоступна ({}). Выполните "
              "docs/card_translations.sql.".format(
                  exc.response.status_code if exc.response is not None
                  else exc), flush=True)

    # Card name -> players_meta QID (exact/canonical over name_ru AND
    # name_en) — the free QID source for the scraped players.
    AMBIG = object()

    def add_key(mapping, k, value):
        if not k:
            return
        cur = mapping.get(k)
        if cur is None:
            mapping[k] = value
        elif cur is not AMBIG and cur != value:
            mapping[k] = AMBIG

    exact_ru, canon_ru, exact_en, canon_en = {}, {}, {}, {}
    for m in meta:
        qid = (m.get("wikidata_qid") or "").strip()
        if not qid:
            continue
        ru = (m.get("name_ru") or "").strip()
        en = (m.get("name_en") or "").strip()
        add_key(exact_ru, ru, qid)
        add_key(canon_ru, canonical_key(ru), qid)
        add_key(exact_en, en.lower(), qid)
        add_key(canon_en, canonical_key(en), qid)

    def meta_qid(card):
        name = (card.get("name") or "").strip()
        name_en = (card.get("name_en") or "").strip()
        for mapping, k in ((exact_ru, name),
                           (canon_ru, canonical_key(name)),
                           (exact_en, name_en.lower()),
                           (canon_en, canonical_key(name_en))):
            hit = mapping.get(k) if k else None
            if hit is not None and hit is not AMBIG:
                return hit
        return None

    # Work list: cards that miss at least one requested language.
    todo = [c for c in cards
            if any((c["id"], lang) not in existing for lang in langs)]

    # Dry-run plan: what the caches already know.
    langs_key_prefix = ",".join(langs) + "|"
    qid_meta = qid_cached = qid_network = 0
    tr_cached = tr_new = 0
    seen_qids = set()
    for c in todo:
        qid = meta_qid(c)
        if qid:
            qid_meta += 1
        else:
            info = None
            for t in cards_photos_candidates(c):
                info = cache.get("ruwiki_pageprops", t)
                if info is not None and info.get("qid") \
                        and not info.get("disambig"):
                    qid = info["qid"]
                    break
            if qid:
                qid_cached += 1
            else:
                qid_network += 1
        if qid and qid not in seen_qids:
            seen_qids.add(qid)
            if cache.get("wikidata_translations",
                         langs_key_prefix + qid) is None:
                tr_new += 1
            else:
                tr_cached += 1

    by_category = {}
    for c in todo:
        by_category[c.get("category")] = by_category.get(c.get("category"), 0) + 1

    print("=" * 60)
    print("FOOTBALL SCRAPER — CARDS TRANSLATIONS ({})".format(
        "DRY RUN, без записи" if dry_run else "LIVE, UPSERT card_translations"))
    print("=" * 60)
    print("Языки            : {}".format(", ".join(langs)))
    print("Источник         : QID (players_meta -> кеш ruwiki -> сеть) -> "
          "wbgetentities sitelinks+labels ОДНИМ запросом на QID -> "
          "sitelink -> label -> name_en (только es/pt/fr, только люди)")
    print("Карточек к обработке: {} (из {} активных; уже переведено "
          "полностью: {})".format(len(todo), len(cards),
                                  len(cards) - len(todo)))
    for cat in sorted(by_category):
        print("  {:<14} : {}".format(cat or "?", by_category[cat]))
    print("QID              : из меты {}, из кеша ruwiki {}, нужна сеть {}"
          .format(qid_meta, qid_cached, qid_network))
    print("Переводы (wbgetentities): в кеше {}, новых запросов ~{}".format(
        tr_cached, tr_new))
    print("Бюджет           : {}/{} (UTC {}) — общий файл с --photos".format(
        budget.used, budget.limit, budget.date))
    print("card_translations: {}".format(
        "доступна" if table_ok else "НЕДОСТУПНА — live писать не сможет"))
    print("=" * 60, flush=True)

    if dry_run:
        print("DRY RUN — ничего не записано.")
        return
    if not table_ok:
        raise SystemExit(
            "card_translations недоступна — выполните "
            "docs/card_translations.sql и запустите снова.")

    people = set(CARDS_NAME_EN_CATEGORIES)
    stats = {lang: {"sitelink": 0, "label": 0, "name_en": 0, "skip": 0}
             for lang in langs}
    no_qid = 0
    errors = 0
    pending = []

    def flush():
        if pending:
            cards_client.upsert_card_translations(pending)
            del pending[:]

    n = len(todo)
    try:
        for idx, card in enumerate(todo, 1):
            try:
                qid = meta_qid(card)
                if not qid:
                    qid, _t, _s = resolve_card_qid(
                        resolver, card, cards_photos_candidates(card),
                        validate=make_stadium_qid_validator(
                            card, wikidata, cache, budget))
                if not qid:
                    no_qid += 1
                    for lang in langs:
                        if (card["id"], lang) not in existing:
                            stats[lang]["skip"] += 1
                    continue
                if cache.get("wikidata_translations",
                             langs_key_prefix + qid) is None:
                    budget.consume()
                trs = wikidata.translations_for_qid(qid, langs)
                for lang in langs:
                    if (card["id"], lang) in existing:
                        continue
                    info = trs.get(lang) or {}
                    title = strip_translation_parenthetical(
                        info.get("sitelink"))
                    label = (info.get("label") or "").strip()
                    if title:
                        name, source = title, "sitelink"
                    elif label:
                        name, source = label, "label"
                    elif (lang in CARDS_TRANSLATIONS_LATIN_COPY
                          and card.get("category") in people
                          and (card.get("name_en") or "").strip()):
                        name, source = card["name_en"].strip(), "name_en"
                    else:
                        stats[lang]["skip"] += 1
                        continue
                    stats[lang][source] += 1
                    pending.append({"card_id": card["id"], "lang": lang,
                                    "name": name, "source": source})
            except RuntimeError:
                raise  # daily budget exhausted — flush in finally, stop
            except Exception as exc:  # noqa: BLE001 — log, keep crawling
                errors += 1
                print("[{}/{}] {} — ошибка, пропуск: {}".format(
                    idx, n, card.get("name"), exc), flush=True)
                continue
            if len(pending) >= 200:
                flush()
            if idx % 100 == 0:
                print("[{}/{}] ... (бюджет {}/{})".format(
                    idx, n, budget.used, budget.limit), flush=True)
    finally:
        flush()

    print("=" * 60)
    print("WRITE SUMMARY (card_translations)")
    print("  {:<6} {:>9} {:>7} {:>9} {:>10}".format(
        "язык", "sitelink", "label", "name_en", "пропущено"))
    for lang in langs:
        s = stats[lang]
        print("  {:<6} {:>9} {:>7} {:>9} {:>10}".format(
            lang, s["sitelink"], s["label"], s["name_en"], s["skip"]))
    total = sum(s["sitelink"] + s["label"] + s["name_en"]
                for s in stats.values())
    print("  всего записано   : {}".format(total))
    print("  карточек без QID : {}".format(no_qid))
    print("  errors skipped   : {}".format(errors))
    print("  budget used      : {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("=" * 60)


# Nationality / country -> cards.continent bucket. Keys are normalised
# (lowercased, curly apostrophes folded). The frontend has five buckets
# (continents_filter.sql); NULL shows as "Прочие". Football confederations
# override pure geography exactly where the user asked:
#   * ex-Soviet UEFA members (Russia, Armenia, Georgia, Kazakhstan,
#     Azerbaijan) -> Europe, even though parts are geographically in Asia;
#   * Central-Asian AFC members (Uzbekistan, Tajikistan, Kyrgyzstan,
#     Turkmenistan) -> Asia;
#   * Australia (AFC) -> Asia. Oceania has no bucket, so New Zealand and the
#     Pacific islands stay NULL ("Прочие").
# Covers every nationality in the API-Football cache plus common Wikidata
# P27 English labels (United Kingdom, Soviet Union, Yugoslavia, ...).
CONTINENT_BY_COUNTRY = {}


def _continent_add(continent, names):
    for name in names:
        CONTINENT_BY_COUNTRY[name.lower()] = continent


_continent_add("europe", (
    "Albania", "Andorra", "Armenia", "Austria", "Azerbaijan", "Belarus",
    "Belgium", "Bosnia and Herzegovina", "Bulgaria", "Croatia", "Cyprus",
    "Czech Republic", "Czechia", "Denmark", "England", "Estonia", "Finland",
    "France", "Georgia", "Germany", "Greece", "Hungary", "Iceland", "Israel",
    "Italy", "Kazakhstan", "Kosovo", "Latvia", "Liechtenstein", "Lithuania",
    "Luxembourg", "Malta", "Moldova", "Monaco", "Montenegro", "Netherlands",
    "North Macedonia", "Macedonia", "Northern Ireland", "Norway", "Poland",
    "Portugal", "Republic of Ireland", "Ireland", "Romania", "Russia",
    "Russian Federation", "San Marino", "Scotland", "Serbia",
    "Serbia and Montenegro", "Slovakia", "Slovenia", "Spain", "Sweden",
    "Switzerland", "Türkiye", "Turkey", "Ukraine", "Wales", "Faroe Islands",
    "Gibraltar", "United Kingdom", "Great Britain", "Soviet Union",
    "Yugoslavia", "Czechoslovakia", "West Germany", "East Germany",
    "German Democratic Republic", "SFR Yugoslavia", "FR Yugoslavia",
))
_continent_add("south_america", (
    "Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Ecuador",
    "Guyana", "Paraguay", "Peru", "Suriname", "Uruguay", "Venezuela",
))
_continent_add("africa", (
    "Algeria", "Angola", "Benin", "Burkina Faso", "Burundi", "Cameroon",
    "Cape Verde", "Cabo Verde", "Central African Republic", "Chad",
    "Comoros", "Congo", "Congo DR", "DR Congo", "Democratic Republic of the Congo",
    "Republic of the Congo", "Côte d'Ivoire", "Cote d'Ivoire", "Ivory Coast",
    "Egypt", "Equatorial Guinea", "Eswatini", "Gabon", "Gambia", "Ghana",
    "Guinea", "Guinea-Bissau", "Kenya", "Liberia", "Libya", "Madagascar",
    "Malawi", "Mali", "Mauritania", "Mauritius", "Morocco", "Mozambique",
    "Namibia", "Niger", "Nigeria", "Rwanda", "Senegal", "Sierra Leone",
    "Somalia", "South Africa", "South Sudan", "Sudan", "Tanzania", "Togo",
    "Tunisia", "Uganda", "Zambia", "Zimbabwe",
))
_continent_add("asia", (
    "Afghanistan", "Australia", "Bahrain", "Bangladesh", "Cambodia", "China",
    "China PR", "Hong Kong", "India", "Indonesia", "Iran", "Iraq", "Japan",
    "Jordan", "Korea Republic", "South Korea", "Korea", "Korea DPR",
    "North Korea", "Kuwait", "Kyrgyzstan", "Lebanon", "Malaysia", "Mongolia",
    "Myanmar", "Nepal", "Oman", "Palestine", "Philippines", "Qatar",
    "Saudi Arabia", "Singapore", "Syria", "Tajikistan", "Thailand",
    "Turkmenistan", "United Arab Emirates", "UAE", "Uzbekistan", "Vietnam",
    "Yemen",
))
_continent_add("north_america", (
    "Antigua and Barbuda", "Aruba", "Bahamas", "The Bahamas", "Barbados",
    "Belize", "Bermuda", "Canada", "Cayman Islands", "Costa Rica", "Cuba",
    "Curaçao", "Curacao", "Dominica", "Dominican Republic", "El Salvador",
    "Grenada", "Guadeloupe", "Guatemala", "Haiti", "Honduras", "Jamaica",
    "Martinique", "Mexico", "Montserrat", "Nicaragua", "Panama",
    "Puerto Rico", "St. Lucia", "Saint Lucia", "St. Kitts and Nevis",
    "Trinidad and Tobago", "USA", "United States", "United States of America",
))


def normalize_country(name):
    return (name or "").replace("’", "'").strip().lower()


def continent_for_country(name):
    """cards.continent bucket for a nationality / country name, or None
    (Oceania and anything unmapped stay NULL -> 'Прочие')."""
    return CONTINENT_BY_COUNTRY.get(normalize_country(name))


# Nationality / country -> ISO 3166-1 alpha-2 for the player flag. The three
# UK home nations that have their OWN emoji flag use subdivision codes
# (GB-ENG/GB-SCT/GB-WLS); Northern Ireland has no emoji -> plain GB. Unlike
# the continent map this is filled for OCEANIA too (New Zealand gets a flag
# even though its continent stays NULL). Historical states with no emoji flag
# (USSR, Yugoslavia) are intentionally absent -> no flag.
COUNTRY_ISO = {}


def _iso_add(code, names):
    for name in names:
        COUNTRY_ISO[name.lower()] = code


_iso_add("AL", ("Albania",)); _iso_add("AD", ("Andorra",))
_iso_add("AM", ("Armenia",)); _iso_add("AT", ("Austria",))
_iso_add("AZ", ("Azerbaijan",)); _iso_add("BY", ("Belarus",))
_iso_add("BE", ("Belgium",)); _iso_add("BA", ("Bosnia and Herzegovina",))
_iso_add("BG", ("Bulgaria",)); _iso_add("HR", ("Croatia",))
_iso_add("CY", ("Cyprus",)); _iso_add("CZ", ("Czech Republic", "Czechia"))
_iso_add("DK", ("Denmark",)); _iso_add("EE", ("Estonia",))
_iso_add("FI", ("Finland",)); _iso_add("FR", ("France",))
_iso_add("GE", ("Georgia",)); _iso_add("DE", ("Germany", "West Germany",
    "East Germany", "German Democratic Republic"))
_iso_add("GR", ("Greece",)); _iso_add("HU", ("Hungary",))
_iso_add("IS", ("Iceland",)); _iso_add("IL", ("Israel",))
_iso_add("IT", ("Italy",)); _iso_add("KZ", ("Kazakhstan",))
_iso_add("XK", ("Kosovo",)); _iso_add("LV", ("Latvia",))
_iso_add("LI", ("Liechtenstein",)); _iso_add("LT", ("Lithuania",))
_iso_add("LU", ("Luxembourg",)); _iso_add("MT", ("Malta",))
_iso_add("MD", ("Moldova",)); _iso_add("MC", ("Monaco",))
_iso_add("ME", ("Montenegro",)); _iso_add("NL", ("Netherlands",))
_iso_add("MK", ("North Macedonia", "Macedonia"))
_iso_add("NO", ("Norway",)); _iso_add("PL", ("Poland",))
_iso_add("PT", ("Portugal",)); _iso_add("IE", ("Republic of Ireland", "Ireland"))
_iso_add("RO", ("Romania",)); _iso_add("RU", ("Russia", "Russian Federation"))
_iso_add("SM", ("San Marino",)); _iso_add("RS", ("Serbia", "Serbia and Montenegro"))
_iso_add("SK", ("Slovakia",)); _iso_add("SI", ("Slovenia",))
_iso_add("ES", ("Spain",)); _iso_add("SE", ("Sweden",))
_iso_add("CH", ("Switzerland",)); _iso_add("TR", ("Türkiye", "Turkey"))
_iso_add("UA", ("Ukraine",)); _iso_add("FO", ("Faroe Islands",))
_iso_add("GI", ("Gibraltar",)); _iso_add("GB", ("United Kingdom", "Great Britain"))
_iso_add("GB-ENG", ("England",)); _iso_add("GB-SCT", ("Scotland",))
_iso_add("GB-WLS", ("Wales",)); _iso_add("GB", ("Northern Ireland",))
# South America
_iso_add("AR", ("Argentina",)); _iso_add("BO", ("Bolivia",))
_iso_add("BR", ("Brazil",)); _iso_add("CL", ("Chile",))
_iso_add("CO", ("Colombia",)); _iso_add("EC", ("Ecuador",))
_iso_add("GY", ("Guyana",)); _iso_add("PY", ("Paraguay",))
_iso_add("PE", ("Peru",)); _iso_add("SR", ("Suriname",))
_iso_add("UY", ("Uruguay",)); _iso_add("VE", ("Venezuela",))
# Africa
_iso_add("DZ", ("Algeria",)); _iso_add("AO", ("Angola",))
_iso_add("BJ", ("Benin",)); _iso_add("BF", ("Burkina Faso",))
_iso_add("BI", ("Burundi",)); _iso_add("CM", ("Cameroon",))
_iso_add("CV", ("Cape Verde", "Cabo Verde")); _iso_add("CF", ("Central African Republic",))
_iso_add("TD", ("Chad",)); _iso_add("KM", ("Comoros",))
_iso_add("CG", ("Congo", "Republic of the Congo"))
_iso_add("CD", ("Congo DR", "DR Congo", "Democratic Republic of the Congo"))
_iso_add("CI", ("Côte d'Ivoire", "Cote d'Ivoire", "Ivory Coast"))
_iso_add("EG", ("Egypt",)); _iso_add("GQ", ("Equatorial Guinea",))
_iso_add("SZ", ("Eswatini",)); _iso_add("GA", ("Gabon",))
_iso_add("GM", ("Gambia",)); _iso_add("GH", ("Ghana",))
_iso_add("GN", ("Guinea",)); _iso_add("GW", ("Guinea-Bissau",))
_iso_add("KE", ("Kenya",)); _iso_add("LR", ("Liberia",))
_iso_add("LY", ("Libya",)); _iso_add("MG", ("Madagascar",))
_iso_add("MW", ("Malawi",)); _iso_add("ML", ("Mali",))
_iso_add("MR", ("Mauritania",)); _iso_add("MU", ("Mauritius",))
_iso_add("MA", ("Morocco",)); _iso_add("MZ", ("Mozambique",))
_iso_add("NA", ("Namibia",)); _iso_add("NE", ("Niger",))
_iso_add("NG", ("Nigeria",)); _iso_add("RW", ("Rwanda",))
_iso_add("SN", ("Senegal",)); _iso_add("SL", ("Sierra Leone",))
_iso_add("SO", ("Somalia",)); _iso_add("ZA", ("South Africa",))
_iso_add("SS", ("South Sudan",)); _iso_add("SD", ("Sudan",))
_iso_add("TZ", ("Tanzania",)); _iso_add("TG", ("Togo",))
_iso_add("TN", ("Tunisia",)); _iso_add("UG", ("Uganda",))
_iso_add("ZM", ("Zambia",)); _iso_add("ZW", ("Zimbabwe",))
# Asia + Oceania (flags exist even where the continent bucket is NULL)
_iso_add("AF", ("Afghanistan",)); _iso_add("AU", ("Australia",))
_iso_add("BH", ("Bahrain",)); _iso_add("BD", ("Bangladesh",))
_iso_add("KH", ("Cambodia",)); _iso_add("CN", ("China", "China PR"))
_iso_add("HK", ("Hong Kong",)); _iso_add("IN", ("India",))
_iso_add("ID", ("Indonesia",)); _iso_add("IR", ("Iran",))
_iso_add("IQ", ("Iraq",)); _iso_add("JP", ("Japan",))
_iso_add("JO", ("Jordan",)); _iso_add("KR", ("Korea Republic", "South Korea", "Korea"))
_iso_add("KP", ("Korea DPR", "North Korea")); _iso_add("KW", ("Kuwait",))
_iso_add("KG", ("Kyrgyzstan",)); _iso_add("LB", ("Lebanon",))
_iso_add("MY", ("Malaysia",)); _iso_add("MN", ("Mongolia",))
_iso_add("MM", ("Myanmar",)); _iso_add("NP", ("Nepal",))
_iso_add("OM", ("Oman",)); _iso_add("PS", ("Palestine",))
_iso_add("PH", ("Philippines",)); _iso_add("QA", ("Qatar",))
_iso_add("SA", ("Saudi Arabia",)); _iso_add("SG", ("Singapore",))
_iso_add("SY", ("Syria",)); _iso_add("TJ", ("Tajikistan",))
_iso_add("TH", ("Thailand",)); _iso_add("TM", ("Turkmenistan",))
_iso_add("AE", ("United Arab Emirates", "UAE")); _iso_add("UZ", ("Uzbekistan",))
_iso_add("VN", ("Vietnam",)); _iso_add("YE", ("Yemen",))
_iso_add("NZ", ("New Zealand",)); _iso_add("FJ", ("Fiji",))
_iso_add("PG", ("Papua New Guinea",))
# North America / Caribbean
_iso_add("AG", ("Antigua and Barbuda",)); _iso_add("AW", ("Aruba",))
_iso_add("BS", ("Bahamas", "The Bahamas")); _iso_add("BB", ("Barbados",))
_iso_add("BZ", ("Belize",)); _iso_add("BM", ("Bermuda",))
_iso_add("CA", ("Canada",)); _iso_add("KY", ("Cayman Islands",))
_iso_add("CR", ("Costa Rica",)); _iso_add("CU", ("Cuba",))
_iso_add("CW", ("Curaçao", "Curacao")); _iso_add("DM", ("Dominica",))
_iso_add("DO", ("Dominican Republic",)); _iso_add("SV", ("El Salvador",))
_iso_add("GD", ("Grenada",)); _iso_add("GP", ("Guadeloupe",))
_iso_add("GT", ("Guatemala",)); _iso_add("HT", ("Haiti",))
_iso_add("HN", ("Honduras",)); _iso_add("JM", ("Jamaica",))
_iso_add("MQ", ("Martinique",)); _iso_add("MX", ("Mexico",))
_iso_add("MS", ("Montserrat",)); _iso_add("NI", ("Nicaragua",))
_iso_add("PA", ("Panama",)); _iso_add("PR", ("Puerto Rico",))
_iso_add("LC", ("St. Lucia", "Saint Lucia")); _iso_add("KN", ("St. Kitts and Nevis",))
_iso_add("TT", ("Trinidad and Tobago",))
_iso_add("US", ("USA", "United States", "United States of America"))


def iso_for_country(name):
    """ISO 3166-1 alpha-2 (or GB-ENG/SCT/WLS subdivision) for the flag, or
    None when there is no emoji flag (unmapped / historical states)."""
    return COUNTRY_ISO.get(normalize_country(name))


def run_cards_country(cfg, dry_run):
    """Fill cards.continent for player cards where it IS NULL.

    Source order per card:
      1. nationality from the LOCAL API-Football cache (no budget) — the card
         is matched to players_meta by name (exact/canonical over name_ru and
         name_en, ambiguous keys skipped), and meta.api_football_id keys the
         cached player's nationality.
      2. legends absent from the cache: Wikidata P27 (country of citizenship)
         of the card's QID (players_meta.wikidata_qid, else the cached ruwiki
         resolver), then the country's English label -> the same map.
    Nationality/country -> CONTINENT_BY_COUNTRY (confederation overrides where
    the user asked). PATCH cards.continent guarded by continent IS NULL, so a
    re-run changes nothing. Wikidata calls share the --photos daily budget;
    the API-Football cache is read-only (no API budget spent)."""
    photos_cfg = cfg.get("photos", {})
    pv = cfg["pageviews"]
    supa_url = require_env("SUPABASE_URL")
    supa_key = require_env("SUPABASE_KEY")

    cache = FileCache(
        os.path.join(BASE_DIR, cfg["cache"]["dir"]), cfg["cache"]["enabled"])
    budget = WikimediaBudget(
        photos_cfg.get("daily_request_budget", 5000),
        os.path.join(BASE_DIR, cfg["cache"]["dir"], "photos_budget.json"))
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget)
    cards_client = CardsClient(supa_url, supa_key)

    def fetch_paged(endpoint, select, extra=None, page_size=1000):
        rows, offset = [], 0
        while True:
            params = {"select": select, "order": "id.asc",
                      "limit": page_size, "offset": offset}
            params.update(extra or {})
            resp = requests.get(endpoint, headers=cards_client.read_headers,
                                params=params, timeout=30)
            resp.raise_for_status()
            batch = resp.json()
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return rows

    print("Читаю player-карточки и players_meta...", flush=True)
    # All player cards: continent and country are written with independent
    # IS NULL guards, so re-processing already-filled rows is a cheap no-op.
    cards = fetch_paged(cards_client.endpoint, "id,name,name_en",
                        {"category": "eq.player"})
    meta = fetch_paged(
        cards_client.endpoint.replace("/cards", "/players_meta"),
        "api_football_id,name_ru,name_en,wikidata_qid")

    # api_football_id -> nationality, from the local cache (no API calls).
    nat_by_api_id = {}
    api_dir = os.path.join(BASE_DIR, cfg["cache"]["dir"], "api_football")
    if os.path.isdir(api_dir):
        for fname in os.listdir(api_dir):
            if not fname.endswith(".json"):
                continue
            try:
                with open(os.path.join(api_dir, fname), encoding="utf-8") as fh:
                    data = json.load(fh)
            except (OSError, ValueError):
                continue
            if data.get("get") != "players":
                continue
            for entry in data.get("response") or []:
                player = entry.get("player") or {}
                pid = player.get("id")
                nat = (player.get("nationality") or "").strip()
                if pid and nat:
                    nat_by_api_id.setdefault(pid, nat)

    # Card name -> meta (exact/canonical over name_ru AND name_en).
    AMBIG = object()

    def add_key(mapping, k, value):
        if not k:
            return
        cur = mapping.get(k)
        if cur is None:
            mapping[k] = value
        elif cur is not AMBIG and cur != value:
            mapping[k] = AMBIG

    exact_ru, canon_ru, exact_en, canon_en = {}, {}, {}, {}
    for m in meta:
        ru = (m.get("name_ru") or "").strip()
        en = (m.get("name_en") or "").strip()
        add_key(exact_ru, ru, m)
        add_key(canon_ru, canonical_key(ru), m)
        add_key(exact_en, en.lower(), m)
        add_key(canon_en, canonical_key(en), m)

    def meta_for(card):
        name = (card.get("name") or "").strip()
        en = (card.get("name_en") or "").strip()
        for mapping, k in ((exact_ru, name),
                           (canon_ru, canonical_key(name)),
                           (exact_en, en.lower()),
                           (canon_en, canonical_key(en))):
            hit = mapping.get(k) if k else None
            if hit is not None and hit is not AMBIG:
                return hit
        return None

    print("=" * 60)
    print("FOOTBALL SCRAPER — CARDS COUNTRY/CONTINENT ({})".format(
        "DRY RUN, без записи" if dry_run
        else "LIVE, запись cards.continent + country"))
    print("=" * 60)
    print("Player-карточек: {}".format(len(cards)))
    print("players_meta: {}, в кеше API наций: {}".format(
        len(meta), len(nat_by_api_id)))
    print("Источник: кеш API-Football (nationality) -> Wikidata P27 (легенды)")
    print("Бюджет Wikidata: {}/{} (UTC {}) — общий с --photos".format(
        budget.used, budget.limit, budget.date))
    print("=" * 60, flush=True)

    by_continent = {}
    via_api = via_p27 = 0
    with_continent = 0   # cards that resolved to a continent bucket
    with_flag = 0        # cards that resolved to an ISO flag code
    no_continent = 0     # country known but no bucket (Oceania etc.) -> NULL
    no_flag = 0          # country known but no ISO/emoji (USSR etc.)
    no_source = 0        # neither nationality nor a resolvable QID
    errors = 0
    n = len(cards)

    try:
        for idx, card in enumerate(cards, 1):
            try:
                m = meta_for(card)
                country = None
                source = None
                # 1) nationality from the API cache (free).
                if m and m.get("api_football_id") in nat_by_api_id:
                    country = nat_by_api_id[m["api_football_id"]]
                    source = "api"
                # 2) legend fallback: Wikidata P27 of the card's QID.
                if not country:
                    qid = (m or {}).get("wikidata_qid")
                    if not qid:
                        for title in cards_photos_candidates(card):
                            info = cache.get("ruwiki_pageprops", title)
                            if info and info.get("qid") \
                                    and not info.get("disambig"):
                                qid = info["qid"]
                                break
                    if qid:
                        if cache.get("wikidata_p27", qid) is None:
                            budget.consume()
                        for country_qid in wikidata.claim_item_ids(qid, "P27"):
                            if cache.get("wikidata_label_en",
                                         country_qid) is None:
                                budget.consume()
                            label = wikidata.label_en_for_qid(country_qid)
                            if iso_for_country(label) \
                                    or continent_for_country(label):
                                country = label
                                source = "p27"
                                break
                            country = country or label  # remember for logging

                if not country:
                    no_source += 1
                    continue

                continent = continent_for_country(country)
                iso = iso_for_country(country)

                if continent:
                    if not dry_run:
                        cards_client.set_card_continent(card["id"], continent)
                    by_continent[continent] = by_continent.get(continent, 0) + 1
                    with_continent += 1
                    if source == "api":
                        via_api += 1
                    else:
                        via_p27 += 1
                else:
                    no_continent += 1  # e.g. New Zealand (Oceania)

                if iso:
                    if not dry_run:
                        cards_client.set_card_country(card["id"], iso)
                    with_flag += 1
                else:
                    no_flag += 1
            except RuntimeError:
                raise  # budget exhausted — stop politely, progress saved
            except Exception as exc:  # noqa: BLE001
                errors += 1
                print("[{}/{}] {} — ошибка, пропуск: {}".format(
                    idx, n, card.get("name"), exc), flush=True)
                continue
            if idx % 200 == 0:
                print("[{}/{}] ... (бюджет {}/{})".format(
                    idx, n, budget.used, budget.limit), flush=True)
    finally:
        pass

    print("=" * 60)
    print("WRITE SUMMARY (cards.continent + country)")
    print("  континент проставлен: {} (API {}, P27 {})".format(
        with_continent, via_api, via_p27))
    for cont in sorted(by_continent):
        print("    {:<14} : {}".format(cont, by_continent[cont]))
    print("  ФЛАГ (ISO) проставлен: {}".format(with_flag))
    print("  страна без континент-бакета (Океания и пр.): {}".format(
        no_continent))
    print("  страна без ISO-флага (USSR/истор.): {}".format(no_flag))
    print("  без источника (нет нации/QID): {}".format(no_source))
    print("  errors: {}".format(errors))
    print("  budget used: {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("=" * 60)


# Player position -> Russian bucket (one of four). Matched by keyword against
# the API-Football games.position (Goalkeeper/Defender/Midfielder/Attacker)
# or a Wikidata P413 entity's English label ("central defender", "winger"...).
# NB: Полузащитник MUST precede Защитник — the RU label "полузащитник"
# contains the substring "защит", so checking Защитник first mislabels every
# midfielder as a defender.
POSITION_RU_BUCKETS = (
    ("Вратарь", ("goalkeep", "вратар")),
    ("Полузащитник", ("midfield", "полузащит")),
    ("Защитник", ("defen", "back", "защит")),
    ("Нападающий", ("forward", "strik", "attack", "winger", "wing",
                    "нападающ", "форвард")),
)


def position_ru_from_label(label):
    """Russian position bucket for a position label (EN or RU), or None."""
    s = (label or "").lower()
    if not s:
        return None
    for ru, keys in POSITION_RU_BUCKETS:
        if any(k in s for k in keys):
            return ru
    return None


def run_cards_position(cfg, dry_run):
    """Fill cards.position_ru for player cards: most-common games.position
    from the LOCAL API-Football cache (no API budget) matched via
    players_meta; legends fall back to Wikidata P413 (position played) of the
    QID from players_meta / the cached resolver, mapped to one of four Russian
    buckets. PATCH guarded by position_ru IS NULL, idempotent. Requires
    docs/cards_position_column.sql."""
    photos_cfg = cfg.get("photos", {})
    pv = cfg["pageviews"]
    supa_url = require_env("SUPABASE_URL")
    supa_key = require_env("SUPABASE_KEY")

    cache = FileCache(
        os.path.join(BASE_DIR, cfg["cache"]["dir"]), cfg["cache"]["enabled"])
    budget = WikimediaBudget(
        photos_cfg.get("daily_request_budget", 5000),
        os.path.join(BASE_DIR, cfg["cache"]["dir"], "photos_budget.json"))
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    cards_client = CardsClient(supa_url, supa_key)

    def fetch_paged(endpoint, select, extra=None, page_size=1000):
        rows, offset = [], 0
        while True:
            params = {"select": select, "order": "id.asc",
                      "limit": page_size, "offset": offset}
            params.update(extra or {})
            resp = requests.get(endpoint, headers=cards_client.read_headers,
                                params=params, timeout=30)
            resp.raise_for_status()
            batch = resp.json()
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return rows

    print("Читаю player-карточки и players_meta...", flush=True)
    cards = fetch_paged(cards_client.endpoint, "id,name,name_en",
                        {"category": "eq.player"})
    meta = fetch_paged(
        cards_client.endpoint.replace("/cards", "/players_meta"),
        "api_football_id,name_ru,name_en,wikidata_qid")

    # api_football_id -> most-common games.position bucket (local cache).
    pos_counts = {}
    api_dir = os.path.join(BASE_DIR, cfg["cache"]["dir"], "api_football")
    if os.path.isdir(api_dir):
        for fname in os.listdir(api_dir):
            if not fname.endswith(".json"):
                continue
            try:
                with open(os.path.join(api_dir, fname), encoding="utf-8") as fh:
                    data = json.load(fh)
            except (OSError, ValueError):
                continue
            if data.get("get") != "players":
                continue
            for entry in data.get("response") or []:
                pid = (entry.get("player") or {}).get("id")
                if not pid:
                    continue
                for stat in entry.get("statistics") or []:
                    bucket = position_ru_from_label(
                        (stat.get("games") or {}).get("position"))
                    if bucket:
                        pos_counts.setdefault(pid, {})
                        pos_counts[pid][bucket] = pos_counts[pid].get(bucket, 0) + 1
    pos_by_api_id = {
        pid: max(counts, key=counts.get) for pid, counts in pos_counts.items()}

    AMBIG = object()

    def add_key(mapping, k, value):
        if not k:
            return
        cur = mapping.get(k)
        if cur is None:
            mapping[k] = value
        elif cur is not AMBIG and cur != value:
            mapping[k] = AMBIG

    exact_ru, canon_ru, exact_en, canon_en = {}, {}, {}, {}
    for m in meta:
        ru = (m.get("name_ru") or "").strip()
        en = (m.get("name_en") or "").strip()
        add_key(exact_ru, ru, m)
        add_key(canon_ru, canonical_key(ru), m)
        add_key(exact_en, en.lower(), m)
        add_key(canon_en, canonical_key(en), m)

    def meta_for(card):
        name = (card.get("name") or "").strip()
        en = (card.get("name_en") or "").strip()
        for mapping, k in ((exact_ru, name), (canon_ru, canonical_key(name)),
                           (exact_en, en.lower()), (canon_en, canonical_key(en))):
            hit = mapping.get(k) if k else None
            if hit is not None and hit is not AMBIG:
                return hit
        return None

    print("=" * 60)
    print("FOOTBALL SCRAPER — CARDS POSITION ({})".format(
        "DRY RUN, без записи" if dry_run else "LIVE, запись cards.position_ru"))
    print("=" * 60)
    print("Player-карточек: {}; в кеше API позиций: {}".format(
        len(cards), len(pos_by_api_id)))
    print("Источник: кеш API-Football games.position -> Wikidata P413")
    print("=" * 60, flush=True)

    by_pos = {}
    via_api = via_p413 = no_source = errors = 0
    n = len(cards)
    for idx, card in enumerate(cards, 1):
        try:
            m = meta_for(card)
            pos = None
            if m and m.get("api_football_id") in pos_by_api_id:
                pos = pos_by_api_id[m["api_football_id"]]
                src = "api"
            if not pos:
                qid = (m or {}).get("wikidata_qid")
                if not qid:
                    for title in cards_photos_candidates(card):
                        info = cache.get("ruwiki_pageprops", title)
                        if info and info.get("qid") and not info.get("disambig"):
                            qid = info["qid"]
                            break
                if qid:
                    if cache.get("wikidata_p413", qid) is None:
                        budget.consume()
                    for pos_qid in wikidata.claim_item_ids(qid, "P413"):
                        if cache.get("wikidata_label_en", pos_qid) is None:
                            budget.consume()
                        pos = position_ru_from_label(
                            wikidata.label_en_for_qid(pos_qid))
                        if pos:
                            src = "p413"
                            break
            if not pos:
                no_source += 1
                continue
            if not dry_run:
                cards_client.set_card_position(card["id"], pos)
            by_pos[pos] = by_pos.get(pos, 0) + 1
            via_api += 1 if src == "api" else 0
            via_p413 += 1 if src == "p413" else 0
        except RuntimeError:
            raise
        except Exception as exc:  # noqa: BLE001
            errors += 1
            print("[{}/{}] {} — ошибка: {}".format(idx, n, card.get("name"), exc),
                  flush=True)
            continue
        if idx % 300 == 0:
            print("[{}/{}] ... (бюджет {}/{})".format(
                idx, n, budget.used, budget.limit), flush=True)

    print("=" * 60)
    print("WRITE SUMMARY (cards.position_ru)")
    print("  позиция проставлена: {} (API {}, P413 {})".format(
        sum(by_pos.values()), via_api, via_p413))
    for p in sorted(by_pos, key=lambda x: -by_pos[x]):
        print("    {:<14} : {}".format(p, by_pos[p]))
    print("  без источника: {}".format(no_source))
    print("  errors: {}".format(errors))
    print("  budget used: {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("=" * 60)


# Prestige P166 awards worth showing as a legend's titles, MOST important
# first. Short RU label is hard-coded — Wikidata's own ru label is too long
# for a card ("чемпионат мира по футболу" -> "ЧМ"). State orders / medals in
# P166 are ignored (not in this list). World Cup / Euro / Champions League
# wins appear in P166 for some entries (modelled as awards received).
LEGEND_TITLE_ORDER = (
    ("Q166177",  "Золотой мяч"),       # Ballon d'Or
    ("Q838976",  "Золотой мяч ФИФА"),  # FIFA Ballon d'Or (2010–2015)
    ("Q176572",  "Игрок года ФИФА"),   # FIFA World Player of the Year
    ("Q19317",   "ЧМ"),               # FIFA World Cup
    ("Q260858",  "ЧЕ"),               # UEFA European Championship
    ("Q18756",   "Лига чемпионов"),    # UEFA Champions League
    ("Q180885",  "Золотая бутса"),     # European Golden Shoe
    ("Q1011789", "Пушкаш"),           # FIFA Puskás Award
)
LEGEND_TITLE_SHORT = dict(LEGEND_TITLE_ORDER)
LEGEND_MAX_TITLES = 3
# A club P54 value whose ru/en label matches this is a NATIONAL or youth team,
# not a club — excluded from the legend's club list. The English labels read
# "X national football team" / "X national under-18 football team", so match
# "national ... team" loosely and any "under-NN" age group.
LEGEND_NOT_CLUB_RE = re.compile(
    r"сборн|national.*team|national football|under[\s-]?\d|молодёж|молодеж|"
    r"youth|олимпийск|olympic", re.I)
# Legends show at most this many clubs, the longest tenures first.
LEGEND_MAX_CLUBS = 4


def _wd_year(quals, prop):
    """4-digit year string from a P580/P582/P585 date qualifier, or None."""
    try:
        return quals[prop][0]["datavalue"]["value"]["time"][1:5]
    except (KeyError, IndexError, TypeError):
        return None


def legend_titles_from_claims(claims):
    """Prestige P166 titles (max LEGEND_MAX_TITLES) for ANY player, as short
    RU labels with a year (P585). A repeated award collapses to 'short ×N'.
    Award QIDs are matched against the hard-coded LEGEND_TITLE_ORDER, so no
    label lookup (and no budget) is needed. Used for legends AND active
    players — the golden titles line shows for everyone with a title."""
    years_by_award = {}
    for st in (claims or {}).get("P166", []):
        try:
            aqid = st["mainsnak"]["datavalue"]["value"]["id"]
        except (KeyError, TypeError):
            continue
        if aqid in LEGEND_TITLE_SHORT:
            years_by_award.setdefault(aqid, []).append(
                _wd_year(st.get("qualifiers", {}) or {}, "P585"))
    titles = []
    for aqid, short in LEGEND_TITLE_ORDER:
        if aqid not in years_by_award or len(titles) >= LEGEND_MAX_TITLES:
            continue
        ys = sorted(y for y in years_by_award[aqid] if y)
        count = len(years_by_award[aqid])
        if count > 1:
            titles.append("{} ×{}".format(short, count))
        elif ys:
            titles.append("{} {}".format(short, ys[0]))
        else:
            titles.append(short)
    return titles


def _legend_career_from_entity(entity, label_map):
    """Build the legend_career dict from a Wikidata entity + a {qid: {ru,en}}
    label map. Returns {"clubs": [...], "position": ..., "titles": [...]} or
    None when there is nothing worth showing."""
    claims = entity.get("claims", {}) or {}

    def ru_label(qid):
        rec = label_map.get(qid) or {}
        return rec.get("ru") or rec.get("en")

    # Clubs (P54), national/youth teams filtered out; spans merged per club.
    spans = {}
    for st in claims.get("P54", []):
        try:
            cqid = st["mainsnak"]["datavalue"]["value"]["id"]
        except (KeyError, TypeError):
            continue
        name = ru_label(cqid)
        if not name or LEGEND_NOT_CLUB_RE.search(name):
            continue
        quals = st.get("qualifiers", {}) or {}
        start, end = _wd_year(quals, "P580"), _wd_year(quals, "P582")
        cur = spans.get(name)
        s = min(int(start), cur[0]) if (start and cur and cur[0]) else (
            int(start) if start else (cur[0] if cur else None))
        e = max(int(end), cur[1]) if (end and cur and cur[1]) else (
            int(end) if end else (cur[1] if cur else None))
        spans[name] = (s, e)

    # Keep the LEGEND_MAX_CLUBS longest tenures (years span), not the first
    # ones — a career is defined by the clubs played at longest; short
    # episodes / loans drop off after the 4th. Unknown-duration spans (no end
    # year) rank last; ties keep chronological order.
    clubs = []
    for name, (s, e) in spans.items():
        if s and e:
            years = "{}–{}".format(s, e)
        elif s:
            years = "{}–".format(s)
        else:
            years = ""
        duration = (e - s) if (s and e) else -1
        clubs.append({"club": name, "years": years, "_s": s or 9999,
                      "_d": duration})
    clubs.sort(key=lambda c: (-c["_d"], c["_s"]))
    clubs = clubs[:LEGEND_MAX_CLUBS]
    for c in clubs:
        del c["_s"], c["_d"]

    # Position (P413) -> one of the four Russian buckets.
    position = None
    for st in claims.get("P413", []):
        try:
            pqid = st["mainsnak"]["datavalue"]["value"]["id"]
        except (KeyError, TypeError):
            continue
        position = position_ru_from_label(ru_label(pqid))
        if position:
            break

    # Titles (P166): top prestige awards, priority-ordered (shared with the
    # active-player pass).
    titles = legend_titles_from_claims(claims)

    if not clubs and not titles:
        return None  # nothing useful (position alone comes from --cards-position)
    out = {"clubs": clubs}
    if position:
        out["position"] = position
    if titles:
        out["titles"] = titles
    return out


def _referenced_qids(entity):
    """Club/position/award QIDs referenced by an entity's P54/P413/P166."""
    out = []
    claims = entity.get("claims", {}) or {}
    for prop in ("P54", "P413", "P166"):
        for st in claims.get(prop, []):
            try:
                out.append(st["mainsnak"]["datavalue"]["value"]["id"])
            except (KeyError, TypeError):
                continue
    return out


def run_cards_legend_career(cfg, dry_run):
    """Collect cards.legend_career for LEGENDS (player cards with
    clubs_minutes IS NULL) from Wikidata: QID (players_meta / cached resolver)
    -> ONE wbgetentities (claims+labels) -> P54 clubs with P580/P582 years
    (national/youth teams dropped), P413 position, P166 prestige title -> one
    batched labels call for the referenced clubs/position/award -> PATCH
    cards.legend_career. Idempotent (legend_career IS NULL guard). Shares the
    --photos daily Wikidata budget; ~2 calls per legend."""
    photos_cfg = cfg.get("photos", {})
    pv = cfg["pageviews"]
    supa_url = require_env("SUPABASE_URL")
    supa_key = require_env("SUPABASE_KEY")

    cache = FileCache(
        os.path.join(BASE_DIR, cfg["cache"]["dir"]), cfg["cache"]["enabled"])
    budget = WikimediaBudget(
        photos_cfg.get("daily_request_budget", 5000),
        os.path.join(BASE_DIR, cfg["cache"]["dir"], "photos_budget.json"))
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    cards_client = CardsClient(supa_url, supa_key)

    def fetch_paged(endpoint, select, extra=None, page_size=1000):
        rows, offset = [], 0
        while True:
            params = {"select": select, "order": "id.asc",
                      "limit": page_size, "offset": offset}
            params.update(extra or {})
            resp = requests.get(endpoint, headers=cards_client.read_headers,
                                params=params, timeout=30)
            resp.raise_for_status()
            batch = resp.json()
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return rows

    print("Читаю легенд (player, clubs_minutes IS NULL, legend_career IS NULL)...",
          flush=True)
    try:
        cards = fetch_paged(cards_client.endpoint, "id,name,name_en",
                            {"category": "eq.player",
                             "clubs_minutes": "is.null",
                             "legend_career": "is.null"})
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 400:
            if not dry_run:
                raise SystemExit(
                    "cards.legend_career не существует — выполните "
                    "docs/cards_legend_career_column.sql.")
            # Pre-migration dry-run: estimate against all legends.
            print("  (колонки legend_career ещё нет — оценка по всем легендам)",
                  flush=True)
            cards = fetch_paged(cards_client.endpoint, "id,name,name_en",
                                {"category": "eq.player",
                                 "clubs_minutes": "is.null"})
        else:
            raise
    meta = fetch_paged(
        cards_client.endpoint.replace("/cards", "/players_meta"),
        "name_ru,name_en,wikidata_qid")

    qid_by_key = {}
    for m in meta:
        qid = (m.get("wikidata_qid") or "").strip()
        if not qid:
            continue
        for k in (canonical_key(m.get("name_ru")), canonical_key(m.get("name_en"))):
            if k:
                qid_by_key.setdefault(k, qid)

    def resolve_qid(card):
        qid = qid_by_key.get(canonical_key(card.get("name"))) \
            or qid_by_key.get(canonical_key(card.get("name_en")))
        if qid:
            return qid
        for title in cards_photos_candidates(card):
            info = cache.get("ruwiki_pageprops", title)
            if info and info.get("qid") and not info.get("disambig"):
                return info["qid"]
        return None

    print("=" * 60)
    print("FOOTBALL SCRAPER — CARDS LEGEND CAREER ({})".format(
        "DRY RUN, без записи" if dry_run else "LIVE, запись cards.legend_career"))
    print("=" * 60)
    print("Легенд к обработке: {}".format(len(cards)))
    print("Бюджет Wikidata   : {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("=" * 60, flush=True)

    with_clubs = with_title = with_pos = written = no_qid = empty = errors = 0
    n = len(cards)
    for idx, card in enumerate(cards, 1):
        try:
            qid = resolve_qid(card)
            if not qid:
                no_qid += 1
                continue
            if cache.get("wikidata_entity", "ru,en|" + qid) is None:
                budget.consume()
            entity = wikidata.entity_claims_labels(qid)
            refs = _referenced_qids(entity)
            uncached = [q for q in dict.fromkeys(refs)
                        if cache.get("wikidata_labels", q) is None]
            if uncached:
                budget.consume()  # one batched labels call
            labels = wikidata.labels_for_qids(refs)
            career = _legend_career_from_entity(entity, labels)
            if not career:
                empty += 1
                continue
            if not dry_run:
                cards_client.set_card_legend_career(card["id"], career)
            written += 1
            if career.get("clubs"):
                with_clubs += 1
            if career.get("titles"):
                with_title += 1
            if career.get("position"):
                with_pos += 1
        except RuntimeError:
            raise  # budget exhausted — stop politely, progress saved
        except Exception as exc:  # noqa: BLE001
            errors += 1
            print("[{}/{}] {} — ошибка: {}".format(idx, n, card.get("name"), exc),
                  flush=True)
            continue
        if idx % 100 == 0:
            print("[{}/{}] записано {}, бюджет {}/{}".format(
                idx, n, written, budget.used, budget.limit), flush=True)

    print("=" * 60)
    print("WRITE SUMMARY (cards.legend_career)")
    print("  записано легенд   : {}".format(written))
    print("    с клубами       : {}".format(with_clubs))
    print("    с позицией      : {}".format(with_pos))
    print("    с титулом       : {}".format(with_title))
    print("  без QID           : {}".format(no_qid))
    print("  пусто (нет клубов/титула): {}".format(empty))
    print("  errors            : {}".format(errors))
    print("  budget used       : {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("=" * 60)


def run_collect_history_cmd(cfg, args):
    """Wire the concrete clients and call scraper.history.run_collect_history.

    The daily cap comes from --history-budget (e.g. 7500 Pro / 75000 Ultra),
    falling back to the config rate_limit budget. A SEPARATE budget file
    (history_budget.json) keeps the paid mass-collection tally apart from the
    free-tier 100/day file. In --dry-run no API key is needed (no network)."""
    cache = FileCache(
        os.path.join(BASE_DIR, cfg["cache"]["dir"]), cfg["cache"]["enabled"])
    daily = args.history_budget or cfg["rate_limit"]["daily_request_budget"]
    budget = RequestBudget(
        daily, os.path.join(BASE_DIR, cfg["cache"]["dir"], "history_budget.json"))
    rate_limiter = RateLimiter(
        cfg["rate_limit"]["min_pause_seconds"], on_long_pause=_notify_pause)

    supa_url = require_env("SUPABASE_URL")
    supa_key = require_env("SUPABASE_KEY")
    seasons_client = PlayerSeasonsClient(supa_url, supa_key)

    client = None
    if not args.dry_run:
        api_key = require_env("FOOTBALL_API_KEY")
        client = ApiFootballClient(
            cfg["base_url"], api_key, cache, rate_limiter, cfg["retry"], budget)

    deps = {
        "client": client,
        "meta_client": seasons_client,
        "career_writer": seasons_client,
        "budget": budget,
    }
    run_collect_history(
        cfg, deps, dry_run=args.dry_run, refresh=args.refresh_history,
        limit=args.history_limit)


CARDS_PLAYER_CATEGORY_RU = "игроки"  # category_ru used by existing player cards
CARDS_DEFAULT_DIFFICULTY = "medium"  # existing player cards are all 'medium'


def fuzzy_key_in(key, existing_keys, ratio=DEFAULT_RATIO):
    """True when `key` is ALMOST equal to one of existing_keys (difflib
    ratio >= `ratio`). Used by --to-cards ONLY for single-word card names
    ("Роналдо"): an alternative spelling of the same mononym ("Роналду")
    must count as a duplicate of the existing card — its pageviews likely
    belong to the famous namesake anyway. Multi-word near-matches stay with
    --find-dups for a human decision."""
    return any(
        SequenceMatcher(None, key, k).ratio() >= ratio
        for k in existing_keys
    )


def print_to_cards_plan(totals, sample, dry_run):
    """Summary for the players_meta -> cards transfer: how many recognisable
    players exist, how many are already in the deck (dups), and how many new
    cards would be added (with / without a pageviews score)."""
    print("=" * 60)
    print("FOOTBALL SCRAPER — TO-CARDS PLAN (players_meta -> cards)")
    print("=" * 60)
    print("Mode             : {}".format(
        "DRY RUN (no write)" if dry_run else "LIVE (insert into cards)"))
    print("Pageviews join   : ALL seasons x ALL leagues (player -> max)")
    threshold = totals["min_pageviews"]
    print("Min pageviews    : {}".format(
        "{} (player needs > {} views)".format(threshold, threshold)
        if threshold else "0 (no threshold — take everyone)"))
    print("players_meta     : {}".format(totals["players"]))
    print("  recognisable   : {} (have name_ru)".format(totals["recognisable"]))
    print("  no name_ru     : {} (skipped — not recognisable)".format(
        totals["no_ru"]))
    print("Existing cards   : {} (whole deck, used for dedup)".format(
        totals["existing_cards"]))
    print("-" * 60)
    print("NEW players to add: {}".format(totals["new"]))
    print("  with pageviews : {}".format(totals["new_with_pv"]))
    print("  no pageviews   : {} (NULL — always passes the difficulty filter)".format(
        totals["new"] - totals["new_with_pv"]))
    print("Skipped as dups  : {}".format(totals["dups"]))
    print("  already in deck: {}".format(totals["dup_existing"]))
    print("    fuzzy mononym: {} (однословное имя ~ существующая "
          "карточка)".format(totals["dup_fuzzy"]))
    print("  repeated name  : {} (same name_ru twice in players_meta)".format(
        totals["dup_intra"]))
    print("Filtered by thresh: {} (new players with pageviews <= {} or no data)".format(
        totals["filtered_threshold"], threshold))
    print("-" * 60)
    for r in sample:
        pv = r["pageviews"]
        print("  + {:<28} en={:<24} pv={}".format(
            (r["name"] or "")[:28],
            (r["name_en"] or "—")[:24],
            pv if pv is not None else "—"))
    if totals["new"] > len(sample):
        print("  ... and {} more".format(totals["new"] - len(sample)))
    print("=" * 60)


def run_to_cards(cfg, dry_run, min_pageviews=0):
    """Transfer recognisable players (name_ru) from players_meta into the game
    deck (cards) as category 'player', attaching the player's name_en (for the
    EN language toggle; needs cards.name_en — see
    supabase/migrations/cards_name_en.sql) and his pageviews — joined across
    ALL seasons and ALL leagues, the player keeps his MAX value, so leagues
    scraped for different seasons (top-5 at 2023, RPL at 2024) mix safely —
    and generating forbidden_words like the rest of the deck. Players
    already in cards (dedup by name) are left untouched; existing cards are
    never modified. Idempotent: a re-run adds nothing new.

    min_pageviews (> 0) drops players who don't clear the threshold — including
    those with no pageviews row — since a player below the Hard floor (3000)
    would never be drawn in-game anyway. min_pageviews = 0 takes everyone.
    """
    threshold = int(min_pageviews or 0)

    # Reads players_meta, player_seasons and cards — needs creds in both modes.
    supa_url = require_env("SUPABASE_URL")
    supa_key = require_env("SUPABASE_KEY")

    seasons_client = PlayerSeasonsClient(supa_url, supa_key)
    cards_client = CardsClient(supa_url, supa_key)

    print("Читаю players_meta, pageviews (все сезоны, все лиги, максимум) и "
          "cards...", flush=True)
    # photo_url рядом с name_en: новый card получает фото игрока сразу. До
    # миграции photo_url колонок нет — компат-обёртка тихо работает без них.
    players, has_photo = _fetch_players_meta_compat(seasons_client)
    recognisable = [p for p in players if _has_ru_article(p)]
    # All-seasons join: a player listed in several leagues/seasons contributes
    # his HIGHEST pageviews value (fetch_pageviews_max collapses the rows), so
    # 2023 top-5 rows and 2024 RPL rows are joined in one run.
    pageviews_by_player = seasons_client.fetch_pageviews_max()
    # Dedup keys come from canonical_key (fuzzy: word order + Latin->Cyrillic +
    # punctuation folded), NOT a plain string compare, so a player already in
    # the deck under a different spelling/order is recognised as the same card
    # and not duplicated when a new league is imported.
    existing_names = cards_client.fetch_existing_card_keys()

    new_rows = []
    seen_new = set()         # dedup within this batch (same player twice in meta)
    dup_existing = 0         # already present in the deck
    dup_fuzzy = 0            # ... of which: mononym close to an existing key
    dup_intra = 0            # duplicate player inside players_meta itself
    filtered_threshold = 0   # new players dropped for not clearing min_pageviews

    for p in recognisable:
        # Insert-time normalization: name_ru arrives as "Фамилия, Имя
        # [Отчество]" (with optional "(футболист...)") — flip/strip it to the
        # deck's manual format (patronymic dropped) BEFORE deduping, so the
        # canonical_key sees the clean name and a normalized newcomer
        # collapses onto his existing card.
        name = normalize_display_name((p.get("name_ru") or "").strip())
        key = canonical_key(name)
        if not key:
            continue
        if key in existing_names:
            dup_existing += 1
            continue
        # Mononyms dedup FUZZY against the deck: "Роналдо" (RPL Brazilian)
        # vs the deck's legend card — same key family, different spelling —
        # must NOT become a second card (his joined pageviews likely belong
        # to the famous namesake's article anyway).
        if " " not in name and fuzzy_key_in(key, existing_names):
            dup_existing += 1
            dup_fuzzy += 1
            continue
        if key in seen_new:
            dup_intra += 1
            continue
        seen_new.add(key)
        pv = pageviews_by_player.get(p["id"])
        # Threshold gate: strictly greater, mirroring pick_random_cards. With a
        # threshold set, missing pageviews (None) does NOT pass.
        if threshold > 0 and not (pv is not None and pv > threshold):
            filtered_threshold += 1
            continue
        row = {
            "name": name,
            # English name from players_meta — for the future EN language
            # toggle in the game. Needs cards.name_en (see migration
            # supabase/migrations/cards_name_en.sql). NULL when meta has
            # none. The patronymic is dropped here too ("Artem Sergeyevich
            # Dzyuba" -> "Artem Dzyuba"), mirroring the Russian name.
            "name_en": strip_patronymic(
                (p.get("name_en") or "").strip()) or None,
            "category": "player",
            "category_ru": CARDS_PLAYER_CATEGORY_RU,
            "difficulty": CARDS_DEFAULT_DIFFICULTY,
            "forbidden_words": build_forbidden_words(name),
            "pageviews": pv,
            "active": True,
        }
        # Photo travels with the player. The key is added only when the
        # photo_url migration is applied (cards.photo_url must exist too,
        # otherwise the insert would 400 with PGRST204).
        if has_photo:
            row["photo_url"] = (p.get("photo_url") or "").strip() or None
        new_rows.append(row)

    # Highest-pageviews first so the printed sample shows the marquee names.
    new_rows.sort(key=lambda r: (r["pageviews"] is not None, r["pageviews"] or 0),
                  reverse=True)

    new_with_pv = sum(1 for r in new_rows if r["pageviews"] is not None)
    totals = {
        "players": len(players),
        "recognisable": len(recognisable),
        "no_ru": len(players) - len(recognisable),
        "existing_cards": len(existing_names),
        "new": len(new_rows),
        "new_with_pv": new_with_pv,
        "dups": dup_existing + dup_intra,
        "dup_existing": dup_existing,
        "dup_fuzzy": dup_fuzzy,
        "dup_intra": dup_intra,
        "filtered_threshold": filtered_threshold,
        "min_pageviews": threshold,
    }

    print_to_cards_plan(totals, new_rows[:20], dry_run)

    if dry_run:
        print("DRY RUN — nothing written to cards.")
        return

    written = cards_client.insert_cards(new_rows)
    print("WRITE SUMMARY (cards)")
    print("  new cards added : {}".format(len(written)))
    print("  skipped (dups)  : {}".format(totals["dups"]))
    print("  existing cards  : untouched")
    print("=" * 60)


def run_find_dups(cfg, ratio=DEFAULT_RATIO):
    """Find PROBABLE duplicate cards caused by different spellings and print
    them for manual review. READ-ONLY — never writes or deletes anything.

    The deck mixes hand-typed Russian (old cards) with auto-translated names
    (new cards), so the same person can appear twice under near-but-not-equal
    spellings that a plain SQL GROUP BY misses. Each name is reduced to a
    canonical key (normalized + Latin folded to Cyrillic, see scraper/dedup.py)
    and every pair whose keys are >= `ratio` similar (difflib) is reported with
    both card ids. The user decides which, if any, to delete.
    """
    supa_url = require_env("SUPABASE_URL")
    supa_key = require_env("SUPABASE_KEY")
    cards_client = CardsClient(supa_url, supa_key)

    print("Читаю cards из Supabase (только чтение, ничего не меняю)...",
          flush=True)
    cards = cards_client.fetch_cards_for_dedup()

    print("=" * 60)
    print("FOOTBALL SCRAPER — FIND DUPLICATES (read-only)")
    print("=" * 60)
    print("Карточек в колоде: {}".format(len(cards)))
    print("Порог похожести  : {} (difflib ratio; имена нормализуются и "
          "латиница->кириллица)".format(ratio))
    print("Запись в базу     : НЕТ (только список подозрительных пар)")
    print("=" * 60, flush=True)

    pairs = find_duplicate_pairs(cards, ratio)

    if not pairs:
        print("Подозрительных пар не найдено (при пороге {}).".format(ratio))
        print("=" * 60)
        return

    print("Найдено вероятных дублей: {} пар(ы)".format(len(pairs)))
    print("-" * 60)
    for idx, (a, b, score) in enumerate(pairs, 1):
        print("[{}] похожесть {:.2f}".format(idx, score))
        print("    A  {}  «{}»  [{}]".format(
            a.get("id"), a.get("name"), a.get("category") or "?"))
        print("    B  {}  «{}»  [{}]".format(
            b.get("id"), b.get("name"), b.get("category") or "?"))
        # When the canonical keys are identical the only difference is spacing,
        # punctuation or alphabet — almost certainly the same card.
        if canonical_key(a.get("name")) == canonical_key(b.get("name")):
            print("    ^ ключи совпадают полностью — почти наверняка дубль")
        print("-" * 60)
    print("Ничего не удалено. Решите вручную, какие id убрать.")
    print("=" * 60)


def main():
    # Load football_scraper/.env into os.environ BEFORE require_env() reads it,
    # so keys don't have to be exported every run. Real env vars still win
    # (override=False is the default), and a missing .env is silently ignored.
    load_dotenv(os.path.join(BASE_DIR, ".env"))

    parser = argparse.ArgumentParser(description="Football scraper — pilot run")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and enrich, print the plan, but DO NOT write to Supabase.",
    )
    parser.add_argument(
        "--pageviews",
        action="store_true",
        help="Collect Wikipedia pageviews per season into player_seasons "
        "(Wikimedia API; does not touch the API-Football budget).",
    )
    parser.add_argument(
        "--to-cards",
        dest="to_cards",
        action="store_true",
        help="Transfer recognisable players (name_ru) from players_meta into "
        "the game deck (cards) as 'player' cards, with the player's MAX "
        "pageviews across all seasons and leagues. Dedups by name (never "
        "duplicates existing cards) "
        "and touches no external API. Use --dry-run first to preview counts.",
    )
    parser.add_argument(
        "--cards-pageviews",
        dest="cards_pageviews",
        action="store_true",
        help="Backfill cards.pageviews for cards with NULL (any category): "
        "assume the ruwiki article is titled exactly like the card, sum its "
        "views over the season window via the Wikimedia per-article API, "
        "PATCH cards.pageviews. Misses try category variants "
        "('(футболист)', '(футбольный клуб)'); still missing falls back to "
        "the ENGLISH article by cards.name_en, its views multiplied by 0.1 "
        "(en audience ~10x the ru one) and rounded; no name_en stays NULL. "
        "Same cache/budget/1s-pause as --pageviews, idempotent. "
        "Use --dry-run first.",
    )
    parser.add_argument(
        "--photos",
        action="store_true",
        help="Collect player photos: Wikidata P18 -> Wikimedia Commons "
        "Special:FilePath URL (?width=256) into players_meta.photo_url. "
        "Key-less, cached per QID (negative results too), 1s polite pause, "
        "daily budget — does not touch the API-Football budget. Players "
        "without a qid or P18 keep photo_url NULL. Requires "
        "supabase/migrations/photo_url.sql. Use --dry-run first.",
    )
    parser.add_argument(
        "--cards-photos",
        dest="cards_photos",
        action="store_true",
        help="Collect photos for cards with photo_url IS NULL (clubs, "
        "stadiums, referees, coaches, commentators, women and old manual "
        "player cards; term/position are skipped): "
        "find the ruwiki article by the card name (clubs try "
        "'(футбольный клуб)' first, players the exact name then "
        "'(футболист)'; no ruwiki article -> enwiki by cards.name_en when "
        "present), take its wikibase_item QID via "
        "prop=pageprops, then Wikidata P154 logo (clubs, P18 fallback) or "
        "P18 image -> Commons Special:FilePath (?width=256) -> PATCH "
        "cards.photo_url. Key-less, cached (negative results too), 1s "
        "pauses, same daily budget file as --photos. No article/image -> "
        "stays NULL. Requires supabase/migrations/photo_url.sql. "
        "Use --dry-run first.",
    )
    parser.add_argument(
        "--cards-name-en",
        dest="cards_name_en",
        action="store_true",
        help="Backfill cards.name_en for all categories except club_nickname "
        "(no derivable EN nickname) where it is NULL: "
        "find the ruwiki article by the card name (same title variants as "
        "--cards-photos; stadiums carry the P31 venue guard), take the "
        "wikibase_item QID via prop=pageprops (disambigs skipped), then the "
        "Wikidata enwiki sitelink title (trailing '(...)' stripped) -> PATCH "
        "cards.name_en. No sitelink -> the entity's English label "
        "(labels.en); no label or no article at all -> BGN-style "
        "transliteration of the Russian name ('Наиль Умяров' -> "
        "'Nail Umyarov') for PEOPLE only — non-people keep NULL (frontend "
        "shows Russian). Cache-first: after --cards-photos the titles/QIDs "
        "are already cached; new calls are sitelinks and labels.en per QID. "
        "Idempotent, same daily budget file as --photos. "
        "Use --dry-run first.",
    )
    parser.add_argument(
        "--cards-translations",
        dest="cards_translations",
        action="store_true",
        help="Backfill card_translations (one display name per card and "
        "language from --langs): QID via players_meta / the cached ruwiki "
        "resolver (stadium P31 guard included) -> ONE wbgetentities per QID "
        "with sitelinks+labels for every requested language -> sitelink "
        "title (parenthetical stripped) -> label -> for es/pt/fr PEOPLE "
        "cards a copy of name_en; otherwise no row (frontend falls back to "
        "name_en/name). UPSERT on (card_id, lang), idempotent, same daily "
        "budget file as --photos. Requires docs/card_translations.sql. "
        "Use --dry-run first.",
    )
    parser.add_argument(
        "--cards-country",
        dest="cards_country",
        action="store_true",
        help="Fill cards.continent AND cards.country (ISO code, for the flag) "
        "for player cards: nationality from the LOCAL API-Football cache (no "
        "API budget) matched via players_meta; legends fall back to Wikidata "
        "P27 (country of citizenship) of the QID from players_meta / the "
        "cached resolver. Nationality -> continent (confederation overrides: "
        "ex-Soviet UEFA -> Europe, Central-Asian & Australia AFC -> Asia; "
        "Oceania has no bucket -> NULL) and -> ISO alpha-2 (Oceania included; "
        "England/Scotland/Wales as GB-ENG/SCT/WLS). PATCH guarded by IS NULL, "
        "idempotent. Needs continents_filter.sql + docs/cards_country_column.sql.",
    )
    parser.add_argument(
        "--cards-legend-career",
        dest="cards_legend_career",
        action="store_true",
        help="Collect cards.legend_career (JSONB) for LEGENDS (player cards "
        "with clubs_minutes IS NULL) from Wikidata: P54 clubs + P580/P582 "
        "years (national/youth teams dropped), P413 position, P166 prestige "
        "title. QID from players_meta / the cached resolver; ~2 Wikidata "
        "calls per legend on the shared --photos budget. Idempotent. "
        "Requires docs/cards_legend_career_column.sql. Use --dry-run first.",
    )
    parser.add_argument(
        "--collect-history",
        dest="collect_history",
        action="store_true",
        help="PAID-tier mass career collection: per player (players_meta) pull "
        "/players/teams (seasons), /players?id&season per season "
        "(player_career), /transfers and /trophies (players_meta). Idempotent "
        "and resumable (skips players already stamped). Sized for Pro/Ultra — "
        "NOT the free tier. Requires docs/player_history_schema.sql. Always "
        "--dry-run first to see the request estimate.",
    )
    parser.add_argument(
        "--refresh-history", dest="refresh_history", action="store_true",
        help="(--collect-history) re-collect players already stamped.")
    parser.add_argument(
        "--history-budget", dest="history_budget", type=int, default=None,
        help="(--collect-history) daily request cap for the paid plan "
        "(e.g. 7500 Pro, 75000 Ultra). Overrides config rate_limit budget.")
    parser.add_argument(
        "--history-limit", dest="history_limit", type=int, default=None,
        help="(--collect-history) process at most N players (smoke test).")
    parser.add_argument(
        "--cards-position",
        dest="cards_position",
        action="store_true",
        help="Fill cards.position_ru (Вратарь/Защитник/Полузащитник/"
        "Нападающий) for player cards: most-common games.position from the "
        "LOCAL API-Football cache (no API budget), Wikidata P413 fallback "
        "for legends. PATCH guarded by IS NULL, idempotent. Requires "
        "docs/cards_position_column.sql.",
    )
    parser.add_argument(
        "--langs",
        dest="langs",
        default=CARDS_TRANSLATIONS_DEFAULT_LANGS,
        help="(--cards-translations only) comma-separated language codes, "
        "default: " + CARDS_TRANSLATIONS_DEFAULT_LANGS,
    )
    parser.add_argument(
        "--redo-translit",
        dest="redo_translit",
        action="store_true",
        help="(--cards-name-en only) REWRITE suspect name_en values: walk "
        "people cards whose name_en is already set, re-resolve the ruwiki "
        "article (incl. the list=search fallback) and overwrite name_en "
        "with the fresh enwiki sitelink / Wikidata label when one is found "
        "('Ris Dzheyms' -> 'Reece James'). No article found -> the card "
        "keeps its current name_en; the transliterator is never applied in "
        "this mode. Use --dry-run first.",
    )
    parser.add_argument(
        "--find-dups",
        dest="find_dups",
        action="store_true",
        help="Find PROBABLE duplicate cards caused by different spellings "
        "(old manual Russian vs new auto-translated). READ-ONLY: prints "
        "suspicious 'card A <-> card B' pairs with their ids for manual "
        "review and writes/deletes NOTHING. Names are matched fuzzily "
        "(normalized + Latin->Cyrillic + difflib similarity).",
    )
    parser.add_argument(
        "--dup-ratio",
        dest="dup_ratio",
        type=float,
        default=DEFAULT_RATIO,
        help="(--find-dups only) Similarity threshold in [0,1] for flagging a "
        "pair. Default {}. Lower it (e.g. 0.80) to catch more, raise it for "
        "fewer/safer matches.".format(DEFAULT_RATIO),
    )
    parser.add_argument(
        "--min-pageviews",
        dest="min_pageviews",
        type=int,
        default=3000,
        help="(--to-cards only) Only transfer players with MORE than this many "
        "pageviews for the season. Default 3000 (the Hard difficulty floor — "
        "players below it are never drawn in-game). Players with no pageviews "
        "row are dropped too. Pass --min-pageviews 0 to take everyone.",
    )
    parser.add_argument(
        "--config", default=os.path.join(BASE_DIR, "config.json")
    )
    parser.add_argument(
        "--all",
        dest="process_all",
        action="store_true",
        help="(--pageviews only) Collect pageviews for EVERY player in "
        "players_meta. By default only players with a non-empty name_ru "
        "(a Russian article) are queried — the rest have ~0 views.",
    )
    parser.add_argument(
        "--season",
        type=int,
        default=None,
        help="Override the season from config.json for THIS run only "
        "(e.g. --season 2022). Does not edit config.json or create a new "
        "config file.",
    )
    parser.add_argument(
        "--league",
        default=None,
        help="Override league_id from config.json for THIS run only. Accepts "
        "a code (PL/PD/SA/BL1/FL1/RPL) or a numeric API-Football id (e.g. "
        "--league SA or --league 135). The readable code is what gets written "
        "to player_seasons.league. Does not edit config.json.",
    )
    args = parser.parse_args()

    cfg = load_config(args.config)

    # --season overrides the config season in memory only (no file is touched).
    # It also collapses the pageviews step to that single season, so
    # `--pageviews --season 2022` collects exactly 2022.
    if args.season is not None:
        cfg["season"] = args.season
        if isinstance(cfg.get("pageviews"), dict):
            cfg["pageviews"]["seasons"] = [args.season]

    # --league overrides league_id in memory only, and keeps the readable code
    # written to player_seasons.league in sync. Works alongside --season:
    # `--league SA --season 2023`. Without the flag we still derive the code
    # from the configured league_id (when it's a known league) so the two never
    # drift apart; an unknown id keeps whatever pageviews.league config holds.
    if args.league is not None:
        cfg["league_id"], league_code = resolve_league(args.league)
        if isinstance(cfg.get("pageviews"), dict):
            cfg["pageviews"]["league"] = league_code
    elif cfg.get("league_id") in LEAGUE_ID_TO_CODE and isinstance(
        cfg.get("pageviews"), dict
    ):
        cfg["pageviews"]["league"] = LEAGUE_ID_TO_CODE[cfg["league_id"]]

    if args.redo_translit and not args.cards_name_en:
        raise SystemExit("--redo-translit работает только вместе с "
                         "--cards-name-en.")

    if args.find_dups:
        run_find_dups(cfg, args.dup_ratio)
        return

    if args.photos:
        run_photos(cfg, args.dry_run)
        return

    if args.cards_photos:
        run_cards_photos(cfg, args.dry_run)
        return

    if args.cards_name_en:
        run_cards_name_en(cfg, args.dry_run, args.redo_translit)
        return

    if args.cards_translations:
        run_cards_translations(cfg, args.dry_run, args.langs)
        return

    if args.cards_country:
        run_cards_country(cfg, args.dry_run)
        return

    if args.cards_position:
        run_cards_position(cfg, args.dry_run)
        return

    if args.cards_legend_career:
        run_cards_legend_career(cfg, args.dry_run)
        return

    if args.collect_history:
        run_collect_history_cmd(cfg, args)
        return

    if args.cards_pageviews:
        run_cards_pageviews(cfg, args.dry_run)
        return

    if args.to_cards:
        run_to_cards(cfg, args.dry_run, args.min_pageviews)
        return

    if args.pageviews:
        run_pageviews(cfg, args.dry_run, args.process_all)
        return

    # Fail fast on missing credentials BEFORE spending any API quota.
    api_key = require_env("FOOTBALL_API_KEY")
    if not args.dry_run:
        supa_url = require_env("SUPABASE_URL")
        supa_key = require_env("SUPABASE_KEY")

    pipeline, _api, budget = build_pipeline(cfg, api_key)

    print("Запрашиваю список команд лиги {} (сезон {})...".format(
        cfg["league_id"], cfg["season"]), flush=True)
    # Explicit per-league club list (config teams_filter) wins over
    # pilot_limit_teams; an empty list means the whole league as before.
    wanted = teams_filter_for(cfg)
    teams, missing = pipeline.collect_teams(wanted or None)

    # A configured club that API-Football spells differently (no match): warn
    # and keep going with the rest — never abort the whole run for one club.
    code = get_league_code(cfg) or cfg.get("league_id")
    for name in missing:
        print("[warn] клуб '{}' не найден в лиге {}, пропущен".format(name, code))

    # Header up front: now we know the team count, the user sees the plan and
    # that the inter-team pauses are intentional, not a hang.
    print_run_header(cfg, teams, budget, args.dry_run, wanted=wanted,
                     missing=missing)

    writer = None
    if not args.dry_run:
        writer = SupabaseWriter(supa_url, supa_key)

    # Collect, enrich and write ONE team at a time so an interrupted crawl
    # keeps every team already saved (incremental UPSERT), instead of losing
    # the whole run on a single failure at the end.
    all_rows = []
    teams_written = 0
    players_written = 0
    errors = []

    total_teams = len(teams)
    for idx, team in enumerate(teams, 1):
        team_name = team.get("name", "?")
        # Print BEFORE the work so the user sees which team is in flight while
        # the rate-limit pauses happen.
        print("[{}/{}] Обрабатываю: {}...".format(idx, total_teams, team_name),
              flush=True)
        try:
            players = pipeline.collect_players([team])
            rows = pipeline.build_rows(players)
        except Exception as exc:  # noqa: BLE001 — keep prior teams, decide below
            errors.append((team_name, str(exc)))
            if budget.used >= budget.limit:
                # Daily budget gone: every further call would fail anyway, so
                # stop. Teams written so far are already persisted.
                print("[stop] {}: budget exhausted — {}".format(team_name, exc))
                break
            print("[error] {}: collect/enrich failed — {}".format(team_name, exc))
            continue

        all_rows.extend(rows)

        if args.dry_run:
            print("[{}/{}] {} — собрано {} игроков, бюджет {}/{}".format(
                idx, total_teams, team_name, len(rows),
                budget.used, budget.limit), flush=True)
            continue

        try:
            written = writer.upsert(to_db_rows(rows))
            teams_written += 1
            players_written += len(written)
            print("[{}/{}] {} — собрано {} игроков, записано {}, бюджет {}/{}".format(
                idx, total_teams, team_name, len(rows), len(written),
                budget.used, budget.limit), flush=True)
        except Exception as exc:  # noqa: BLE001 — log and keep crawling
            print("[error] {}: write failed — {}".format(team_name, exc))
            errors.append((team_name, str(exc)))
            continue

    print_plan(cfg, teams, all_rows, budget, args.dry_run)

    if args.dry_run:
        print("DRY RUN — nothing written to Supabase (players_meta untouched).")
        return

    print("WRITE SUMMARY")
    print("  teams written  : {} / {}".format(teams_written, len(teams)))
    print("  players written: {}".format(players_written))
    print("  names preserved: {} (kept existing name; guard blocked a worse "
          "one)".format(writer.names_preserved))
    print("  qids dropped   : {} (wikidata_qid taken by another player — "
          "likely the same human under two API ids; see [dedup]/[409] "
          "lines)".format(writer.qids_dropped))
    if errors:
        print("  errors         : {}".format(len(errors)))
        for name, msg in errors:
            print("    - {}: {}".format(name, msg))
    else:
        print("  errors         : none")
    print("=" * 60)


if __name__ == "__main__":
    main()
