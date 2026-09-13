"""Per-match player statistics from ESPN's public soccer JSON.

    python3 espn_stats.py                # вчера и сегодня
    python3 espn_stats.py --days 7       # последние 7 суток
    python3 espn_stats.py --dry-run

⚠️ ЭТО ЖЕ И ИСТОЧНИК СТАТИСТИКИ КОМАНД. `club_match` не собирается ниоткуда
отдельно: `rebuild_club_matches()` сворачивает до матчей ровно те строки,
которые пишет этот обход (см. supabase/migrations/football_clubs.sql, §9).
То есть лига, которой нет в списке ниже, — это и игроки без статистики, и
клубы без формы, без разницы мячей и без характера. Одно и то же место.

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
import unicodedata
from datetime import date, timedelta

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scraper.dedup import canonical_key  # noqa: E402
from scraper.espn import (  # noqa: E402
    completed_event_ids,
    parse_match_meta,
    parse_player_rows,
)
from sports_ru_stats import USER_AGENT, Db  # noqa: E402

BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer"

# Лиги: код ESPN -> название, которым он сам отозвался 13.09.2026.
#
# ⚠️ НАЗВАНИЕ ЗДЕСЬ НЕ УКРАШЕНИЕ, А ПРОВЕРЯЕМАЯ ЧАСТЬ ЗАПИСИ. Прежде тут стоял
# голый кортеж кодов с комментарием «проверены запросом», и проверить это
# утверждение было нечем: код, переставший отвечать, выглядит ровно как код,
# у которого в тот день не было матчей. Пара «код + имя» делает расхождение
# видимым — её сверяет `check-prod`, раздел «ESPN: лиги отзываются».
#
# ⚠️ ЛИГУ СЮДА ДОБАВЛЯЮТ НЕ ЗА ИЗВЕСТНОСТЬ, А ЗА КАРТОЧКИ В КОЛОДЕ. Каждая
# строка ниже — лига, в клубах которой у нас ЕСТЬ игроки: без этого обход
# тратит запросы на матчи людей, которых не с кем сопоставить. Перед добавлением
# новой строки считают карточки без статистики по её лиге, а не наоборот.
LEAGUES = {
    # Те четырнадцать, с которых всё начиналось.
    "eng.1": "English Premier League",
    "esp.1": "Spanish LALIGA",
    "ger.1": "German Bundesliga",
    "ita.1": "Italian Serie A",
    "fra.1": "French Ligue 1",
    "usa.1": "MLS",
    "bra.1": "Brazilian Serie A",
    "rus.1": "Russian Premier League",
    "ned.1": "Dutch Eredivisie",
    "por.1": "Portuguese Primeira Liga",
    "mex.1": "Mexican Liga BBVA MX",
    "arg.1": "Argentine Liga Profesional de Fútbol",
    "ksa.1": "Saudi Pro League",
    "uefa.champions": "UEFA Champions League",

    # ВТОРЫЕ ДИВИЗИОНЫ. Самая большая дыра из найденных: в Серии Б, Лиге 2,
    # Чемпионшипе и Сегунде у нас сотни карточек, а статистики было у каждой
    # двадцатой — не потому, что её негде взять, а потому, что никто не спросил.
    "eng.2": "English League Championship",
    "eng.3": "English League One",
    "eng.4": "English League Two",
    "ita.2": "Italian Serie B",
    "ger.2": "German 2. Bundesliga",
    "fra.2": "French Ligue 2",
    "esp.2": "Spanish LALIGA 2",
    "ned.2": "Dutch Keuken Kampioen Divisie",
    "tur.2": "Turkish 1. Ligi",
    "bra.2": "Brazilian Serie B",

    # ПЕРВЫЕ ДИВИЗИОНЫ, КОТОРЫХ ПРОСТО НЕ БЫЛО В СПИСКЕ.
    "tur.1": "Turkish Super Lig",
    "sui.1": "Swiss Super League",
    "bel.1": "Belgian Pro League",
    "sco.1": "Scottish Premiership",
    "aut.1": "Austrian Bundesliga",
    "gre.1": "Greek Super League",
    "den.1": "Danish Superliga",
    "swe.1": "Swedish Allsvenskan",
    "nor.1": "Norwegian Eliteserien",
    "fin.1": "Finnish Veikkausliga",
    "cze.1": "Gambrinus Liga",
    "irl.1": "Irish Premier Division",
    "isr.1": "Israeli Premier League",
    "jpn.1": "Japanese J.League",
    "chn.1": "Chinese Super League",
    "tha.1": "Thai League 1",
    "rsa.1": "South African Premiership",
    "col.1": "Colombian Primera A",
    "uru.1": "Liga AUF Uruguaya",
    "chi.1": "Chilean Primera División",
    "par.1": "Paraguayan Primera División",
    "ven.1": "Venezuelan Primera División",
    "bol.1": "Bolivian Liga Profesional",

    # КУБКИ. Дают не новых игроков, а НЕДОСТАЮЩИЕ МАТЧИ уже найденным — и
    # единственные достают клубы из лиг, которых у ESPN нет вовсе: белорусский
    # или казахстанский клуб попадает сюда через квалификацию.
    "uefa.europa": "UEFA Europa League",
    "uefa.europa.conf": "UEFA Conference League",
    "conmebol.libertadores": "CONMEBOL Libertadores",
    "conmebol.sudamericana": "CONMEBOL Sudamericana",
    "concacaf.champions": "Concacaf Champions Cup",
    "afc.champions": "AFC Champions League Elite",
}

DELAY_SECONDS = 0.4

# ⚠️ ОКНО ДАТАМИ, А НЕ ПО ОДНОМУ ДНЮ — ИНАЧЕ СПИСОК ВЫШЕ НЕ ПОМЕЩАЕТСЯ В НОЧЬ.
# `scoreboard?dates=A-B` отвечает диапазоном, и это проверено сравнением, а не
# прочитано в документации: за 1–12 сентября по Чемпионшипу обход по дням дал
# 44 матча, один запрос диапазоном — те же 44, и разность множеств пуста в обе
# стороны. Девяносто суток на лигу — это 90 запросов против трёх.
#
# Тридцать, а не все девяносто разом, — страховка от необъявленного потолка на
# число событий в ответе. Замер на самых плотных лигах (bra.1, usa.1) показал
# 91 и 156 событий без потерь, то есть потолка на этих числах нет; окно
# оставлено узким, потому что цена страховки — два лишних запроса на лигу.
CHUNK_DAYS = 30


def date_windows(days, today):
    """Окна `(с, по)` в формате ESPN, от свежего к старому.

    Чистая функция: даты на вход, строки на выход — проверяется тестом без сети.
    """
    windows = []
    covered = 0
    while covered < days:
        hi = today - timedelta(days=covered)
        span = min(CHUNK_DAYS, days - covered) - 1
        lo = hi - timedelta(days=max(span, 0))
        windows.append((lo.strftime("%Y%m%d"), hi.strftime("%Y%m%d")))
        covered += span + 1
    return windows


def fold_diacritics(name):
    """«Jukić» -> «Jukic». Разложить и выбросить надстрочные знаки.

    Единственная вольность, которую здесь можно себе позволить при
    сопоставлении имён, — и она безопасна ровно потому, что ничего не
    угадывает: две записи одного имени в разной типографике становятся ОДНИМ
    ключом, а два разных имени остаются разными.
    """
    return "".join(
        c for c in unicodedata.normalize("NFKD", name) if not unicodedata.combining(c)
    )


def card_key(name):
    return canonical_key(fold_diacritics(name))


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
    """Карточка с ТЕМ ЖЕ именем, или None. Похожих здесь не бывает.

    ⚠️ ЗДЕСЬ СТОЯЛ НЕЧЁТКИЙ ПЕРЕБОР С ПОРОГОМ 0.90, И ОН ПРИПИСЫВАЛ ГОЛЫ НЕ
    ТЕМ. Замер по живому ответу ESPN за двое суток на полной колоде: 234
    точных совпадения и 41 нечёткое, а среди нечётких примерно каждое пятое —
    другой человек:
        Marco Pellegrino -> Mark Pellegrino   0.966
        Lucas Romero     -> Luka Romero       0.952
        Josef Martínez   -> Josep Martínez    0.923   (форвард и вратарь)
        Ronald           -> Ronaldo           0.923
        Murilo           -> Murillo           0.923
    Порогом это не чинится, и в этом всё дело: ошибки стоят ВЫШЕ правильных
    совпадений, так что любая планка, пропускающая настоящие пары, пропустит
    и эти. Раньше промах был редок, потому что сборщик по недосмотру видел
    тысячу карточек из 2919; на полной колоде он стал обычным делом.
    Ошибиться дороже, чем не найти: пропущенный игрок просто не попадёт в
    рейтинг, а приписанный гол — это чужая фамилия в списке бомбардиров.

    Осталось единственное послабление — свёртка диакритики, и она не
    угадывает: «Jukić» и «Jukic» это одна запись в разной типографике. На тех
    же данных она переводит в ТОЧНЫЕ 13 из 22 проверенных пар и не пропускает
    ни одной из ложных выше.

    Транслитерационные расхождения («Yevgeni» против «Evgeny») теперь мимо, и
    это осознанная цена: почти все они — российская лига, а её и держит
    sports.ru, который ключуется слагом, а не именем. Вернуть их можно
    проверкой по клубу — у ESPN он в составе, у карточки в
    `card_current_club`; без второго признака отличить однофамильца нельзя.
    """
    return cards_by_key.get(card_key(name))


def active_cards_by_key(cards, current_club_ids):
    """Карточки, годные для сопоставления по имени ESPN, ключ — card_key().

    Тот же барьер, что и active_cards_by_key в sports_ru_stats.py, и по той же
    причине: ESPN тоже достаёт игрока по имени, а не по ID, а состав матча —
    это РЕАЛЬНЫЕ, СЕЙЧАС ИГРАЮЩИЕ футболисты. Карточка легенды с голым именем
    (без строки в card_current_club) не обязана участвовать в этом
    сопоставлении только потому, что ключ совпал с чьим-то ещё.

    ИЗМЕРЕНО, А НЕ ГИПОТЕТИЧНО: Роналдо (р.1976, закончил ~2011, имя карточки
    — голое «Роналдо») получил чужие голы и с этой стороны тоже — две строки
    от ныне играющего бразильца из Серии A, найдено на боевой базе 24.08.2026
    рядом с той же коллизией у sports.ru (docs/namesake_fixes.sql). Барьер для
    sports.ru уже стоит; это — та же защита для второго источника.

    Пропущенный матч активного игрока, чей card_current_club ещё не подъехал,
    — безопасное направление ошибки; приписать голы чужого человека карточке
    легенды — нет. Тот же выбор, что и в sports_ru_stats.py.
    """
    by_key = {}
    for c in cards:
        if c["id"] not in current_club_ids:
            continue
        by_key.setdefault(card_key(c["name_en"]), c)
    return by_key


def write_rows(db, rows):
    """Записать пачку одной лиги, схлопнув дубли. Возвращает записанное.

    ⚠️ ПИШЕТСЯ ПО ЛИГЕ, А НЕ ОДИН РАЗ В КОНЦЕ, И ЭТО ПОЧИНКА. Прежде обход
    копил строки всех лиг в один список и писал после последней: обход,
    прерванный на предпоследней лиге, не записывал НИЧЕГО. Пока лиг было
    четырнадцать и обход укладывался в полчаса, это сходило с рук; на полном
    списке за девяносто суток — уже нет. Ровно этой формы ошибку чинили в
    football-fixtures: «ONE WRITE PER COMPETITION, NOT ONE AT THE END».

    Схлопывание здесь, а не в базе: один игрок может значиться в одном матче
    дважды, ключ (карточка, дата, турнир) это поймает, но PostgREST отвергает
    пачку с дублем ЦЕЛИКОМ — то есть из-за одной строки потерялась бы лига.
    """
    unique, keys = [], set()
    for r in rows:
        k = (r["card_id"], r["match_date"], r["tournament"])
        if k in keys:
            continue
        keys.add(k)
        unique.append(r)
    return db.upsert("player_match_stats", unique, "card_id,match_date,tournament")


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
    current_club_ids = {
        c["card_id"] for c in db.select("/card_current_club?select=card_id&order=card_id")
    }
    # Ключ строится по ЛАТИНСКОМУ имени: ESPN пишет «Miguel Almirón», а не
    # «Мигель Альмирон», и сопоставлять надо в одном алфавите. Только карточки
    # с известным текущим клубом — active_cards_by_key выше объясняет, зачем.
    cards_by_key = active_cards_by_key(cards, current_club_ids)
    print("cards with a latin name and a current club: {}".format(len(cards_by_key)))

    today = date.today()
    windows = date_windows(days, today)

    total_rows, seen_events, unmatched, written_total = 0, 0, 0, 0
    for league in LEAGUES:
        # ⚠️ СОБЫТИЯ СОБИРАЮТСЯ МНОЖЕСТВОМ, А НЕ СПИСКОМ. Соседние окна
        # смыкаются встык, но ESPN относит матч к дате НАЧАЛА по своему
        # часовому поясу, и матч на стыке попадает в оба ответа. Дубль стоил бы
        # лишнего запроса за summary — того самого, который в этом обходе и
        # есть почти вся цена.
        event_ids = []
        seen_ids = set()
        for lo, hi in windows:
            board = fetch_json(
                session,
                "{}/{}/scoreboard?dates={}-{}&limit=1000".format(BASE, league, lo, hi))
            time.sleep(DELAY_SECONDS)
            if not board:
                continue
            for event_id in completed_event_ids(board):
                if event_id in seen_ids:
                    continue
                seen_ids.add(event_id)
                event_ids.append(event_id)

        rows = []
        for event_id in event_ids:
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

        total_rows += len(rows)
        print("  {:22} матчей {:4}  строк {:5}".format(league, len(event_ids), len(rows)))
        if dry_run:
            for r in rows[:3]:
                print("     {} {} {} г{} п{}".format(
                    r["match_date"], r["tournament"], r["card_id"][:8],
                    r["goals"], r["assists"]))
            continue
        if rows:
            written_total += write_rows(db, rows)

    print("matches read: {}, rows for our cards: {}, players not in the deck: {}"
          .format(seen_events, total_rows, unmatched))
    if dry_run:
        return 0
    print("written: {}".format(written_total))
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
