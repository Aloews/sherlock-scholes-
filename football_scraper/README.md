# football_scraper — pilot

Builds the `players_meta` players database from **API-Football**, enriching
each player with a Russian name from **Wikidata**. This is the *pilot*
configuration: **one league, one season, one team**, sized to stay inside the
free tier (100 requests/day, 10/min).

It only writes to `players_meta`. It does **not** touch `cards`, the game
logic, the Mini App in `src/`, or the `player_seasons` table.

## What it does

1. `/teams?league=39&season=2023` → take the first `pilot_limit_teams` (1).
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

### Built-in safety (do not weaken)
- Min pause between API-Football calls (`min_pause_seconds`, ~10/min).
- Hard daily request budget (`daily_request_budget = 100`).
- Exponential-backoff retry on 429 / 5xx / network errors.
- On-disk cache: a `--dry-run` then a real run reuse cached responses, so the
  daily budget is **not** spent twice. Wikidata calls use a contact
  User-Agent and a ≥1s pause, and QIDs / ruwiki titles are cached per name.

> The pilot is configured in `config.json`: `league_id`, `season`,
> `pilot_limit_teams`. Pilot squad ≈ 25–30 players → only ~3 API-Football
> requests total.

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
