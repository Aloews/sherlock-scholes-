# -*- coding: utf-8 -*-
"""Герб клуба с Transfermarkt — тем клубам, до которых ESPN не дотянулся.

ИСТОЧНИК НАЗВАН ПРЯМО. Гербы берутся с transfermarkt.com, ссылка ведёт на их
же CDN (`img.a.transfermarkt.technology/wappen/...`) — происхождение видно в
самом адресе. Ровно так же в проекте показываются эмблемы с CDN ESPN.

⚠️ ESPN ОСТАЁТСЯ ОСНОВНЫМ, И ЭТО РЕШЕНИЕ ВЛАДЕЛЬЦА. Здесь заполняется ТОЛЬКО
пустое (`crest_url is null`); ни одна собранная эмблема не переписывается.
Ревизия клубных фото уже ловила сборщик, который молча откатывал это решение.

ЗАЧЕМ. Замер 06.09.2026: у 254 клубов есть СОБРАННЫЙ СОСТАВ, но нет карточки в
коллекции — и у всех 254 причина одна: нет герба, а `create_cards_from_clubs()`
без герба карточку не заводит (пустая плашка на экране хуже отсутствия). При
этом `transfermarkt_id` есть у всех 254: состав оттуда и приехал.

⚠️ АДРЕС СТРОИТСЯ, НО ПРОВЕРЯЕТСЯ. `wappen/head/<verein>.png` — предсказуемый
адрес, страницу клуба качать не надо. Но «предсказуемый» не значит «живой»:
замер даёт 206 и `image/png` у настоящего клуба и ЧЕСТНЫЙ 404 у выдуманного
id. Поэтому каждая ссылка проверяется запросом первого килобайта, а не
записывается на веру — иначе в коллекцию попадут битые картинки, которые на
экране неотличимы от поломки приложения.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет):
    python docs/clubs_crests_transfermarkt.py --limit 20
    APPLY=1 python docs/clubs_crests_transfermarkt.py
"""
import argparse
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

UA = ("SherlockScholesBot/1.0 "
      "(+https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
CREST = "https://img.a.transfermarkt.technology/wappen/head/%s.png?lm=4711"
PAUSE = 0.8
RETRIES = 3
PAGE = 1000


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
    out, offset = [], 0
    while True:
        page = sb(path, params=dict(params, limit=PAGE, offset=offset))
        out.extend(page)
        if len(page) < PAGE:
            return out
        offset += PAGE


def crest_url(tm_id):
    """Адрес герба по id клуба. ЧИСТАЯ ФУНКЦИЯ — её проверяет тест."""
    tm = (tm_id or "").strip()
    if not tm or not tm.isdigit():
        return None
    return CREST % tm


def alive(url):
    """Живая ли картинка: первый килобайт и тип содержимого.

    Возвращает True / False / None, где None — «не дозвонились». Отличать
    ТРЕТИЙ исход обязательно: сеть, упавшая на середине прогона, иначе
    запишется в «герба нет» и клуб не вернётся сюда никогда.
    """
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Range": "bytes=0-1023"})
            with urllib.request.urlopen(req, timeout=40) as fh:
                ctype = (fh.headers.get("Content-Type") or "").lower()
                return fh.status in (200, 206) and ctype.startswith("image/")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return False                      # герба нет — это ответ
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
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only-with-roster", action="store_true",
                    help="только клубы с собранным составом — их и ждёт коллекция")
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY")):
        raise SystemExit("нужны SUPABASE_URL и SUPABASE_KEY")

    rows = read_all("football_club", {
        "select": "club_key,name,transfermarkt_id",
        "kind": "eq.club", "crest_url": "is.null",
        "transfermarkt_id": "not.is.null", "order": "club_key"})

    if args.only_with_roster:
        keys = {r["club_key"] for r in read_all(
            "club_roster", {"select": "club_key", "order": "club_key"})}
        rows = [r for r in rows if r["club_key"] in keys]

    if args.limit:
        rows = rows[:args.limit]
    print("Клубов без герба, но с id на Transfermarkt: %d  (APPLY=%s)"
          % (len(rows), "да" if apply_ else "нет — сухой прогон"), flush=True)
    if not rows:
        return

    found = missing = lost = written = 0
    for i, club in enumerate(rows, 1):
        url = crest_url(club["transfermarkt_id"])
        if not url:
            missing += 1
            continue
        ok = alive(url)
        if ok is None:
            lost += 1
        elif ok:
            found += 1
            if apply_:
                sb("football_club", method="PATCH",
                   params={"club_key": "eq." + club["club_key"], "crest_url": "is.null"},
                   body={"crest_url": url})
                written += 1
        else:
            missing += 1
        if i % 25 == 0:
            print("  %d/%d, гербов %d, нет %d, потеряно %d"
                  % (i, len(rows), found, missing, lost), flush=True)
        time.sleep(PAUSE)

    print("-" * 70)
    print("Гербов найдено : %d" % found)
    print("Герба нет (404): %d" % missing)
    print("Записано       : %d" % written)
    if lost:
        print("⚠️ НЕ ДОЗВОНИЛИСЬ: %d — их пустота НИЧЕГО не значит, повторить" % lost)
    if apply_ and written:
        print("\nДальше — карточки: select * from create_cards_from_clubs();")
    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")


if __name__ == "__main__":
    main()
