# football_scraper

Builds the `players_meta` players database from **API-Football**, enriching
each player with a Russian name from **Wikidata**. Default configuration:
**one league, one season, ALL teams** (`pilot_limit_teams: 0`). The pilot was
one team; set `pilot_limit_teams` to a positive number to cap teams again. A
full Premier League season (~20 teams) stays inside the free tier
(100 requests/day, 10/min) at ~61 worst-case requests.

The default run writes only to `players_meta`. A second mode (`--pageviews`)
fills `player_seasons.pageviews` from Wikipedia. Neither touches `cards`, the
game logic, or the Mini App in `src/`.

## What it does

1. `/teams?league=39&season=2023` → all teams (or the first `pilot_limit_teams`
   when that value is a positive number; `0`/null/absent = whole league).
2. `/players?team=<id>&season=2023` (paginated) → squad players.
   For each: `api_football_id = player.id`, `name_en = player.name`,
   minutes = `statistics[0].games.minutes` (kept for a future `minutes_share`).
3. Wikidata per player: search by English name → keep the first candidate
   whose occupation `P106 == Q937857` (footballer) → `sitelinks.ruwiki.title`
   becomes `name_ru`.
   - footballer **with** a Russian article → `name_source=wikidata`,
     `name_confidence=high`.
   - no Russian article / no footballer match → `name_ru=null`,
     `name_source=none`, `name_confidence=low` (no transliteration at pilot
     stage — just flagged).
4. UPSERT into `players_meta` on `api_football_id`
   (`ON CONFLICT api_football_id`). `wikidata_qid` is stored when found.
   - **Name-quality guard:** before writing, existing rows are fetched (one
     batched GET) and the name group (`name_ru`, `name_source`,
     `name_confidence`, `wikidata_qid`) is merged in code. The incoming name is
     taken **only** when its `name_ru` is non-empty **and** its confidence rank
     (`high > low > none`) is `>=` the stored one — so re-running for a later
     season can never overwrite a good Russian name (e.g. `high`) with a
     worse/empty one (`null`/`low`). The write summary reports how many names
     were preserved this way.

### Built-in safety (do not weaken)
- Min pause between API-Football calls (`min_pause_seconds`, ~10/min).
- Hard daily request budget (`daily_request_budget = 100`).
- Exponential-backoff retry on 429 / 5xx / network errors.
- On-disk cache: a `--dry-run` then a real run reuse cached responses, so the
  daily budget is **not** spent twice. Wikidata calls use a contact
  User-Agent and a ≥1s pause, and QIDs / ruwiki titles are cached per name.

> Configured in `config.json`: `league_id`, `season`, `pilot_limit_teams`
> (0 = whole league). A full league ≈ 20 teams × up to `max_page` (3) pages
> + 1 `/teams` call ≈ 61 worst-case API-Football requests; the dry-run plan
> prints this estimate and warns if it approaches the 100/day budget.
> Re-running is safe: responses are cached and rows UPSERT on
> `api_football_id`, so already-collected players (e.g. the pilot's Man Utd
> squad) are deduplicated, not duplicated.

## Setup

```bash
cd football_scraper
python3 -m venv .venv && . .venv/bin/activate     # optional
pip install -r requirements.txt
```

### Environment variables (keys never live in code)

| Variable           | Needed for      | Purpose                          |
|--------------------|-----------------|----------------------------------|
| `FOOTBALL_API_KEY` | dry-run + live  | API-Football (`x-apisports-key`) |
| `SUPABASE_URL`     | live run only   | Supabase project URL             |
| `SUPABASE_KEY`     | live run only   | Supabase service/anon key        |

PowerShell (Windows):
```powershell
$env:FOOTBALL_API_KEY = "your_api_football_key"
$env:SUPABASE_URL     = "https://YOUR-PROJECT.supabase.co"
$env:SUPABASE_KEY     = "your_supabase_key"
```

bash / zsh:
```bash
export FOOTBALL_API_KEY="your_api_football_key"
export SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
export SUPABASE_KEY="your_supabase_key"
```

## Run

```bash
# 1) Dry run — shows the plan (players, requests, name_ru hits). Writes nothing.
python3 run.py --dry-run

# 2) Live run — same fetch (served from cache), then UPSERT into players_meta.
python3 run.py
```

## Pageviews step (Wikipedia popularity, per season)

Fills `player_seasons.pageviews`: for every player in `players_meta`, the total
monthly Wikipedia pageviews of their article over each season's window. It is
the raw signal for a later popularity rating and its season-to-season dynamics.

- **Source:** Wikimedia Pageviews API — **free, no API key, and completely
  separate** from API-Football. It does **not** spend the 100/day football
  budget. (Pageviews data exists from 2015-07-01 onward; earlier windows are
  clamped to that date.)
- **Article resolution** (Russian first): `name_ru` → the `wikidata_qid`
  ruwiki/enwiki sitelink (one cached Wikidata call) → `name_en` on en.wikipedia.
- **Season window:** season *N* = *N*-08-01 … (*N*+1)-06-30 (configurable under
  `pageviews.window`). Views are summed across the monthly data points in range.
- **Write:** UPSERT into `player_seasons` on `(player_id, league, season)`,
  setting **only** `pageviews`. `popularity_score` / `popularity_rank` are left
  for a separate later step. `league` is a text label (`pageviews.league`,
  default `PL`) for the league the players were collected for.
- **Politeness (do not weaken):** contact User-Agent, ≥1s pause, backoff retry
  honouring `Retry-After`, an on-disk cache per (article, window) so re-runs
  don't re-fetch, and a per-UTC-day Wikimedia request counter
  (`pageviews.daily_request_budget`). A 404 → 0 views, flagged, never crashes.

```bash
# Plan only: how many players, how many Wikimedia requests, which seasons.
python3 run.py --pageviews --dry-run

# Live: fetch pageviews, UPSERT player_seasons.pageviews.
python3 run.py --pageviews
```

> The `--pageviews` step **reads** `players_meta` from Supabase, so it needs
> `SUPABASE_URL` / `SUPABASE_KEY` in **both** dry-run and live (unlike the
> players step, whose dry-run needs no Supabase). Configure seasons, league
> label and the window in `config.json` under `pageviews`.

Offline test for the response parsing / helpers (no network):

```bash
python3 tests/test_pageviews.py
```
