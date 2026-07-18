"""--collect-history: mass career-history collection for the PAID API-Football
tier. NOT for the free tier — the request volume (tens of thousands) is sized
for Pro/Ultra. Nothing here runs until the runner calls run_collect_history.

Per player (keyed by players_meta.api_football_id):
  1. /players/teams?player=ID   -> the teams+seasons the player actually has,
                                   so we only spend a request on seasons that
                                   exist (skips empty (player, season) pairs).
  2. /players?id=ID&season=Y    -> per-season statistics for each season in the
                                   target window that /players/teams reported:
                                   minutes/apps/goals/assists per club+league,
                                   one player_career row each.
  3. /transfers?player=ID       -> career club list with dates (players_meta.transfers).
  4. /trophies?player=ID        -> trophies (players_meta.trophies).
Then players_meta.history_collected_at is stamped — the resume marker.

Idempotency & resume:
  * players already stamped are skipped (unless refresh=True);
  * each player is fully written and stamped BEFORE moving on, so an abort
    (budget exhausted, crash) loses at most the in-flight player;
  * player_career upserts on its PK, so a re-run overwrites cleanly.

Budget: the shared RequestBudget hard-stops at the daily cap. On a PAID plan
the quota simply stops returning data (no overage billing) — we treat the
budget RuntimeError as a clean stop and exit with progress saved.
"""

DEFAULT_HISTORY_SEASONS = list(range(2015, 2025))  # 2015..2024 inclusive


def is_friendly_league(league_name):
    """True for friendly competitions ('Friendlies Clubs', 'Club Friendlies',
    'Friendlies', ...). Their minutes are pre-season noise and must NOT count
    toward career minutes — only real leagues and cups do."""
    return "friendl" in (league_name or "").lower()


def _stat_rows(api_id, players_payload):
    """player_career rows from a /players?id&season payload (one season).
    Friendly competitions are skipped (see is_friendly_league)."""
    rows = []
    for entry in players_payload.get("response") or []:
        for st in entry.get("statistics") or []:
            team = st.get("team") or {}
            league = st.get("league") or {}
            games = st.get("games") or {}
            goals = st.get("goals") or {}
            if not team.get("id") or not league.get("season"):
                continue
            if is_friendly_league(league.get("name")):
                continue
            rows.append({
                "api_football_id": api_id,
                "season": int(league["season"]),
                "league": league.get("name"),
                "league_id": league.get("id"),
                "club": team.get("name"),
                "club_id": team.get("id"),
                "minutes": games.get("minutes") or 0,
                "appearances": games.get("appearences") or 0,
                "goals": goals.get("total") or 0,
                "assists": goals.get("assists") or 0,
                "position": games.get("position"),
            })
    return rows


def _seasons_for_player(client, api_id, window):
    """Seasons (within `window`) the player actually has, via /players/teams.
    Falls back to the full window if the endpoint gives nothing."""
    data = client.get("players/teams", {"player": api_id})
    seasons = set()
    for entry in data.get("response") or []:
        for s in entry.get("seasons") or []:
            seasons.add(int(s))
    hit = sorted(seasons & set(window))
    return hit or []


def estimate_requests(n_players, window, avg_seasons=6):
    """Rough request estimate for the report (no network):
    per player = 1 teams + 1 transfers + 1 trophies + avg_seasons stats."""
    per = 3 + avg_seasons
    return n_players * per


def run_collect_history(cfg, deps, dry_run=True, seasons=None,
                        refresh=False, limit=None):
    """deps: dict with client (ApiFootballClient), meta_client (reads/writes
    players_meta), career_writer (upserts player_career), budget. Kept
    dependency-injected so run.py wires the concrete objects and this module
    stays import-light and unit-testable.

    dry_run=True prints the plan (player count, season window, estimated
    requests, current budget) and writes NOTHING.
    """
    window = seasons or DEFAULT_HISTORY_SEASONS
    client = deps["client"]
    meta_client = deps["meta_client"]
    career_writer = deps["career_writer"]
    budget = deps["budget"]

    players = meta_client.fetch_history_targets(refresh=refresh, limit=limit)

    print("=" * 60)
    print("API-FOOTBALL — COLLECT HISTORY ({})".format(
        "DRY RUN, без записи и без сети" if dry_run else "LIVE (платный тариф)"))
    print("=" * 60)
    print("Игроков к сбору        : {} (resume: {})".format(
        len(players), "с нуля" if refresh else "только без отметки"))
    print("Окно сезонов           : {}-{}".format(window[0], window[-1]))
    print("Оценка запросов (~)    : {} (1 teams + 1 transfers + 1 trophies + "
          "~6 сезонов на игрока)".format(estimate_requests(len(players), window)))
    print("Бюджет API             : {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))
    print("=" * 60, flush=True)

    if dry_run:
        print("DRY RUN — ничего не собрано.")
        return

    done = career_rows = transfers_n = trophies_n = errors = 0
    n = len(players)
    try:
        for idx, p in enumerate(players, 1):
            api_id = p["api_football_id"]
            try:
                # 1) seasons that exist, then 2) per-season statistics
                rows = []
                for season in _seasons_for_player(client, api_id, window):
                    payload = client.get("players", {"id": api_id, "season": season})
                    rows.extend(_stat_rows(api_id, payload))
                if rows:
                    career_writer.upsert_career(rows)
                    career_rows += len(rows)

                # 3) transfers (career clubs), 4) trophies
                transfers = (client.get("transfers", {"player": api_id})
                             .get("response") or [])
                trophies = (client.get("trophies", {"player": api_id})
                            .get("response") or [])
                meta_client.set_player_history(
                    api_id, transfers=transfers, trophies=trophies)
                transfers_n += 1 if transfers else 0
                trophies_n += 1 if trophies else 0
                done += 1
            except RuntimeError as exc:
                # Budget hard-stop -> clean exit, progress already persisted.
                if "budget" in str(exc).lower():
                    print("[stop] бюджет исчерпан на игроке {} ({}/{}). "
                          "Прогресс сохранён, продолжите завтра.".format(
                              api_id, idx, n), flush=True)
                    break
                errors += 1
                print("[{}/{}] {} — ошибка: {}".format(idx, n, api_id, exc),
                      flush=True)
                continue
            except Exception as exc:  # noqa: BLE001
                errors += 1
                print("[{}/{}] {} — ошибка: {}".format(idx, n, api_id, exc),
                      flush=True)
                continue
            if idx % 100 == 0:
                print("[{}/{}] собрано {}, бюджет {}/{}".format(
                    idx, n, done, budget.used, budget.limit), flush=True)
    finally:
        print("=" * 60)
        print("COLLECT HISTORY SUMMARY")
        print("  игроков обработано   : {}".format(done))
        print("  career-строк записано: {}".format(career_rows))
        print("  с трансферами        : {}".format(transfers_n))
        print("  с трофеями           : {}".format(trophies_n))
        print("  ошибок               : {}".format(errors))
        print("  бюджет               : {}/{} (UTC {})".format(
            budget.used, budget.limit, budget.date))
        print("=" * 60)
