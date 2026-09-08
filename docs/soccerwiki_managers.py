# -*- coding: utf-8 -*-
"""Тренеры клубов с Soccer Wiki: кто ведёт команду сегодня.

ИСТОЧНИК НАЗВАН ПРЯМО: en.soccerwiki.org, «for the fans, by the fans».

Владелец: «добавь тренеров всех команд и их характера, а также анализ
положения их команд… историю противостояний стоит взять у тренеров, а не
команд, там больше пересечений».

ЧТО СТРАНИЦА КЛУБА ОТДАЁТ, ЗАМЕРЕНО 08.09.2026 НА clubid=2 («Астон Вилла»):

    <span class="text-dark">Manager</span>
    <a href="/country.php?countryId=ESP">…</a>
    <a href="/football-manager.php?mid=172">Unai Emery</a>
    <span class="text-dark">Age:</span> 54
    …/images/manager/172.png

То есть имя, идентификатор тренера, страна, возраст и портрет — всё на той же
странице, что и состав. Отдельный запрос на тренера нужен только за датой
рождения: /football-manager.php?mid=172 даёт «Date Of Birth Nov 3, 1971».

⚠️ ЧЕГО НА SOCCER WIKI НЕТ ВОВСЕ, И ЭТО ВАЖНО ЗНАТЬ ЗАРАНЕЕ:
  * ДОСТИЖЕНИЙ И ТРОФЕЕВ. Страница тренера — это имя, дата рождения, страна,
    текущий клуб и флажок «Retired». Ни одного турнира.
  * ИСТОРИИ НАЗНАЧЕНИЙ. Отдаётся только СЕГОДНЯШНИЙ тренер клуба. Значит
    «историю противостояний тренеров» построить задним числом НЕЛЬЗЯ — её
    можно только накапливать с первого сбора, сравнивая с прошлым.
    Ровно для этого заведена `club_manager_spell`, и она честно покрывает
    время С НАЧАЛА НАБЛЮДЕНИЯ, а не карьеру.
  * ХАРАКТЕРА. Его на свете нигде нет фактом. Считать его надо из игры
    команды под этим тренером — и пересчитывать, потому что владелец прав:
    «характеры тренеров меняются со временем».

⚠️ РАЗБОР ПО ПОДПИСИ, А НЕ ПО ПОРЯДКУ. У клуба без тренера блока нет вовсе, и
счёт по позиции сдвинул бы всё следующее. Подпись пропала — тренера нет, и это
видно числом в отчёте.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет):
    python docs/soccerwiki_managers.py --limit 20
    APPLY=1 python docs/soccerwiki_managers.py --limit 400 --born
"""
import argparse
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _sb import sb, all_rows  # общий транспорт: с повторами на обрыве

