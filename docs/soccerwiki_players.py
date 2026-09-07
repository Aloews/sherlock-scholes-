# -*- coding: utf-8 -*-
"""Страницы игроков Soccer Wiki: рост, вес, нога, ДАТА РОЖДЕНИЯ, фото.

ИСТОЧНИК НАЗВАН ПРЯМО: en.soccerwiki.org, «for the fans, by the fans».

ВТОРОЙ ЗАХОД ПОСЛЕ СОСТАВОВ, И ВОТ ПОЧЕМУ. `soccerwiki_squads.py` рядом берёт
со страницы клуба ВСЁ, что там есть, одним запросом на весь состав: номер,
позицию, возраст, рейтинг. Роста, ноги и даты рождения там нет ВОВСЕ — они
живут только на /player.php?pid=…, и это запрос на игрока. Поэтому здесь идут
только те, кто связан с карточкой колоды: 12 814 запросов вместо 49 923.

ЧТО ОТДАЁТ СТРАНИЦА, ЗАМЕРЕНО 07.09.2026 НА pid=147713:

    Full Name: Ângelo Samuel Chaves | Position: D,DM,M(L) | Rating: 68
    Age: 25 (Feb 10, 2001) | Nation: Brazil | Height (cm): 182
    Weight (kg): 81 | Preferred Foot: Left | Position Desc: Wingback

⚠️ РАЗМЕТКА ОДНОРОДНА, И ЭТО ЕДИНСТВЕННАЯ ПРИЧИНА, ПО КОТОРОЙ РАЗБОР НАДЁЖЕН:
каждый факт — это `<p class="player-info-subtitle"><span class="text-dark">
Подпись:</span> значение</p>`. Разбор идёт ПО ПОДПИСИ, а не по порядку: на
странице вратаря нет «Preferred Foot», и счёт по позиции сдвинул бы всё
следующее. Подпись пропала — поле пусто, и это видно числом в отчёте.

⚠️ ЗАГЛУШКА ФОТО ОТСЕИВАЕТСЯ ПО ИМЕНИ ФАЙЛА. Отсутствующий портрет приходит
как `missing_player.png` — картинкой, а не пустотой. Записать её значило бы
раздать всей колоде один и тот же серый силуэт как «фото с Soccer Wiki».

⚠️ ДАТУ РОЖДЕНИЯ В `cards` КЛАДЁТ SQL И ТОЛЬКО ТАМ, ГДЕ ЕЁ НЕТ. Порядок
источников — Викиданные, потом Transfermarkt, и только потом правки читателей.
Решение записано в `supabase/migrations/soccerwiki_detail.sql`, второй его
копии здесь нет.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет):
    python docs/soccerwiki_players.py --limit 20
    APPLY=1 python docs/soccerwiki_players.py --minutes 150
"""
import argparse
import json
import os
import sys
import re
import time
import urllib.error
import urllib.parse
import urllib.request

# ⚠️ СВОЙ КАТАЛОГ В ПУТЬ — ЯВНО. Тесты грузят файл ПО ПУТИ
# (spec_from_file_location), и тогда `import _sb` падает ModuleNotFoundError.
# Именно так и упал CI.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _sb import sb, all_rows  # общий транспорт: с повторами на обрыве

