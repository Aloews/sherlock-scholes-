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
    completed_events,
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
    "bra.2": "Brazilian Serie B",

    # ПЕРВЫЕ ДИВИЗИОНЫ, КОТОРЫХ ПРОСТО НЕ БЫЛО В СПИСКЕ.
    "tur.1": "Turkish Super Lig",
    "bel.1": "Belgian Pro League",
    "sco.1": "Scottish Premiership",
    "aut.1": "Austrian Bundesliga",
    "gre.1": "Greek Super League",
    "den.1": "Danish Superliga",
    "swe.1": "Swedish Allsvenskan",
    "nor.1": "Norwegian Eliteserien",
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
    #
    # За последние 90 суток у всех четырёх ниже ноль матчей, и это НЕ повод их
    # убирать: они между сезонами. Последний матч — май 2026, групповой этап
    # начинается в конце сентября. Отличать такое от брошенного кода нужно по
    # ГОДОВОМУ окну, а не по трёхмесячному.
    "uefa.europa": "UEFA Europa League",
    "uefa.europa.conf": "UEFA Conference League",
    "conmebol.libertadores": "CONMEBOL Libertadores",
    "conmebol.sudamericana": "CONMEBOL Sudamericana",
    "concacaf.champions": "Concacaf Champions Cup",
    "afc.champions": "AFC Champions League Elite",
}

# ⚠️ ШЕСТЬ КОДОВ ОТВЕЧАЛИ 200 СВОИМ НАСТОЯЩИМ ИМЕНЕМ И НЕ ПУБЛИКОВАЛИ НИЧЕГО.
#
# Их пришлось СНЯТЬ со списка, и находка стоит того, чтобы остаться записанной:
# «код отзывается» и «по коду есть матчи» — разные утверждения, и проверка
# первого называет живым второе. Ровно та же форма ошибки, что с ТВ, где
# верхний манифест отвечал 200, а вариант под ним 404.
#
# Замер 13.09.2026, окно в ГОД (20250915-20260913), считаются ЗАВЕРШЁННЫЕ матчи:
#
#     tur.2  Turkish 1. Ligi           0 матчей за год
#     fin.1  Finnish Veikkausliga      0
#     cze.1  Gambrinus Liga            0   (season у ESPN вообще None)
#     isr.1  Israeli Premier League    0   (season 2024)
#     sui.1  Swiss Super League        8, последний 28.09.2025
#     irl.1  Irish Premier Division   35, последний 01.11.2025
#
# Все шесть играют прямо сейчас — просто не у ESPN. Это 1269 карточек колоды
# (Швейцария 337, Турция Д2 363, Финляндия 238, Чехия 148, Израиль 95,
# Ирландия 88), и притворяться, что расширение списка их покрыло, нельзя:
# им нужен другой источник, а не строка здесь.
#
# ОТЛИЧАТЬ БРОШЕННЫЙ КОД ОТ МЕЖСЕЗОНЬЯ НУЖНО ГОДОВЫМ ОКНОМ. По трёхмесячному
# пусты и кубки УЕФА, и тайская лига — а у них последний матч в мае 2026 и
# новый сезон на носу. Ни одна живая лига не молчит год; молчащий год — это
# источник, а не календарь. Проверку делает check-prod, раздел «Охват», и
# спрашивает он годовое окно ТОЛЬКО у тех лиг, что молчат последний месяц.

DELAY_SECONDS = 0.4

