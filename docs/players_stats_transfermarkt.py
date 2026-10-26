# -*- coding: utf-8 -*-
"""Статистика игрока по турнирам и клубам — с Transfermarkt, по ID.

ИСТОЧНИК НАЗВАН ПРЯМО: transfermarkt.com, его публичный JSON
`tmapi.transfermarkt.technology`. Разбирать HTML не нужно: страница
«leistungsdaten» сама ходит в этот адрес — таблицы в её разметке НЕТ ВООБЩЕ,
её рисует svelte-компонент.

    /player/<id>/performance-competition — карьерные агрегаты по турниру и клубу
    /ceapi/player/<id>/performance      — подтверждённые сезон × турнир
    /players?ids[]=…                     — паспортные данные, СОТНЯ за запрос
    /clubs?ids[]=…, /competitions?ids[]=… — справочники, тоже сотнями

ЗАЧЕМ. Владелец: «проверь статистику и историю трансферов у Классена и игроков
его ценовой категории и выше». Статистика в карточке бралась из инфобокса
Википедии. Замер по категории €600 тыс.+ (8986 карточек): career_stats есть у
1147, то есть у 13%. И там, где Википедия ЕСТЬ, она врёт умолчанием: у
Классена инфобокс дал 4 клуба (верхние по матчам), а источник даёт 19 строк за
семь клубов — пропал «ВСГ Тироль». Важно: endpoint performance-competition
отдаёт агрегаты по турниру/клубу, а не подтверждённые сезонные строки. У Палмера
GB1 с seasonId=2019 содержит 118 матчей и 49 голов за несколько сезонов.
Сезонную статистику нельзя выводить из этого endpoint; для неё нужен сезонный
источник или проверенный матч-лог.

Два статистических источника хранятся раздельно по зерну: карьерные итоги по
клубу/турниру и сезонные итоги по турниру. Сезонные записи не выводятся из
карьерных агрегатов. Паспорт берётся пачками по сотне, поэтому дата рождения
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
import datetime as dt
import gzip
import json
import os
import re
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


def select_stale_candidates(cards, freshness, stale_days=7, now=None):
    """Return missing or stale players; freshness maps Transfermarkt IDs to ISO timestamps."""
    now = now or dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(days=max(0, int(stale_days)))
    selected = []
    for card in cards:
        tm_id = str(card.get("transfermarkt_id") or "")
        raw = freshness.get(tm_id)
        if not raw:
            selected.append(card)
            continue
        try:
            fetched = dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if fetched.tzinfo is None:
                fetched = fetched.replace(tzinfo=dt.timezone.utc)
        except (TypeError, ValueError):
            selected.append(card)
            continue
        if fetched < cutoff:
            selected.append(card)
    return selected


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


def parse_seasons(payload):
    """JSON игрока → строки для `apply_player_season_stats`. ЧИСТАЯ ФУНКЦИЯ.

    ⚠️ КЛЮЧ СОБИРАЕТСЯ ИЗ ТРЁХ ПОЛЕЙ, И КЛУБ В НЁМ ОБЯЗАТЕЛЕН. Сезон 2021
    Классен начал в «Тироле», а закончил в «Спартаке»: без клуба одна строка
    затёрла бы другую, и год просто исчез бы из карьеры.

    ⚠️ СТРОКА БЕЗ КЛУБА ИЛИ БЕЗ ТУРНИРА ВЫБРАСЫВАЕТСЯ. Такая запись не «ноль
    матчей», а запись, которую некуда положить: ключ неполон.
    """
    if not isinstance(payload, dict):
        return []
    data = payload.get("data") or {}
    out = []
    for row in data.get("performance") or []:
        info = row.get("generalInformation") or {}
        season, comp = info.get("seasonId"), info.get("competitionId")
        club = info.get("clubId")
        if season in (None, "") or not comp or not club:
            continue
        st = row.get("statistics")
        if not isinstance(st, dict):
            continue
        g = st.get("goalStatistics")
        t = st.get("playingTimeStatistics")
        c = st.get("cardStatistics") or {}
        # Missing statistic blocks mean an incomplete provider payload, not zero.
        # Skipping the row prevents an upstream shape change from overwriting good data.
        if not isinstance(g, dict) or not isinstance(t, dict):
            continue
        if not any(key in g for key in ("goalsSum", "assistsSum", "ownGoalsSum")):
            continue
        if not any(key in t for key in ("appearancesCount", "playedMinutesSum", "startingCount")):
            continue
        # Core nulls mean "unknown", not zero. Do not overwrite a previously
        # verified row with fabricated zeroes when the provider response is partial.
        if any(g.get(key) is None for key in ("goalsSum", "assistsSum")):
            continue
        if any(t.get(key) is None for key in ("appearancesCount", "playedMinutesSum")):
            continue
        out.append({
            "season_id": int(season),
            "competition_id": str(comp),
            "club_id": str(club),
            "apps": _i(t.get("appearancesCount")),
            "starts": _i(t.get("startingCount")),
            "sub_in": _i(t.get("substitutedInCount")),
            "sub_out": _i(t.get("substitutedOutCount")),
            "minutes": _i(t.get("playedMinutesSum")),
            "goals": _i(g.get("goalsSum")),
            "assists": _i(g.get("assistsSum")),
            "own_goals": _i(g.get("ownGoalsSum")),
            "penalty_goals": _i(g.get("penaltyShooterGoalsScored")),
            "yellow": _i(c.get("yellowCardNetSum")),
            "yellow_red": _i(c.get("yellowRedCardsCount")),
            "red": _i(c.get("redCardsCount")),
            "team_goals": _i(g.get("teamGoalsOnThePitchSum")),
            "opponent_goals": _i(g.get("opponentGoalsOnThePitch")),
        })
    return out


def _f(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_season_competition_stats(payload, tm_id):
    """Parse true season-by-competition rows from the CEAPI performance endpoint."""
    if isinstance(payload, list):
        source_rows = payload
    elif isinstance(payload, dict) and isinstance(payload.get("data"), list):
        source_rows = payload["data"]
    else:
        return []
    source_url = "https://www.transfermarkt.com/ceapi/player/%s/performance" % tm_id
    out = []
    for row in source_rows:
        if not isinstance(row, dict):
            continue
        link = str(row.get("detailedStatsLink") or "")
        match = re.search(r"/wettbewerb/([^/?#]+)/saison/(\d{4})(?:[/?#]|$)", link)
        if not match:
            continue
        core = (row.get("gamesPlayed"), row.get("goalsScored"),
                row.get("assists"), row.get("minutesPlayed"))
        if any(value is None for value in core):
            continue
        out.append({
            "season_id": int(match.group(2)),
            "competition_id": match.group(1),
            "competition_name": row.get("competitionDescription"),
            "apps": _i(row.get("gamesPlayed")),
            "possible_games": row.get("possibleGames"),
            "goals": _i(row.get("goalsScored")),
            "assists": _i(row.get("assists")),
            "minutes": _i(row.get("minutesPlayed")),
            "yellow": _i(row.get("yellowCards")),
            "yellow_red": _i(row.get("secondYellowCards")),
            "red": _i(row.get("redCards")),
            "start_eleven_percent": _f(row.get("startElevenPercent")),
            "minutes_played_percent": _f(row.get("minutesPlayedPercent")),
            "goals_contributed_percent": _f(row.get("goalsContributedPercent")),
            "goalkeeper": row.get("goalkeeper") if isinstance(row.get("goalkeeper"), bool) else None,
            "source_url": source_url,
            "source_payload": row,
        })
    return out


def payload_status(payload, rows, endpoint):
    """Distinguish valid empty responses from failures and partially parsed payloads."""
    if payload is None:
        return "error"
    if endpoint == "career":
        source_rows = (
            payload.get("data", {}).get("performance")
            if isinstance(payload, dict) and isinstance(payload.get("data"), dict)
            else None
        )
    else:
        source_rows = payload if isinstance(payload, list) else (
            payload.get("data") if isinstance(payload, dict) else None
        )
    if isinstance(source_rows, list) and not source_rows:
        return "empty"
    if rows and isinstance(source_rows, list) and len(rows) == len(source_rows):
        return "ok"
    return "error"


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
                if "/ceapi/player/" in url and url.endswith("/performance"):
                    return []
                return {"success": True, "data": {"performance": []}}
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
                    help="перезапросить всех выбранных игроков независимо от свежести")
    ap.add_argument("--stale-days", type=int, default=7,
                    help="обновлять статистику старше указанного числа дней (по умолчанию 7)")
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
            "select": "id,name_en,transfermarkt_id,market_value_eur,born_on",
            "category": "eq.player", "active": "is.true",
            "transfermarkt_id": "eq." + args.only,
            "order": "id.asc", "limit": 1}) or []
    else:
        query = {
            "select": "id,name_en,transfermarkt_id,market_value_eur,born_on",
            "category": "eq.player", "active": "is.true",
            "transfermarkt_id": "not.is.null",
            "order": "market_value_eur.desc.nullslast,id.asc",
        }
        if not args.include_unvalued:
            query["market_value_eur"] = "gte.%d" % args.min_value
        cards = all_rows("cards", query)
        if args.include_unvalued:
            cards = filter_candidates(cards, args.min_value, include_unvalued=True)

    if not args.only and not args.refresh:
        freshness_rows = all_rows(
            "player_stats_freshness",
            {"select": "tm_player_id,latest_fetched_at", "order": "tm_player_id"})
        freshness = {
            str(row["tm_player_id"]): row.get("latest_fetched_at")
            for row in freshness_rows
        }
        cards = select_stale_candidates(cards, freshness, args.stale_days)
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
    written = season_written = empty = season_empty = lost = season_lost = refused = 0
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
        career_payload = get_json("%s/player/%s/performance-competition"
                                  % (API, urllib.parse.quote(tm)))
        career_rows = parse_seasons(career_payload)
        career_status = payload_status(career_payload, career_rows, "career")
        if career_status == "empty":
            empty += 1
        elif career_status == "error":
            lost += 1
        clubs_seen.update(r["club_id"] for r in career_rows)
        comps_seen.update(r["competition_id"] for r in career_rows)

        # One-second spacing between provider endpoints; do not burst requests.
        time.sleep(PAUSE)
        season_url = "https://www.transfermarkt.com/ceapi/player/%s/performance" % urllib.parse.quote(tm)
        season_payload = get_json(season_url)
        season_rows = parse_season_competition_stats(season_payload, tm)
        season_status = payload_status(season_payload, season_rows, "season")
        if season_status == "empty":
            season_empty += 1
        elif season_status == "error":
            season_lost += 1
        comps_seen.update(r["competition_id"] for r in season_rows)

        if apply_:
            res = sb("rpc/apply_player_stats_bundle", method="POST", body={
                "p_tm_id": tm,
                "p_career_rows": career_rows,
                "p_season_rows": season_rows,
                "p_career_status": career_status,
                "p_season_status": season_status,
            })
            if res is None:
                refused += 1
            else:
                result = res[0] if isinstance(res, list) and res else (res if isinstance(res, dict) else {})
                written += int(result.get("career_written") or 0)
                season_written += int(result.get("season_written") or 0)
        else:
            written += len(career_rows)
            season_written += len(season_rows)

        if i % 25 == 0:
            print("  %d/%d, career %d, seasons %d, empty %d/%d, failed %d/%d, write refusals %d"
                  % (i, len(cards), written, season_written, empty, season_empty,
                     lost, season_lost, refused), flush=True)
        if i % 250 == 0:
            flush_directory()
        time.sleep(PAUSE)

    flush_directory()

    print("-" * 70)
    print("Career competition rows : %d" % written)
    print("Season competition rows : %d" % season_written)
    print("Career empty responses  : %d" % empty)
    print("Season empty responses  : %d" % season_empty)
    print("Season source failures  : %d" % season_lost)
    if lost:
        print("⚠️ ИГРОКОВ ПОТЕРЯНО: %d — их пустота НИЧЕГО не значит, повторить" % lost)
    if refused:
        print("⚠️ ЗАПИСЬ ОТКЛОНЕНА У %d — причина напечатана выше, повторить" % refused)
    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")


if __name__ == "__main__":
    main()