UA = ("SherlockScholesBot/1.0 "
      "(+https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
BASE = "https://en.soccerwiki.org"
PAUSE = 1.0
RETRIES = 3
BATCH = 100

# Факт на странице игрока: подпись в <span class="text-dark">, значение — до
# конца абзаца. Ключ ищется по подписи, поэтому порядок абзацев не важен.
FACT = re.compile(
    r'<span class="text-dark">\s*([^<:]{2,40}?)\s*:\s*</span>(.*?)</p>', re.S)
NATION_CODE = re.compile(r'country\.php\?countryId=([A-Za-z0-9_-]{2,8})')
# Портрет: единственный <img> внутри блока player-img.
PHOTO = re.compile(r'class="[^"]*player-img[^"]*".*?data-src="([^"]+)"', re.S)
# «25 (Feb 10, 2001)» — возраст и дата в одной ячейке.
BORN = re.compile(r'([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})')

MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def text_of(html):
    """Текст без разметки и без &nbsp;. ЧИСТАЯ ФУНКЦИЯ."""
    s = re.sub(r'<[^>]+>', ' ', html or '')
    s = s.replace('&nbsp;', ' ').replace('&amp;', '&')
    return re.sub(r'\s+', ' ', s).strip()


def to_int(value):
    """ПЕРВОЕ целое или None. Пустое — это НЕ ноль.

    ⚠️ НЕ «ВСЕ ЦИФРЫ ПОДРЯД»: соседний сборщик на этом уже получил номер
    «2126880700002480080700» и уронил всю пачку «out of range for integer».
    """
    m = re.search(r'\d+', value or '')
    if not m:
        return None
    n = int(m.group(0))
    return n if n <= 100000 else None


def parse_born(value):
    """«25 (Feb 10, 2001)» → '2001-02-10'. ЧИСТАЯ ФУНКЦИЯ — её проверяет тест.

    Возраст без даты («25») даёт None, а не «сегодня минус 25 лет»: вычисленная
    дата рождения выглядит на экране точно так же, как настоящая.
    """
    m = BORN.search(value or '')
    if not m:
        return None
    month = MONTHS.get(m.group(1))
    day, year = int(m.group(2)), int(m.group(3))
    if not month or not 1 <= day <= 31 or not 1900 <= year <= 2020:
        return None
    return "%04d-%02d-%02d" % (year, month, day)


def parse_detail(html):
    """Факты со страницы игрока. ЧИСТАЯ ФУНКЦИЯ — её проверяет тест.

    Возвращает словарь без pid: pid известен вызывающему, и брать его из
    страницы значило бы поверить, что редирект привёл туда, куда просили.
    """
    facts = {}
    for label, value in FACT.findall(html or ''):
        facts.setdefault(label.strip().lower(), value)

    def raw(*keys):
        for k in keys:
            if k in facts:
                return facts[k]
        return ""

    def val(*keys):
        return text_of(raw(*keys))

    nation_raw = raw("nation", "nationality")
    code = NATION_CODE.search(nation_raw)
    photo = PHOTO.search(html or '')
    photo_url = photo.group(1).strip() if photo else None
    # Серый силуэт — это отсутствие фото, а не фото.
    if photo_url and ("missing_player" in photo_url or "spacer.gif" in photo_url):
        photo_url = None

    unknown = ("unknown", "n/a", "-", "")
    foot = val("preferred foot", "foot")
    pos_desc = val("position desc", "position description")
    return {
        "full_name":     val("full name") or None,
        "born_on":       parse_born(val("age", "date of birth", "born")),
        "nation":        text_of(nation_raw) or None,
        "nation_code":   code.group(1).upper() if code else None,
        "height_cm":     to_int(val("height (cm)", "height")),
        "weight_kg":     to_int(val("weight (kg)", "weight")),
        "foot":          None if foot.lower() in unknown else foot,
        "position_desc": None if pos_desc.lower() in unknown else pos_desc,
        "photo_url":     photo_url,
    }


def get(url):
    """Страница, '' на 404 или None на потере. Потеря считается отдельно."""
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


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="сколько игроков за прогон")
    ap.add_argument("--minutes", type=float, default=0,
                    help="потолок по часам: дойдя до него, дописать пачку и выйти")
    ap.add_argument("--refresh", action="store_true",
                    help="перечитать и тех, у кого страница уже прочитана")
    args = ap.parse_args()
    apply = os.environ.get("APPLY") == "1"
    deadline = time.time() + args.minutes * 60 if args.minutes > 0 else None

    # ⚠️ ТОЛЬКО СВЯЗАННЫЕ С КОЛОДОЙ, И ПО УБЫВАНИЮ РЕЙТИНГА. Прогон длинный, и
    # оборваться он может на любом месте; порядок решает, чьи карточки успеют
    # получить рост и дату — Салаха или четвёртого вратаря третьего дивизиона.
    params = {"select": "pid,name,rating",
              "card_id": "not.is.null",
              "order": "rating.desc.nullslast,pid.asc"}
    if not args.refresh:
        params["detail_at"] = "is.null"
    todo = all_rows("soccerwiki_player", params)
    if args.limit > 0:
        todo = todo[:args.limit]
    print("страниц к чтению: %d%s" % (len(todo), "" if apply else "  (СУХОЙ ПРОГОН)"))

    batch, done, empty, lost, saved, born = [], 0, 0, 0, 0, 0

    def flush():
        nonlocal batch, saved, born
        if not batch:
            return
        if apply:
            res = sb("rpc/apply_soccerwiki_details", method="POST",
                     body={"p_rows": batch})
            row = (res or [{}])[0] if isinstance(res, list) else {}
            saved += int(row.get("saved") or 0)
            born += int(row.get("born_filled") or 0)
        batch = []

    for row in todo:
        pid = row["pid"]
        html = get("%s/player.php?pid=%d" % (BASE, pid))
        done += 1
        if html is None:
            lost += 1
        elif not html.strip():
            empty += 1
        else:
            fact = parse_detail(html)
            # Пустая страница по фактам — тоже пустая: писать десять NULL и
            # ставить detail_at значило бы «прочитано» там, где не прочитано.
            if any(fact.get(k) for k in ("full_name", "born_on", "height_cm")):
                fact["pid"] = pid
                batch.append(fact)
            else:
                empty += 1
        if len(batch) >= BATCH:
            flush()
        if done % 50 == 0:
            print("  %d/%d, записано %d, дат рождения +%d, пусто %d, потеряно %d"
                  % (done, len(todo), saved, born, empty, lost), flush=True)
        if deadline and time.time() > deadline:
            print("  потолок по часам", flush=True)
            break
        time.sleep(PAUSE)

    flush()
    print("ИТОГ: прочитано %d, записано %d, дат рождения +%d, пусто %d, потеряно %d"
          % (done, saved, born, empty, lost))
    return 0


if __name__ == "__main__":
    sys.exit(main())
