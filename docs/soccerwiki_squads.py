# -*- coding: utf-8 -*-
"""Составы всех клубов мира — с en.soccerwiki.org, по странам.

ИСТОЧНИК НАЗВАН ПРЯМО: en.soccerwiki.org, «for the fans, by the fans».
Владелец: «ты пропустил самый важный источник данных, фото статистики и
характеристики… настрой парсеры на сбор всех команд с составами, разбитых по
континентам».

ЦЕПОЧКА, ЗАМЕРЕННАЯ НА ЖИВЫХ СТРАНИЦАХ 06.09.2026:

    /country.php                 240 стран, код трёхбуквенный (ARG, ENG…)
    /country.php?countryId=ENG   182 клуба одной Англии, ссылками на состав
    /squad.php?clubid=1          состав: номер, имя, позиция, возраст, РЕЙТИНГ

⚠️ ОДИН ЗАПРОС НА КЛУБ, А НЕ НА ИГРОКА. Позиция, возраст и рейтинг стоят на
странице клуба — то есть полный состав с характеристиками стоит один запрос.
Страница игрока (рост, вес, нога, фото) нужна отдельно и не здесь: сначала
надо знать, кого спрашивать.

⚠️ КОНТИНЕНТ ЗДЕСЬ НЕ СЧИТАЕТСЯ, И ЭТО НАМЕРЕННО. У источника его нет: слов
«Europe», «Asia», «Oceania» на странице стран нет вовсе — проверено поиском.
У проекта своя карта «страна → континент» (та, что заполняет
`cards.continent`), и вторая её копия разошлась бы молча. Здесь хранится код
страны, группировку делает база.

⚠️ СОПОСТАВЛЯЕТ КЛУБЫ SQL, А НЕ ЭТОТ ФАЙЛ. `resolve_club_key` со словарём
псевдонимов живёт в базе; питон отдаёт название как есть.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет):
    python docs/soccerwiki_squads.py --countries ENG,ESP --limit-clubs 3
    APPLY=1 python docs/soccerwiki_squads.py
"""
import argparse
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from _sb import sb  # общий транспорт: с повторами на обрыве