# ⚠️ ОКНО КАЛЕНДАРНЫМ МЕСЯЦЕМ, А НЕ ДИАПАЗОНОМ ДАТ. ЗДЕСЬ СТОЯЛО
# `dates=A-B`, И ESPN ПЕРЕСТАЛ ЭТО ПОНИМАТЬ — 400 НА КАЖДУЮ ЛИГУ, БЕЗ
# ИСКЛЮЧЕНИЙ. Поломка тихая вдвойне: `fetch_json` гасит не-200 (одна лига не
# должна валить прогон), а лига без событий печатается как «матчей 0» — то
# есть как межсезонье. Прогон CI 20.09.2026 закончился «success» со строкой
#
#     matches read: 0, rows for our cards: 0, players not in the deck: 0
#
# и так каждую ночь с 16 сентября: последний записанный матч из ESPN — 15-е,
# а 18 матчей Лиги Европы с 16-го не попали в базу вовсе.
#
# Замер по ответам ESPN 20.09.2026, три из трёх на каждом варианте:
#
#     dates=20260915              -> 200
#     dates=202609                -> 200
#     dates=2026                  -> 200
#     dates=20260914-20260915     -> 400 {"message":"Failed to get events endpoint."}
#     dates=20260817-20260915     -> 400
#     dates=202608-202609         -> 400
#
# Месяц взят вместо диапазона и проверен ТЕМ ЖЕ сравнением, что когда-то
# оправдало диапазон, — множествами id, а не количеством:
#
#     eng.1 2026-03   месяц 32   по дням 32   разность пуста в обе стороны
#     usa.1 2026-08   месяц 75   по дням 75   разность пуста в обе стороны
#     bra.1 2026-08   месяц 40   по дням 40   разность пуста в обе стороны
#
# usa.1 — самая плотная в списке, и 75 событий она отдаёт целиком: потолка на
# этих числах нет.
#
# Цена не выросла: месяц — это ОДИН запрос табло там, где раньше был один
# запрос диапазона, а дорогая часть обхода (summary на каждый матч) не
# изменилась, потому что события месяца отбираются по запрошенным суткам
# ниже.


def month_windows(days, today):
    """Месяцы `YYYYMM`, покрывающие последние `days` суток, от свежего к старому.

    Чистая функция: даты на вход, строки на выход — проверяется тестом без сети.
    """
    months = []
    day = today
    first = today - timedelta(days=days - 1)
    while day >= first:
        key = day.strftime("%Y%m")
        if key not in months:
            months.append(key)
        day -= timedelta(days=1)
    return months


def within_span(event_date, first, last):
    """Событие попало в запрошенные сутки? Границы расширены на день.

    ⚠️ ЗАПАС В СУТКИ ОБЯЗАТЕЛЕН, А НЕ АККУРАТЕН. Дата в табло — UTC по началу
    матча, а `parse_match_meta` берёт свою из карточки матча; на матче в 23:30Z
    это разные дни. Отбор без запаса выбросил бы ровно поздние матчи — те, что
    и так труднее всего заметить. Лишний день стоит нескольких запросов
    summary и ничего не портит: запись идёт upsert-ом по (карточка, дата,
    турнир).
    """
    if not event_date:
        return True
    return (first - timedelta(days=1)).isoformat() <= event_date <= (
        last + timedelta(days=1)
    ).isoformat()


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


def chosen_leagues(only):
    """Коды из `--leagues`, проверенные по списку. Пусто — значит все.

    ⚠️ ОПЕЧАТКА ЗДЕСЬ ОБЯЗАНА ПАДАТЬ, А НЕ МОЛЧА СУЖАТЬ ОБХОД. `--leagues
    eng.2,ita.9` с тихим пропуском второго кода отработал бы «успешно» по
    одной лиге вместо двух — ровно тот же тихий ноль, из-за которого вторые
    дивизионы годами стояли без статистики.
    """
    if not only:
        return list(LEAGUES)
    codes = [c.strip() for c in only.split(",") if c.strip()]
    unknown = [c for c in codes if c not in LEAGUES]
    if unknown:
        raise SystemExit("нет таких лиг в списке: {}".format(", ".join(unknown)))
    return codes


