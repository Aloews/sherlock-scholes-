# -*- coding: utf-8 -*-
"""Статистика игрока по сезонам — с transfermarkt.com, по id.

ИСТОЧНИК НАЗВАН ПРЯМО: transfermarkt.com, его публичный JSON
`tmapi.transfermarkt.technology`. Разбирать HTML не нужно: страница
«leistungsdaten» сама ходит в этот адрес — таблицы в её разметке НЕТ ВООБЩЕ,
её рисует svelte-компонент.

    /player/<id>/performance-competition — сезон × турнир × клуб, по одному
                                           запросу на игрока
    /players?ids[]=…                     — паспортные данные, СОТНЯ за запрос
    /clubs?ids[]=…, /competitions?ids[]=… — справочники, тоже сотнями

ЗАЧЕМ. Владелец: «проверь статистику и историю трансферов у Классена и игроков
его ценовой категории и выше». Статистика в карточке бралась из инфобокса
Википедии. Замер по категории €600 тыс.+ (8986 карточек): career_stats есть у
1147, то есть у 13%. И там, где Википедия ЕСТЬ, она врёт умолчанием: у
Классена инфобокс дал 4 клуба (верхние по матчам), а источник даёт 19 строк за
семь клубов — пропал «ВСГ Тироль», где он отыграл лучший свой сезон.

⚠️ ДВА ЗАПРОСА НА ИГРОКА — НЕТ, ОДИН. Паспорт берётся ПАЧКАМИ ПО СОТНЕ, и
поэтому дата рождения (её владелец просил показывать у действующих игроков)
достаётся почти даром: 1768 недостающих — это 18 запросов, а не 1768.

ПОРЯДОК ОБХОДА — ПО СТОИМОСТИ, ОТ ДОРОГИХ. При пакетном сборе можно включить
и карточки без оценки (`--include-unvalued`): отсутствие рыночной стоимости
не должно лишать игрока статистики.

⚠️ ПОТЕРЯННЫЙ ИГРОК СЧИТАЕТСЯ ОТДЕЛЬНО ОТ ПУСТОГО. «Сеть не ответила» и «у
игрока нет ни одного матча» — разные утверждения, и молчаливое сложение их в
одно число однажды уже выдало обрыв связи за отсутствие данных.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет):
    python docs/players_stats_transfermarkt.py --min-value 600000 --limit 20
    APPLY=1 python docs/players_stats_transfermarkt.py --min-value 600000
"""
import argparse
import gzip
from datetime import datetime, timezone
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ⚠️ СВОЙ КАТАЛОГ В ПУТЬ — ЯВНО. При запуске `python3 docs/x.py` он там и так
# оказывается, а вот тесты грузят файл ПО ПУТИ (spec_from_file_location), и
# тогда `import _sb` падает с ModuleNotFoundError. Именно так и упал CI.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _sb import all_rows, sb  # общий транспорт: с повторами на обрыве