UA = ("SherlockScholesBot/1.0 "
      "(+https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
BASE = "https://en.soccerwiki.org"
PAUSE = 1.0
RETRIES = 3

COUNTRY_LINK = re.compile(r'href="/country\.php\?countryId=([A-Za-z0-9_-]+)"[^>]*>\s*([^<]{2,60}?)\s*<')
CLUB_LINK = re.compile(r'href="/squad\.php\?clubid=(\d+)"[^>]*>\s*([^<]{2,60}?)\s*<')
# Строка состава: одна <tr>, внутри ссылка на игрока. Ячейки разбираем ниже —
# их семь, и порядок проверен тестом на живой разметке.
SQUAD_ROW = re.compile(r'<tr[^>]*>(?:(?!</tr>).)*?player\.php\?pid=\d+(?:(?!</tr>).)*?</tr>', re.S)
PID = re.compile(r'player\.php\?pid=(\d+)')
CELL = re.compile(r'<td[^>]*>(.*?)</td>', re.S)


def text_of(html):
    """Текст ячейки без разметки. ЧИСТАЯ ФУНКЦИЯ."""
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', html or '')).strip()


# Разумный потолок для номера, возраста и рейтинга. Всё, что больше, —
# признак того, что в ячейке лежало не число, а что-то ещё.
INT_MAX = 100000


def to_int(value):
    """ПЕРВОЕ целое в ячейке или None.

    ⚠️ НЕ «ВСЕ ЦИФРЫ ПОДРЯД». Первая версия вырезала из ячейки все нецифры и
    склеивала остаток — и на живой странице это дало номер игрока
    «2126880700002480080700»: Postgres ответил «out of range for type
    integer», и пачка не записалась ЦЕЛИКОМ. В ячейке рядом с числом бывает и
    подпись, и alt картинки, и второе число.

    Пустая ячейка — это НЕ ноль: ноль означал бы «измерено и равно нулю».
    """
    m = re.search(r'\d+', value or '')
    if not m:
        return None
    n = int(m.group(0))
    return n if n <= INT_MAX else None


def parse_countries(html):
    """[(код, название)] со страницы стран. ЧИСТАЯ ФУНКЦИЯ — её проверяет тест."""
    seen, out = set(), []
    for code, name in COUNTRY_LINK.findall(html or ''):
        if code in seen:
            continue
        seen.add(code)
        out.append((code, name.strip()))
    return out


def parse_clubs(html):
    """[(id клуба, название)] со страницы страны. ЧИСТАЯ ФУНКЦИЯ."""
    seen, out = set(), []
    for cid, name in CLUB_LINK.findall(html or ''):
        club_id = int(cid)
        if club_id in seen:
            continue
        seen.add(club_id)
        out.append((club_id, name.strip()))
    return out


def parse_squad(html):
    """Состав со страницы клуба. ЧИСТАЯ ФУНКЦИЯ — её проверяет тест.

    ⚠️ ПОРЯДОК ЯЧЕЕК ЗАМЕРЕН, А НЕ УГАДАН (06.09.2026, «Арсенал»):
        0 номер | 1 пусто | 2 флаг | 3 имя | 4 позиция | 5 возраст | 6 рейтинг

    Строка с другим числом ячеек ПРОПУСКАЕТСЯ, а не разбирается наугад:
    разметка поменяется — состав станет пустым, и это будет видно числом, а не
    молча заполнит колоду мусором.
    """
    out = []
    for row in SQUAD_ROW.findall(html or ''):
        pid = PID.search(row)
        cells = CELL.findall(row)
        if not pid or len(cells) < 7:
            continue
        name = text_of(cells[3])
        if not name:
            continue
        out.append({
            "pid": int(pid.group(1)),
            "name": name,
            "shirt_number": to_int(text_of(cells[0])),
            "position": text_of(cells[4]) or None,
            "age": to_int(text_of(cells[5])),
            "rating": to_int(text_of(cells[6])),
        })
    return out


def get(url):
    """Страница или None. Потеря — это НЕ пустая страница, и считается отдельно."""
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept-Language": "en"})
            with urllib.request.urlopen(req, timeout=60) as fh:
                return fh.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return ""
            if attempt + 1 == RETRIES:
                return None
        except Exception:                                        # noqa: BLE001
            if attempt + 1 == RETRIES:
                return None
        time.sleep(PAUSE * 3 * (attempt + 1))
    return None


def sb_rpc(name, body):
    """Вызов RPC. ⚠️ ТЕЛО ОШИБКИ ПЕЧАТАЕТСЯ, А НЕ ГЛОТАЕТСЯ.

    Голый «HTTP Error 400» не говорит НИЧЕГО о том, что не так с пачкой, и
    отладка такого стоит прогона: первый живой обход упал дважды, и оба раза
    причина была в теле ответа, которого не было видно.

    ⚠️ ОБРЫВ СВЯЗИ — НЕ ОТКАЗ СЕРВЕРА, И ЭТОТ ОБХОД НА НЁМ УЖЕ УМИРАЛ. Прогон
    шёл час и оборвался на `[SSL: UNEXPECTED_EOF_WHILE_READING]`: сервер
    ничего не ответил, а сборщик умер вместе с соединением. Повторы живут в
    общем транспорте `_sb.sb`, там же и печать тела ошибки.
    """
    return sb("rpc/" + name, method="POST", body=body)


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--countries", default="", help="коды через запятую (по умолчанию все)")
    ap.add_argument("--limit-clubs", type=int, default=0, help="сколько клубов на страну")
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"
    if apply_ and not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY")):
        raise SystemExit("APPLY=1, но SUPABASE_URL/SUPABASE_KEY не заданы")

    index = get(BASE + "/country.php")
    if index is None:
        raise SystemExit("страница стран не ответила — прогон не начат")
    countries = parse_countries(index)
    wanted = {c.strip().upper() for c in args.countries.split(",") if c.strip()}
    if wanted:
        countries = [c for c in countries if c[0].upper() in wanted]
    print("Стран к обходу: %d  (APPLY=%s)"
          % (len(countries), "да" if apply_ else "нет — сухой прогон"), flush=True)

    clubs_seen = players_seen = linked = lost = 0
    for i, (code, cname) in enumerate(countries, 1):
        page = get("%s/country.php?countryId=%s" % (BASE, urllib.parse.quote(code)))
        if page is None:
            lost += 1
            print("  ⚠️ страна %s не ответила — её пустота НИЧЕГО не значит" % code, flush=True)
            continue
        clubs = parse_clubs(page)
        if args.limit_clubs:
            clubs = clubs[:args.limit_clubs]
        time.sleep(PAUSE)

        for club_id, club_name in clubs:
            squad_html = get("%s/squad.php?clubid=%d" % (BASE, club_id))
            if squad_html is None:
                lost += 1
                continue
            rows = parse_squad(squad_html)
            clubs_seen += 1
            players_seen += len(rows)
            if apply_ and rows:
                res = sb_rpc("apply_soccerwiki_squad", {
                    "p_club_id": club_id, "p_name": club_name,
                    "p_country": code, "p_rows": rows})
                if res:
                    linked += res[0].get("linked", 0)
            time.sleep(PAUSE)

        print("[%d/%d] %-24s клубов %d, игроков всего %d, связано %d"
              % (i, len(countries), cname[:24], len(clubs), players_seen, linked), flush=True)

    print("-" * 70)
    print("Клубов разобрано : %d" % clubs_seen)
    print("Игроков          : %d" % players_seen)
    print("Связано с колодой: %d" % linked)
    if lost:
        print("⚠️ СТРАНИЦ ПОТЕРЯНО: %d — их пустота НИЧЕГО не значит, повторить" % lost)
    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")


if __name__ == "__main__":
    main()
