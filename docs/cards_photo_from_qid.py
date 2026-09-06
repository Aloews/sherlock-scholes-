# -*- coding: utf-8 -*-
"""Фото карточке — по её собственному QID, без единого сравнения имён.

ЗАЧЕМ ЕЩЁ ОДИН. `cards_photo_by_qid.py` берёт QID из `players_meta` и
находит карточку ПО ИМЕНИ. У карточек, заведённых из составов, записи в
`players_meta` нет вовсе, зато `cards.wikidata_qid` проставлен обратным
поиском по id на Transfermarkt — то есть идентификатором. Отсюда и берём.

Замер 06.09.2026: из 10 465 активных игроков фото было у 2693, а QID без
фото — у 7685.

ЦЕПОЧКА: cards.wikidata_qid → P18 → Commons Special:FilePath?width=400

ДВА ИСТОЧНИКА, И ВТОРОЙ РАЗРЕШЁН ТОЛЬКО ИГРОКАМ:

    1. P18 — «изображение объекта» по построению, годится кому угодно;
    2. pageimage — «первая картинка статьи», ТОЛЬКО карточке игрока.

⚠️ ПОЧЕМУ pageimage НЕЛЬЗЯ ВСЕМ. Он уже подводил этот проект: ревизия клубных
фото нашла по нему стадионы и схемы вместо гербов. У статьи о клубе первая
картинка — что угодно, у статьи о человеке — почти всегда он сам. Владелец
разрешил его ровно так: «pageimage для игроков можно добавить, но только для
игроков». Гард здесь не комментарий, а функция `may_use_pageimage`, и её
проверяет тест.

⚠️ И СРАЗУ ЧЕСТНО, СКОЛЬКО ОН ДАЁТ: ПОЧТИ НИЧЕГО. Замер 06.09.2026 на живой
базе — 240 карточек без фото с QID, из них у 147 нет P18; статей у них 132, и
картинка нашлась В ОДНОЙ. Причина простая: P18 в Викиданных заполняется
ботами ИЗ картинки статьи, поэтому «нет P18» почти всегда значит «в статье
картинки тоже нет». Дыру в фото закрывает не он, а портрет с Transfermarkt
(`docs/cards_photo_transfermarkt.py`, замер: 11 из 12).

⚠️ ШИРИНА ЗАДАЁТСЯ НА СТОРОНЕ COMMONS. Оригиналы бывают в несколько мегабайт;
`?width=400` отдаёт готовую миниатюру и не тратит трафик игрока.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет):
    python docs/cards_photo_from_qid.py --limit 200
    APPLY=1 python docs/cards_photo_from_qid.py
"""
import argparse
import json
import os
import time
import urllib.parse
import urllib.request