UA = ("SherlockScholesBot/1.0 "
      "(+https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
API = "https://tmapi.transfermarkt.technology"
PAUSE = 1.0
RETRIES = 3
PAGE = 1000
BULK = 100          # столько id принимает /players, /clubs, /competitions


def _i(value):
    """Целое или 0. Источник иногда отдаёт null там, где всегда было число."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def filter_candidates(cards, min_value=0, include_unvalued=False):
    """Keep cards at/above the threshold and optionally those without a value."""
    selected = []
    for card in cards:
        value = card.get("market_value_eur")
        if value is None:
            if include_unvalued:
                selected.append(card)
            continue
        try:
            amount = int(value)
        except (TypeError, ValueError):
            continue
        if amount >= min_value:
            selected.append(card)
    return selected


def latest_stat_fetch_by_tm(rows, season_id=None):
    """Latest source timestamp per player in the requested season only.

    Historical career rows must not make a player look current-season-complete.
    Without this filter, stars whose last fetch only contains older seasons can
    be skipped by every rolling batch even while their current-season row is absent.
    """
    latest = {}
    for row in rows:
        if season_id is not None:
            try:
                if int(row.get("season_id") or 0) != int(season_id):
                    continue
            except (TypeError, ValueError):
                continue
        tm_id = str(row.get("tm_player_id") or "")
        fetched_at = str(row.get("fetched_at") or "")
        if tm_id and fetched_at and fetched_at > latest.get(tm_id, ""):
            latest[tm_id] = fetched_at
    return latest


def refresh_priority_key(card, latest_by_tm):
    """Refresh never/least recently attempted players first.

    A valid source response with no season rows is still an attempt. Without a
    card-level attempt timestamp, a repeated 404/empty profile would stay first
    forever and starve the rest of the rolling catalogue.
    """
    tm_id = str(card.get("transfermarkt_id") or "")
    fetched_at = latest_by_tm.get(tm_id, "")
    checked_at = str(card.get("player_stats_checked_at") or "")
    try:
        value = int(card.get("market_value_eur") or 0)
    except (TypeError, ValueError):
        value = 0
    return (checked_at, fetched_at, -value, str(card.get("id") or ""))


def valid_season_payload(payload):
    """Only a valid match-level TMAPI success envelope can advance the checkpoint."""
    if not (
        isinstance(payload, dict)
        and payload.get("success") is True
        and isinstance(payload.get("data"), dict)
        and isinstance(payload["data"].get("performance"), list)
    ):
        return False
    games = payload["data"]["performance"]
    return not games or all(
        isinstance(game, dict)
        and isinstance(game.get("gameInformation"), dict)
        and isinstance(game.get("clubsInformation"), dict)
        and isinstance(game.get("statistics"), dict)
        for game in games
    )


def parse_seasons(payload):
    """Match-level TMAPI payload → one row per season/competition/club.

    The `performance-competition` route is a competition-level aggregate and
    must not be relabelled as a season. The `performance-game` route exposes
    match records; aggregating their actual `seasonId` is the source of truth
    for seasonal totals.
    """
    if not valid_season_payload(payload):
        return []

    totals = {}
    for game in payload["data"]["performance"]:
        info = game.get("gameInformation") or {}
        clubs = game.get("clubsInformation") or {}
        club = clubs.get("club") or {}
        season, comp, club_id = info.get("seasonId"), info.get("competitionId"), club.get("clubId")
        if season in (None, "") or not comp or not club_id:
            continue

        key = (str(season), str(comp), str(club_id))
        row = totals.setdefault(key, {
            "season_id": int(season),
            "competition_id": str(comp),
            "club_id": str(club_id),
            "apps": 0, "starts": 0, "sub_in": 0, "sub_out": 0,
            "minutes": 0, "goals": 0, "assists": 0,
            "own_goals": 0, "penalty_goals": 0,
            "yellow": 0, "yellow_red": 0, "red": 0,
            "team_goals": 0, "opponent_goals": 0,
        })

        stats = game.get("statistics") or {}
        general = stats.get("generalStatistics") or {}
        if general.get("participationState") != "played":
            continue

        goals = stats.get("goalStatistics") or {}
        cards = stats.get("cardStatistics") or {}
        playing = stats.get("playingTimeStatistics") or {}
        row["apps"] += 1
        row["minutes"] += _i(playing.get("playedMinutes"))
        row["goals"] += _i(goals.get("goalsScoredTotal"))
        row["assists"] += _i(goals.get("assists"))
        row["own_goals"] += _i(goals.get("ownGoalsScored"))
        row["penalty_goals"] += _i(goals.get("penaltyGoalsScored"))
        row["yellow"] += 1 if cards.get("yellowCard") else 0
        row["yellow_red"] += 1 if cards.get("yellowRedCard") else 0
        row["red"] += 1 if cards.get("redCard") else 0
        row["team_goals"] += _i(goals.get("teamGoalsOnThePitch"))
        row["opponent_goals"] += _i(goals.get("opponentGoalsOnThePitch"))

    return list(totals.values())

def parse_birth(player):
    """Паспорт игрока → дата рождения или None. ЧИСТАЯ ФУНКЦИЯ.

    ⚠️ ФЛАГ `isDateOfBirthUnknown` СИЛЬНЕЕ САМОЙ ДАТЫ. Источник при неизвестной
    дате ставит 1 января года рождения и поднимает флаг: записать такую дату
    значит поздравлять человека с днём рождения не в тот день, причём тысячи
    человек в один и тот же день.
    """
    if not isinstance(player, dict):
        return None
    life = player.get("lifeDates") or {}
    if life.get("isDateOfBirthUnknown"):
        return None
    born = (life.get("dateOfBirth") or "").strip()
    return born[:10] if len(born) >= 10 else None


def parse_club(club):
    """Клуб из справочника. ЧИСТАЯ ФУНКЦИЯ.

    `is_national_team` — ПОЛЕ ИСТОЧНИКА. Раньше сборные приходилось узнавать по
    поведению состава («доля игроков без другого клуба»); гадать больше не надо.
    """
    if not isinstance(club, dict) or not club.get("id"):
        return None
    base = club.get("baseDetails") or {}
    return {"id": str(club["id"]), "name": club.get("name"),
            "country_id": base.get("countryId"),
            "is_national_team": bool(base.get("isNationalTeam"))}


def parse_competition(comp):
    """Турнир из справочника. ЧИСТАЯ ФУНКЦИЯ."""
    if not isinstance(comp, dict) or not comp.get("id"):
        return None
    base = comp.get("baseDetails") or {}
    origin = comp.get("originDetails") or {}
    return {"id": str(comp["id"]), "name": comp.get("name"),
            "short_name": base.get("shortName") or comp.get("shortName"),
            "country_id": origin.get("countryId"), "type_id": comp.get("typeId"),
            "logo_url": comp.get("logoUrl")}


def get_json(url):
    """JSON или None. None значит «не дозвонились» — это НЕ пустой ответ."""
    for attempt in range(RETRIES):
        req = urllib.request.Request(url, headers={
            "User-Agent": UA, "Accept": "application/json",
            "Accept-Encoding": "gzip", "Accept-Language": "en-US"})
        try:
            with urllib.request.urlopen(req, timeout=60) as fh:
                raw = fh.read()
                if fh.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"success": True, "data": {"performance": []}, "_source_not_found": True}
            if e.code not in (429, 500, 502, 503, 504):
                return None
        except Exception:
            pass
        time.sleep(PAUSE * 3 * (attempt + 1))
    return None


def bulk(kind, ids):
    """Пачка справочника: сотня id за запрос. Возвращает список или []."""
    out = []
    for i in range(0, len(ids), BULK):
        chunk = ids[i:i + BULK]
        q = "&".join("ids[]=" + urllib.parse.quote(str(x)) for x in chunk)
        payload = get_json("%s/%s?%s" % (API, kind, q))
        if payload and payload.get("success"):
            out.extend(payload.get("data") or [])
        time.sleep(PAUSE)
    return out




def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--min-value", type=int, default=600000)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--refresh", action="store_true",
                    help="перезапросить и тех, у кого статистика уже собрана")
    ap.add_argument("--include-unvalued", action="store_true",
                    help="включить игроков без рыночной оценки")
    ap.add_argument("--only", default="", help="один id на Transfermarkt, для проверки")
    args = ap.parse_args()
    if args.only and not args.only.isdigit():
        raise SystemExit("--only должен быть числовым Transfermarkt ID")
    apply_ = os.environ.get("APPLY") == "1"
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY")):
        raise SystemExit("нужны SUPABASE_URL и SUPABASE_KEY")

    if args.only:
        cards = sb("cards", params={
            "select": "id,name_en,transfermarkt_id,market_value_eur,born_on,player_stats_checked_at",
            "category": "in.(player,woman)", "active": "is.true",
            "transfermarkt_id": "eq." + args.only,
            "order": "id.asc", "limit": 1}) or []
    else:
        query = {
            "select": "id,name_en,transfermarkt_id,market_value_eur,born_on",
            "category": "in.(player,woman)", "active": "is.true",
            "transfermarkt_id": "not.is.null",
            "order": "market_value_eur.desc.nullslast,id.asc",
        }
        if not args.include_unvalued:
            query["market_value_eur"] = "gte.%d" % args.min_value
        cards = all_rows("cards", query)
        if args.include_unvalued:
            cards = filter_candidates(cards, args.min_value, include_unvalued=True)

    if args.refresh:
        if args.only:
            latest_by_tm = {}
        else:
            newest_season_rows = sb(
                "player_season_stat",
                params={"select": "season_id", "order": "season_id.desc", "limit": 1})
            if newest_season_rows is None:
                raise SystemExit("could not determine active season for stats refresh")
            current_season = (
                int(newest_season_rows[0]["season_id"])
                if newest_season_rows and newest_season_rows[0].get("season_id") is not None
                else None
            )
            # Fetch timestamps only for the active season. Reading the full
            # multi-year table on every refresh wastes requests and time.
            current_season_query = {
                "select": "tm_player_id,season_id,fetched_at",
                "order": "tm_player_id",
            }
            if current_season is not None:
                current_season_query["season_id"] = "eq.%d" % current_season
            stored_stats = all_rows("player_season_stat", current_season_query)
            latest_by_tm = latest_stat_fetch_by_tm(
                stored_stats, season_id=current_season)
        cards.sort(key=lambda card: refresh_priority_key(card, latest_by_tm))
    else:
        done = {r["tm_player_id"] for r in all_rows(
            "player_season_stat", {"select": "tm_player_id", "order": "tm_player_id"})}
        cards = [c for c in cards if c["transfermarkt_id"] not in done]
    if args.limit:
        cards = cards[:args.limit]

    print("Игроков к обходу: %d (от %d €)  (APPLY=%s)"
          % (len(cards), args.min_value, "да" if apply_ else "нет — сухой прогон"),
          flush=True)

    # --- паспорт пачками: дата рождения тем, у кого её нет ------------------
    need_born = [c for c in cards if not c.get("born_on")]
    born_written = 0
    if need_born:
        print("Без даты рождения: %d — запросим %d пачками по %d"
              % (len(need_born), (len(need_born) + BULK - 1) // BULK, BULK), flush=True)
        by_tm = {c["transfermarkt_id"]: c for c in need_born}
        for player in bulk("players", list(by_tm)):
            born = parse_birth(player)
            card = by_tm.get(str(player.get("id")))
            if born and card and apply_:
                sb("cards", method="PATCH", body={"born_on": born},
                   params={"id": "eq." + card["id"]})
                born_written += 1
            elif born and card:
                born_written += 1
        print("Дат рождения: %d" % born_written, flush=True)

    # --- статистика: по одному запросу на игрока ---------------------------
    #
    # ⚠️ СПРАВОЧНИК ДОЛИВАЕТСЯ ПО ХОДУ, А НЕ В КОНЦЕ. Обход девяти тысяч
    # игроков идёт часами и уже дважды обрывался молча; справочник, записанный
    # последней строкой, при обрыве не записывается вовсе — и вся собранная
    # статистика остаётся с кодами «A1» и «2446» вместо названий.
    written = empty = lost = refused = check_refused = 0
    clubs_seen, comps_seen = set(), set()
    known_clubs = {r["id"] for r in all_rows("tm_club", {"select": "id", "order": "id"})}
    known_comps = {r["id"] for r in all_rows("tm_competition", {"select": "id", "order": "id"})}

    def flush_directory():
        new_clubs = sorted(clubs_seen - known_clubs)
        new_comps = sorted(comps_seen - known_comps)
        if not (new_clubs or new_comps):
            return
        print("  справочник: клубов +%d, турниров +%d"
              % (len(new_clubs), len(new_comps)), flush=True)
        if not apply_:
            known_clubs.update(new_clubs)
            known_comps.update(new_comps)
            return
        clubs = [c for c in (parse_club(x) for x in bulk("clubs", new_clubs)) if c]
        comps = [c for c in (parse_competition(x) for x in bulk("competitions", new_comps)) if c]
        for start in range(0, max(len(clubs), len(comps), 1), 200):
            sb("rpc/apply_tm_directory", method="POST",
               body={"p_clubs": clubs[start:start + 200],
                     "p_competitions": comps[start:start + 200]})
        known_clubs.update(c["id"] for c in clubs)
        known_comps.update(c["id"] for c in comps)

    for i, card in enumerate(cards, 1):
        tm = card["transfermarkt_id"]
        payload = get_json("%s/player/%s/performance-game"
                           % (API, urllib.parse.quote(tm)))
        source_ok = valid_season_payload(payload)
        write_ok = True
        if not source_ok:
            lost += 1
        else:
            rows = parse_seasons(payload)
            if not rows:
                empty += 1
            else:
                clubs_seen.update(r["club_id"] for r in rows)
                comps_seen.update(r["competition_id"] for r in rows)

            # The match-level endpoint is a complete history snapshot. Replace
            # the player's rows so obsolete aggregate-as-season records disappear.
            # A definitive 404 is different: preserve existing stats for an ID
            # that the upstream no longer resolves.
            if apply_ and not payload.get("_source_not_found"):
                res = sb("rpc/apply_player_season_stats", method="POST",
                         body={"p_tm_id": tm, "p_rows": rows})
                if res is None:
                    refused += 1
                    write_ok = False
                else:
                    write_ok = True
                    written += (res[0].get("written", 0) if res else 0)
            elif not apply_:
                written += len(rows)

        # A valid source response is an attempt even when it contains no season
        # rows (for example, a retired player or a definitive 404). Failed
        # network responses and failed stats writes must remain eligible to retry.
        if apply_ and source_ok and write_ok:
            check_result = sb(
                "cards", method="PATCH",
                body={"player_stats_checked_at": datetime.now(timezone.utc).isoformat()},
                params={"id": "eq." + str(card["id"])},
            )
            if check_result is None:
                check_refused += 1
        if i % 25 == 0:
            print("  %d/%d, строк %d, пусто %d, потеряно %d, отказов %d"
                  % (i, len(cards), written, empty, lost, refused), flush=True)
        if i % 250 == 0:
            flush_directory()
        time.sleep(PAUSE)

    flush_directory()

    print("-" * 70)
    print("Строк статистики : %d" % written)
    print("Без матчей       : %d" % empty)
    print("Отметка попытки обновления записана: %d" % max(0, len(cards) - lost - refused - check_refused), flush=True)
    if lost:
        print("⚠️ ИГРОКОВ ПОТЕРЯНО: %d — их пустота НИЧЕГО не значит, повторить" % lost)
    if refused:
        print("⚠️ ЗАПИСЬ ОТКЛОНЕНА У %d — причина напечатана выше, повторить" % refused)
    if check_refused:
        print("⚠️ НЕ УДАЛОСЬ ЗАПИСАТЬ ВРЕМЯ ПОПЫТКИ У %d — повторить" % check_refused)
        raise SystemExit(1)
    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")


if __name__ == "__main__":
    main()
