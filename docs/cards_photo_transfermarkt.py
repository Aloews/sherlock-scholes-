# -*- coding: utf-8 -*-
"""Фото игрока — портрет с его профиля на Transfermarkt, по id.

ИСТОЧНИК НАЗВАН ПРЯМО, И ЭТО НАМЕРЕННО. Портреты берутся с transfermarkt.com,
ссылка ведёт на их же CDN (`img.a.transfermarkt.technology`) — то есть
происхождение видно прямо в адресе картинки и не спрятано. Владелец решение по
этому источнику принимал осознанно и повторял: «бери рейтинг и важную
информацию с трансфермаркет», «маскировать происхождение данных НЕ НАДО».
Точно так же в этом проекте уже показываются эмблемы клубов с CDN ESPN.

ЗАЧЕМ ЕЩЁ ОДИН СБОРЩИК ФОТО. Викиданные закрывают меньшинство: замер
06.09.2026 — активных игроков 19 115, фото у 4391 (23%). Вторая картинка из
Википедии («первая картинка статьи») дыру НЕ закрывает, и это тоже замер, а не
догадка: из 132 статей игроков без P18 картинка нашлась в ОДНОЙ. Причина
понятна — P18 в Викиданных заполняется ботами из картинки статьи, так что
«нет P18» почти всегда значит «в статье её тоже нет».

Профиль на Transfermarkt есть у 8812 карточек (у них проставлен
`transfermarkt_id`), и портрет там почти всегда: проба на 12 безвестных
игроках из ростера — 11 портретов и одна заглушка.

⚠️ ЗАГЛУШКА ОТСЕИВАЕТСЯ, А НЕ ЗАПИСЫВАЕТСЯ. У игрока без фотографии TM отдаёт
`portrait/big/default.jpg` — один и тот же силуэт на всех. Записать его значит
объявить, что фото есть: карточка выглядела бы заполненной, а в игре стоял бы
серый человечек, и починить это потом было бы нечем — по URL уже не отличить
«не собрали» от «собрали заглушку».

⚠️ АДРЕС НЕ КОНСТРУИРУЕТСЯ, А ЧИТАЕТСЯ. В имени файла стоит отметка времени
(`574671-1757664768.jpg`), и угадать её нельзя — поэтому один запрос на игрока.
Отсюда и темп: 1.5 с между запросами, как у сборщика составов.

⚠️ ПУСТОЕ ПОЛЕ ЧЕСТНЕЕ ЧУЖОГО ФОТО. Ничего не перезаписывается: пишем только
туда, где `photo_url is null`, и условие стоит В ЗАПРОСЕ на запись, а не
только в выборке.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет):
    python docs/cards_photo_transfermarkt.py --limit 50
    APPLY=1 python docs/cards_photo_transfermarkt.py
"""
import argparse
import json
import os
import re
import time
import urllib.parse
import urllib.request

UA = ("SherlockScholesBot/1.0 "
      "(+https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
PROFILE = "https://www.transfermarkt.com/spieler/profil/spieler/%s"
PAUSE = 1.5
RETRIES = 3
PAGE = 1000
WRITE_BATCH = 25

OG_IMAGE = re.compile(r'<meta property="og:image" content="([^"]+)"')
# Заглушка у TM называется default/dummy — проверяем ИМЯ ФАЙЛА, а не весь
# адрес: в адресе есть и `lm=4711`, и путь, где слово «default» может
# встретиться по другому поводу.
PLACEHOLDER = re.compile(r'/(default|dummy)[^/]*\.[a-z]+$', re.I)


def sb(path, method="GET", body=None, params=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    key = os.environ["SUPABASE_KEY"]
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "apikey": key, "Authorization": "Bearer " + key,
        "Content-Type": "application/json", "Prefer": "return=minimal"})
    with urllib.request.urlopen(req, timeout=180) as fh:
        raw = fh.read()
    return json.loads(raw) if raw else []


def read_all(path, params):
    """PostgREST режет по db-max-rows=1000 — без страниц теряется хвост."""
    out, offset = [], 0
    while True:
        page = sb(path, params=dict(params, limit=PAGE, offset=offset))
        out.extend(page)
        if len(page) < PAGE:
            return out
        offset += PAGE


def portrait_url(html):
    """Адрес портрета со страницы профиля — или None.

    ЧИСТАЯ ФУНКЦИЯ, и её проверяет тест: заглушку она обязана отвергать, иначе
    в колоду попадёт серый силуэт под видом фотографии.
    """
    m = OG_IMAGE.search(html or "")
    if not m:
        return None
    url = m.group(1).strip()
    if not url:
        return None
    path = urllib.parse.urlparse(url).path
    if PLACEHOLDER.search(path):
        return None
    return url


def get(url):
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept-Language": "en"})
            with urllib.request.urlopen(req, timeout=60) as fh:
                return fh.read().decode("utf-8", "replace")
        except Exception:                                        # noqa: BLE001
            if attempt + 1 == RETRIES:
                return None
            time.sleep(PAUSE * 3 * (attempt + 1))
    return None


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="сколько карточек (0 — все)")
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY")):
        raise SystemExit("нужны SUPABASE_URL и SUPABASE_KEY")

    # ⚠️ ТОЛЬКО ИГРОКИ. У клуба на TM своя эмблема, но эмблемы в этом проекте
    # берутся с ESPN и решение это принято владельцем; подменять их отсюда
    # значило бы откатывать его молча.
    rows = read_all("cards", {"select": "id,name,name_en,transfermarkt_id",
                              "category": "eq.player", "active": "is.true",
                              "photo_url": "is.null",
                              "transfermarkt_id": "not.is.null",
                              "order": "id"})
    if args.limit:
        rows = rows[:args.limit]
    print("Карточек без фото, но с id на Transfermarkt: %d  (APPLY=%s)"
          % (len(rows), "да" if apply_ else "нет — сухой прогон"), flush=True)
    if not rows:
        return

    found = placeholder = lost = written = 0
    batch = []

    def flush():
        """Запись ПО ХОДУ: оборванный прогон обязан оставить сделанное."""
        nonlocal batch, written
        if apply_:
            for card_id, url in batch:
                sb("cards", method="PATCH",
                   params={"id": "eq." + card_id, "photo_url": "is.null"},
                   body={"photo_url": url})
                written += 1
        batch = []

    for i, card in enumerate(rows, 1):
        html = get(PROFILE % card["transfermarkt_id"])
        if html is None:
            lost += 1
        else:
            url = portrait_url(html)
            if url:
                found += 1
                batch.append((card["id"], url))
            elif OG_IMAGE.search(html):
                placeholder += 1
        if len(batch) >= WRITE_BATCH:
            flush()
        if i % 25 == 0:
            print("  %d/%d, портретов %d, заглушек %d, потеряно %d"
                  % (i, len(rows), found, placeholder, lost), flush=True)
        time.sleep(PAUSE)

    flush()
    print("-" * 70)
    print("Портретов найдено : %d" % found)
    print("Заглушек отвергнуто: %d" % placeholder)
    print("Записано          : %d" % written)
    if lost:
        # ⚠️ Потеря — это НЕ «фото нет». Пустота непрочитанной страницы ничего
        # не значит, и прогон надо повторить.
        print("⚠️ ПРОФИЛЕЙ ПОТЕРЯНО: %d — повторить прогон" % lost)
    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")


if __name__ == "__main__":
    main()