UA = ("SherlockScholesBot/1.0 "
      "(+https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
BASE = "https://en.soccerwiki.org"
PAUSE = 1.0
RETRIES = 3

# Блок тренера на странице клуба: подпись «Manager», затем страна и ссылка с
# идентификатором. Всё в пределах одного куска разметки, поэтому берётся одним
# выражением — но ИМЕННО от подписи, а не от начала страницы.
MANAGER = re.compile(
    r'<span class="text-dark">\s*Manager\s*</span>.{0,600}?'
    r'football-manager\.php\?mid=(\d+)"[^>]*>([^<]{2,60})</a>', re.S)
MGR_COUNTRY = re.compile(
    r'<span class="text-dark">\s*Manager\s*</span>.{0,400}?'
    r'countryId=([A-Za-z]{2,4})', re.S)
MGR_PHOTO = re.compile(r'data-src="([^"]*images/manager/\d+\.[a-z]{3,4})"')
# ⚠️ ИЩЕТСЯ В ТЕКСТЕ БЕЗ РАЗМЕТКИ. Первая версия пыталась перешагнуть теги
# прямо в выражении (`</?[^>]*>?`) — и не находила ничего, потому что этот
# кусок требовал литеральный `<`, которого после снятия тегов уже нет.
BORN = re.compile(r'Date Of Birth\s+([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})')
MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def fetch(url):
    """Страница текстом. Обрыв — повтор; 404 — пусто, а не падение."""
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return ""
            if attempt == RETRIES - 1:
                raise
        except Exception:
            if attempt == RETRIES - 1:
                raise
        time.sleep(PAUSE * (attempt + 2))
    return ""


def parse_manager(html):
    """(mid, имя, страна, фото) со страницы клуба. ЧИСТАЯ ФУНКЦИЯ."""
    m = MANAGER.search(html or "")
    if not m:
        return None
    mid, name = int(m.group(1)), re.sub(r"\s+", " ", m.group(2)).strip()
    if not name:
        return None
    c = MGR_COUNTRY.search(html)
    p = MGR_PHOTO.search(html)
    photo = p.group(1) if p else None
    # Заглушки у тренеров те же, что у игроков: серый силуэт вместо портрета.
    if photo and re.search(r'missing|spacer|placeholder', photo):
        photo = None
    return mid, name, (c.group(1) if c else None), photo


def parse_born(html):
    """Дата рождения со страницы тренера, или None. ЧИСТАЯ ФУНКЦИЯ."""
    m = BORN.search(re.sub(r'<[^>]+>', ' ', html or ''))
    if not m:
        return None
    mon = MONTHS.get(m.group(1))
    return f"{int(m.group(3)):04d}-{mon:02d}-{int(m.group(2)):02d}" if mon else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--born", action="store_true",
                    help="дополнительный запрос на страницу тренера за датой рождения")
    args = ap.parse_args()
    apply = os.environ.get("APPLY") == "1"

    # Порядок обхода — от сильных клубов к слабым: если сбор прервут, тренеры
    # будут у тех команд, чьи матчи вообще кто-то смотрит.
    clubs = all_rows("soccerwiki_club", {
        "select": "club_id,name,club_key",
        "club_key": "not.is.null",
        "order": "club_id.asc",
    })
    known = {r["club_key"] for r in all_rows("football_club", {"select": "club_key"})}
    clubs = [c for c in clubs if c["club_key"] in known][: args.limit]

    found = missing = wrote = 0
    for i, c in enumerate(clubs, 1):
        html = fetch(f"{BASE}/squad.php?clubid={c['club_id']}")
        got = parse_manager(html)
        if not got:
            missing += 1
            continue
        mid, name, country, photo = got
        found += 1
        born = None
        if args.born:
            time.sleep(PAUSE)
            born = parse_born(fetch(f"{BASE}/football-manager.php?mid={mid}"))
        line = f"{i}/{len(clubs)} {c['name']}: {name} ({country or '—'}, {born or 'др неизв'})"
        if apply:
            # ⚠️ ИДЕНТИФИКАТОР КЛУБА ИСТОЧНИКА ПЕРЕДАЁТСЯ НАРОЧНО. Под одним
            # нашим ключом может лежать НЕСКОЛЬКО клубов Soccer Wiki:
            # «Barcelona SC» (Эквадор) свернулась в тот же `barcelona`, что и
            # каталонская. Без этого поля сборщик писал тренера каждого по
            # очереди, и «Барселону» возглавлял тренер эквадорцев — 22 ключа
            # собирают на себя 47 клубов источника. Кто главный клуб ключа,
            # решает SQL: по числу связанных с колодой игроков.
            res = sb("rpc/apply_club_manager", "POST", {
                "p_club_key": c["club_key"], "p_sw_mid": mid, "p_name": name,
                "p_country": country, "p_born_on": born, "p_photo_url": photo,
                "p_sw_club_id": c["club_id"],
            })
            wrote += 1
            print(f"{line} — {res}")
        else:
            print(line)
        time.sleep(PAUSE)

    print(f"\nклубов обойдено {len(clubs)}, тренер найден {found}, "
          f"без тренера {missing}, записано {wrote}"
          f"{' (сухой прогон)' if not apply else ''}")


if __name__ == "__main__":
    main()