UA = ("sherlock-scholes-bot/1.0 "
      "(https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
WD_API = "https://www.wikidata.org/w/api.php"
FILEPATH = "https://commons.wikimedia.org/wiki/Special:FilePath/"
WIDTH = 400
CHUNK = 40           # wbgetentities с claims: тело большое
PAUSE = 1.5
RETRIES = 4
PAGE = 1000
WRITE_BATCH = 50
# Разделы, которые кончаются на «wiki», но языковыми не являются: статьи там
# есть, картинки нет, а место в пачке из 50 заголовков они занимают.
NOT_A_LANGUAGE_WIKI = frozenset((
    "commonswiki", "specieswiki", "metawiki", "sourceswiki", "wikidatawiki"))
# Заголовков за один запрос к вики — предел API для анонима.
TITLES_CHUNK = 50


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


def wd(params):
    url = WD_API + "?" + urllib.parse.urlencode(dict(params, format="json"))
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as fh:
                return json.loads(fh.read())
        except Exception:                                        # noqa: BLE001
            if attempt + 1 == RETRIES:
                return None
            time.sleep(10 * (attempt + 1))
    return None


def wd_at(base, params):
    """Тот же запрос, но к API конкретной вики. Потеря — None, а не пустота."""
    url = base + "?" + urllib.parse.urlencode(dict(params, format="json"))
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as fh:
                return json.loads(fh.read())
        except Exception:                                        # noqa: BLE001
            if attempt + 1 == RETRIES:
                return None
            time.sleep(10 * (attempt + 1))
    return None


def photo_url(filename):
    """Ссылка на миниатюру Commons. ЧИСТАЯ ФУНКЦИЯ — её проверяет тест."""
    if not filename:
        return None
    return "%s%s?width=%d" % (FILEPATH, urllib.parse.quote(filename.replace(" ", "_")), WIDTH)


def may_use_pageimage(category):
    """Можно ли брать «первую картинку статьи» карточке этой категории.

    ⚠️ ЭТО И ЕСТЬ ГАРД, а не комментарий рядом с запросом. Клубу pageimage
    подставлял стадионы вместо гербов, поэтому разрешён он ровно одной
    категории. Список расширять нельзя без нового замера: у стадиона, судьи и
    термина первая картинка статьи — не портрет.
    """
    return category == "player"


def sitelink_title(sitelinks):
    """Заголовок статьи и её вики: английская, иначе первая языковая.

    ЧИСТАЯ ФУНКЦИЯ. Отсекаются НЕязыковые разделы: у Commons и Викивидов
    «статья» есть почти у каждого футболиста, и картинки там нет никогда — а
    запрос к ним съел бы место в пачке.
    """
    if not sitelinks:
        return None, None
    if "enwiki" in sitelinks:
        return "enwiki", sitelinks["enwiki"].get("title")
    for key in sorted(sitelinks):
        if not key.endswith("wiki") or key in NOT_A_LANGUAGE_WIKI:
            continue
        return key, sitelinks[key].get("title")
    return None, None


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"

    rows = read_all("cards", {"select": "id,name,category,wikidata_qid",
                              "category": "eq.player", "active": "is.true",
                              "photo_url": "is.null",
                              "wikidata_qid": "not.is.null",
                              "order": "id"})
    if args.limit:
        rows = rows[:args.limit]
    print("Карточек без фото, но с QID: %d  (APPLY=%s)"
          % (len(rows), "да" if apply_ else "нет — сухой прогон"), flush=True)
    if not rows:
        return

    by_qid = {}
    for r in rows:
        by_qid.setdefault(r["wikidata_qid"], []).append(r)
    qids = sorted(by_qid)

    found = lost = written = from_page = 0
    batch = []
    # {вики: {заголовок статьи: QID}} — только те, у кого P18 не нашлось.
    no_p18 = {}

    def flush():
        """Запись ПО ХОДУ: оборванный прогон обязан оставить сделанное."""
        nonlocal batch, written
        if apply_:
            for card_id, url in batch:
                # ⚠️ Условие `photo_url is null` СТОИТ В ЗАПРОСЕ, а не только в
                # выборке: между чтением и записью мог отработать другой шаг.
                sb("cards", method="PATCH",
                   params={"id": "eq." + card_id, "photo_url": "is.null"},
                   body={"photo_url": url})
                written += 1
        batch = []

    for i in range(0, len(qids), CHUNK):
        part = qids[i:i + CHUNK]
        e = wd({"action": "wbgetentities", "ids": "|".join(part),
                "props": "claims|sitelinks"})
        if e is None:
            lost += len(part)
            print("  ⚠️ пачка %d потеряна — её пустота НИЧЕГО не значит"
                  % (i // CHUNK), flush=True)
            continue
        for qid, ent in (e.get("entities") or {}).items():
            claims = (ent.get("claims") or {}).get("P18") or []
            fname = None
            for c in claims:
                if c.get("rank") == "deprecated":
                    continue
                v = (c.get("mainsnak") or {}).get("datavalue", {}).get("value")
                if isinstance(v, str) and v.strip():
                    fname = v
                    break
            url = photo_url(fname)
            if not url:
                # P18 нет — статью запомним для второго источника. Сама она
                # ничего не гарантирует: замер даёт картинку у одной статьи из
                # ста тридцати двух.
                wiki, title = sitelink_title(ent.get("sitelinks"))
                if wiki and title:
                    no_p18.setdefault(wiki, {})[title] = qid
                continue
            for card in by_qid.get(qid, []):
                found += 1
                batch.append((card["id"], url))
        print("  %d/%d, фото найдено %d" % (min(i + CHUNK, len(qids)), len(qids), found),
              flush=True)
        if len(batch) >= WRITE_BATCH:
            flush()
        time.sleep(PAUSE)

    flush()

    # --- второй источник: первая картинка статьи, ТОЛЬКО игрокам -----------
    #
    # ⚠️ ГАРД СТОИТ ЗДЕСЬ, А НЕ ТОЛЬКО В ЗАПРОСЕ. Выборка выше и правда берёт
    # `category=eq.player`, но проверка, которая держится на одном параметре
    # запроса, ломается молча: достаточно однажды снять фильтр «чтобы прогнать
    # всех», и клубы получат стадионы вместо гербов — этот проект так уже
    # ошибался. Здесь отказ виден числом.
    skipped = [c for c in rows if not may_use_pageimage(c.get("category"))]
    if skipped:
        print("Пропущено по категории (pageimage только игрокам): %d" % len(skipped),
              flush=True)
    if no_p18:
        allowed_qids = {c["wikidata_qid"] for c in rows if may_use_pageimage(c.get("category"))}
        titles_total = sum(len(t) for t in no_p18.values())
        print("Без P18: статей %d в %d разделах — пробуем первую картинку статьи"
              % (titles_total, len(no_p18)), flush=True)
        # Крупные разделы первыми: в пачку влезает 50 заголовков, и enwiki
        # обычно закрывает большую часть одним-двумя запросами.
        for wiki, titles in sorted(no_p18.items(), key=lambda kv: -len(kv[1])):
            host = "https://%s.wikipedia.org/w/api.php" % wiki[:-4].replace("_", "-")
            names = list(titles)
            for j in range(0, len(names), TITLES_CHUNK):
                part = names[j:j + TITLES_CHUNK]
                r = wd_at(host, {"action": "query", "prop": "pageimages",
                                 "piprop": "name", "titles": "|".join(part),
                                 "redirects": 1})
                if r is None:
                    lost += 1
                    print("  ⚠️ пачка статей потеряна (%s) — её пустота НИЧЕГО не значит"
                          % wiki, flush=True)
                    continue
                for page in ((r.get("query") or {}).get("pages") or {}).values():
                    qid = titles.get(page.get("title"))
                    url = photo_url(page.get("pageimage"))
                    if not (qid and url) or qid not in allowed_qids:
                        continue
                    for card in by_qid.get(qid, []):
                        from_page += 1
                        batch.append((card["id"], url))
                if len(batch) >= WRITE_BATCH:
                    flush()
                time.sleep(PAUSE)
        flush()

    print("-" * 70)
    print("Фото найдено : %d (P18 %d, первая картинка статьи %d)"
          % (found + from_page, found, from_page))
    print("Записано     : %d" % written)
    if lost:
        print("⚠️ ПОТЕРЯНО ПАЧЕК: %d — повторить прогон" % lost)
    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")


if __name__ == "__main__":
    main()