def collect(days, dry_run=False, only=None):
    # Список лиг разбирается ПЕРВЫМ: опечатка в `--leagues` не должна стоить
    # чтения двадцати трёх тысяч карточек, чтобы потом всё равно упасть.
    leagues = chosen_leagues(only)

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
    first_day = today - timedelta(days=days - 1)
    windows = month_windows(days, today)

    # ⚠️ ОДНА УПАВШАЯ ЛИГА НЕ УНОСИТ ОСТАЛЬНЫЕ. Прогон 13.09.2026 умер на
    # тринадцатой лиге из пятидесяти трёх — `player_match_stats upsert 504` —
    # и сорок минут работы кончились трассировкой. Повтор по 5xx добавлен там,
    # где ему место (Db.upsert), но повтор не бывает вечным: за ним обязан
    # стоять тот же барьер, что в football-fixtures, — падение ОДНОЙ лиги
    # стоит одной лиги. Список `failed` печатается в конце и даёт ненулевой
    # код возврата: молчаливый пропуск выглядел бы как лига без матчей, а это
    # и есть та самая тихая дыра, против которой обход и расширялся.
    total_rows, seen_events, unmatched, written_total = 0, 0, 0, 0
    failed = []
    for league in leagues:
        # ⚠️ СОБЫТИЯ СОБИРАЮТСЯ МНОЖЕСТВОМ, А НЕ СПИСКОМ. Соседние окна
        # смыкаются встык, но ESPN относит матч к дате НАЧАЛА по своему
        # часовому поясу, и матч на стыке попадает в оба ответа. Дубль стоил бы
        # лишнего запроса за summary — того самого, который в этом обходе и
        # есть почти вся цена.
        event_ids = []
        seen_ids = set()
        board_failed = False
        for month in windows:
            board = fetch_json(
                session,
                "{}/{}/scoreboard?dates={}&limit=1000".format(BASE, league, month))
            time.sleep(DELAY_SECONDS)
            if not board:
                # ⚠️ НЕ `continue`. Здесь и была тихая дыра: табло, ответившее
                # не-200, давало «матчей 0», неотличимое от межсезонья, — и
                # прогон, не принёсший НИ ОДНОЙ строки за всю ночь, выходил с
                # нулём и зелёной галочкой в CI. Молчание источника обязано
                # стоить лиги в списке `failed` и ненулевого кода возврата,
                # ровно как молчание записи ниже.
                board_failed = True
                continue
            for event_id, event_date in completed_events(board):
                if event_id in seen_ids:
                    continue
                if not within_span(event_date, first_day, today):
                    continue
                seen_ids.add(event_id)
                event_ids.append(event_id)
        if board_failed:
            # Месяц мог не ответить один из трёх — то, что пришло, пишется:
            # upsert идемпотентен, и выбросить готовые строки ради красоты
            # отчёта значило бы наказать лигу за чужой сбой. Но в `failed`
            # она попадает, и прогон кончится ненулевым кодом.
            print("  !! {}: табло ответило не на все месяцы".format(league))
            failed.append(league)

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
            try:
                written_total += write_rows(db, rows)
            except Exception as err:  # noqa: BLE001 — причина печатается рядом
                print("  !! {} не записана: {}".format(league, str(err)[:200]))
                failed.append(league)

    print("matches read: {}, rows for our cards: {}, players not in the deck: {}"
          .format(seen_events, total_rows, unmatched))
    if dry_run:
        return 0
    print("written: {}".format(written_total))
    if failed:
        print("НЕ ЗАПИСАНЫ: {}".format(", ".join(failed)))
        return 1
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=2,
                    help="сколько последних суток обойти (по умолчанию вчера и сегодня)")
    ap.add_argument("--dry-run", action="store_true")
    # Чинить прогон, упавший на трёх лигах, повтором всего списка — это час
    # чужого трафика за пять минут работы.
    ap.add_argument("--leagues", default=None,
                    help="только эти коды через запятую (по умолчанию все)")
    args = ap.parse_args()
    print("=== espn player stats, {} ===".format(date.today().isoformat()))
    return collect(max(1, args.days), args.dry_run, args.leagues)


if __name__ == "__main__":
    sys.exit(main())
