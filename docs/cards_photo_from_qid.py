# -*- coding: utf-8 -*-
"""Фото карточке — по её собственному QID, без единого сравнения имён.

ЗАЧЕМ ЕЩЁ ОДИН. `cards_photo_by_qid.py` берёт QID из `players_meta` и
находит карточку ПО ИМЕНИ. У карточек, заведённых из составов, записи в
`players_meta` нет вовсе, зато `cards.wikidata_qid` проставлен обратным
поиском по id на Transfermarkt — то есть идентификатором. Отсюда и берём.

Замер 06.09.2026: из 10 465 активных игроков фото было у 2693, а QID без
фото — у 7685.

ЦЕПОЧКА: cards.wikidata_qid → P18 → Commons Special:FilePath?width=400

⚠️ ТОЛЬКО P18, БЕЗ pageimage. `pageimage` — это «первая картинка статьи», и
она уже подводила этот проект: ревизия клубных фото нашла стадионы и схемы
вместо гербов. P18 — «изображение объекта» по построению.

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


def photo_url(filename):
    """Ссылка на миниатюру Commons. ЧИСТАЯ ФУНКЦИЯ — её проверяет тест."""
    if not filename:
        return None
    return "%s%s?width=%d" % (FILEPATH, urllib.parse.quote(filename.replace(" ", "_")), WIDTH)


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"

    rows = read_all("cards", {"select": "id,name,wikidata_qid",
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

    found = lost = written = 0
    batch = []

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
        e = wd({"action": "wbgetentities", "ids": "|".join(part), "props": "claims"})
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
    print("-" * 70)
    print("Фото найдено : %d" % found)
    print("Записано     : %d" % written)
    if lost:
        print("⚠️ ПОТЕРЯНО ПАЧЕК: %d — повторить прогон" % lost)
    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")


if __name__ == "__main__":
    main()
