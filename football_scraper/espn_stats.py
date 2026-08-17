"""Per-match player statistics from ESPN's public soccer JSON.

    python3 espn_stats.py                # вчера и сегодня
    python3 espn_stats.py --days 7       # последние 7 суток
    python3 espn_stats.py --dry-run

ВТОРОЙ ИСТОЧНИК ДЛЯ ТОЙ ЖЕ ТАБЛИЦЫ, и он нужен не для объёма. sports.ru
находит игрока только через слаг, а слаг берётся со страницы состава
(российские клубы) или угадывается и проверяется (34 из 40 самых известных).
Все остальные в рейтинг не попадают вовсе. ESPN ключуется по лиге и матчу, а
не по игроку, поэтому достаёт тех же людей с другой стороны — и не требует
ключа.

⚠️ МИНУТ ЗДЕСЬ НЕТ. `subbedIn`/`subbedOut` у ESPN булевы: «вышел» есть, «когда»
нет. Пишется NULL, а не ноль — см. комментарий к колонке в
supabase/migrations/player_match_stats.sql.

⚠️ В ответе лежат коэффициенты (`odds`, `pickcenter`). Разбор их не читает и
читать не должен: коэффициенты в этом проекте только внутренние.

Окружение: SUPABASE_URL, SUPABASE_KEY (service role).
"""
import argparse
import os
import sys
import time
from datetime import date, timedelta

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scraper.dedup import _similarity, canonical_key  # noqa: E402
from scraper.espn import (  # noqa: E402
    completed_event_ids,
    parse_match_meta,
    parse_player_rows,
)
from sports_ru_stats import USER_AGENT, Db  # noqa: E402

BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer"

# Коды лиг проверены запросом — каждый отозвался своим настоящим названием.
LEAGUES = (
    "eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "usa.1", "bra.1", "rus.1",
    "ned.1", "por.1", "mex.1", "arg.1", "ksa.1", "uefa.champions",
)

# Имена здесь латинские с обеих сторон (ESPN и cards.name_en), поэтому порог
# выше, чем у русского сопоставления: расхождения тут — диакритика и
# сокращённое имя, а не разные системы транслитерации.
NAME_MATCH_RATIO = 0.90

DELAY_SECONDS = 0.4


def fetch_json(session, url):
    """JSON или None. Одна лига не должна валить прогон."""
    try:
        r = session.get(url, timeout=30)
        if r.status_code != 200:
            print("  !! {} {}".format(r.status_code, url))
            return None
        return r.json()
    except (requests.RequestException, ValueError) as err:
        print("  !! {}: {}".format(url, err))
        return None


def match_card(name, cards_by_key):
    key = canonical_key(name)
    if key in cards_by_key:
        return cards_by_key[key]
    best, best_score = None, 0.0
    for other, card in cards_by_key.items():
        score = _similarity(key, other)
        if score > best_score:
            best, best_score = card, score
    return best if best_score >= NAME_MATCH_RATIO else None


def collect(days, dry_run=False):
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_KEY are required", file=sys.stderr)
        return 2

    db = Db(url, key)
    session = requests.Session()
    # ⚠️ ТА ЖЕ СТРОКА, ЧТО У sports.ru, И ЭТО НЕ АККУРАТНОСТЬ, А УСЛОВИЕ
    # РАБОТЫ. Здесь стоял голый «SherlockScholesBot/1.0», и ESPN отвечал на
    # него 403 страницей Akamai «Access Denied» — все 28 запросов первого
    # прогона, до единого. Замер по повторам, 3 из 3 на каждом варианте:
    #
    #   SherlockScholesBot/1.0                        -> 403
    #   SherlockScholesBot/1.0 (+https://github.com/…) -> 200
    #   curl/8.5.0                                     -> 200
    #   python-requests/2.32.3                         -> 200
    #
    # То есть отклоняется не бот, назвавшийся ботом, — отклоняется КОРОТКИЙ
    # безымянный токен без контактной части. Строка ниже называет проект и
    # даёт адрес, куда писать: она честнее той, что блокировали, а не хитрее.
    session.headers.update({"User-Agent": USER_AGENT})

    cards = db.select(
        "/cards?select=id,name,name_en&active=eq.true&category=eq.player"
        "&name_en=not.is.null&order=id"
    )
    # Ключ строится по ЛАТИНСКОМУ имени: ESPN пишет «Miguel Almirón», а не
    # «Мигель Альмирон», и сопоставлять надо в одном алфавите.
    cards_by_key = {}
    for c in cards:
        cards_by_key.setdefault(canonical_key(c["name_en"]), c)
    print("cards with a latin name: {}".format(len(cards_by_key)))

    today = date.today()
    dates = [(today - timedelta(days=i)).strftime("%Y%m%d") for i in range(days)]

    rows, seen_events, unmatched = [], 0, 0
    for league in LEAGUES:
        for day in dates:
            board = fetch_json(session, "{}/{}/scoreboard?dates={}".format(BASE, league, day))
            time.sleep(DELAY_SECONDS)
            if not board:
                continue
            for event_id in completed_event_ids(board):
                summary = fetch_json(
                    session, "{}/{}/summary?event={}".format(BASE, league, event_id))
                time.sleep(DELAY_SECONDS)
                if not summary:
                    continue
                meta = parse_match_meta(summary)
                if not meta:
                    continue
                seen_events += 1
                for player in parse_player_rows(summary):
                    # Не выходившие на поле не пишутся: строка «0 голов, 0
                    # минут» ничего не добавляет рейтингу, а места в таблице
                    # занимает столько же.
                    if not player["played"]:
                        continue
                    card = match_card(player["name"], cards_by_key)
                    if not card:
                        unmatched += 1
                        continue
                    rows.append({
                        "card_id": card["id"],
                        "match_date": meta["date"],
                        "tournament": meta["league"] or league,
                        "home_team": meta["home"],
                        "away_team": meta["away"],
                        "home_score": meta["home_score"],
                        "away_score": meta["away_score"],
                        "minutes": None,
                        "goals": player["goals"],
                        "assists": player["assists"],
                        "yellow": player["yellow"],
                        "red": player["red"],
                        "source": "espn",
                    })

    print("matches read: {}, rows for our cards: {}, players not in the deck: {}"
          .format(seen_events, len(rows), unmatched))

    if dry_run:
        for r in rows[:10]:
            print("   {} {} {} г{} п{}".format(
                r["match_date"], r["tournament"], r["card_id"][:8], r["goals"], r["assists"]))
        return 0

    # Один и тот же игрок мог сыграть один матч — ключ (card, date, tournament)
    # это и ловит, но пачку с дублем PostgREST отвергает целиком, поэтому
    # схлопываем заранее.
    unique, keys = [], set()
    for r in rows:
        k = (r["card_id"], r["match_date"], r["tournament"])
        if k in keys:
            continue
        keys.add(k)
        unique.append(r)

    written = db.upsert("player_match_stats", unique, "card_id,match_date,tournament")
    print("written: {}".format(written))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=2,
                    help="сколько последних суток обойти (по умолчанию вчера и сегодня)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    print("=== espn player stats, {} ===".format(date.today().isoformat()))
    return collect(max(1, args.days), args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
