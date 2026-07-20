# -*- coding: utf-8 -*-
"""
cards_pageviews_i18n — «слава по языкам»: просмотры статьи каждого игрока в
КАЖДОЙ языковой вики за последние 12 месяцев -> cards.pageviews_i18n (jsonb).

ЗАЧЕМ: cards.pageviews собраны с ру-вики, поэтому онбординг меряет известность
по русской культуре. pick_random_cards уже умеет точный сигнал
(pageviews_i18n ->> p_lang >= p_difficulty) — этот скрипт его заполняет.

КАК РАБОТАЕТ (на карточку — 1 wikidata-запрос + до 8 pageviews-запросов):
  1. cards (category='player', active) -> ru-название;
  2. wbgetentities (sites=ruwiki, батчами по 50) -> QID + sitelinks
     en/es/pt/fr/zh/ja/ko/ar-wiki;
  3. per-article pageviews (wikimedia REST, monthly, последние 12 полных
     месяцев, user-трафик) по каждому сайтлинку;
  4. UPDATE cards SET pageviews_i18n = {"en": N, "es": M, ...}
     (язык без статьи в jsonb не попадает).

ЗАПУСК (ключи как у остальных docs-скриптов — из football_scraper/.env:
SUPABASE_URL + SUPABASE_KEY (service_role)):
    python docs/cards_pageviews_i18n.py                # dry-run, первые 20
    python docs/cards_pageviews_i18n.py --limit 500    # dry-run, 500 карточек
    APPLY=1 python docs/cards_pageviews_i18n.py --limit 0   # всё + запись

Повторный запуск безопасен: по умолчанию пропускает карточки с уже
заполненным pageviews_i18n (--refresh, чтобы пересобрать все). Прогресс
пишется каждые 25 карточек; сеть падает -> карточка пропускается молча.
"""

import argparse
import json
import os
import sys
import time
from datetime import date, timedelta
from urllib.parse import quote

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "football_scraper"))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "football_scraper", ".env"))

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

LANGS = ["en", "es", "pt", "fr", "zh", "ja", "ko", "ar"]
WD_API = "https://www.wikidata.org/w/api.php"
PV_API = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
          "{proj}/all-access/user/{title}/monthly/{start}/{end}")
# Контракт вежливости Wikimedia — как в football_scraper: контактный UA,
# паузы между запросами, уважение Retry-After на 429/503.
UA = {"User-Agent": ("sherlock-scholes-i18n-pageviews/1.1 "
                     "(https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")}
WD_BATCH_PAUSE = 1.2   # сек между wbgetentities-батчами (>=1s по политике)
PV_PAUSE = 0.15        # сек между pageviews-запросами

session = requests.Session()
session.headers.update(UA)


def get_with_retry(url, params=None, tries=5):
    """GET с обработкой 429/503: спим Retry-After (или растущий бэкофф) и
    повторяем. Прочие ошибки поднимаются как есть."""
    for attempt in range(tries):
        r = session.get(url, params=params, timeout=30)
        if r.status_code not in (429, 503):
            return r
        wait = r.headers.get("Retry-After")
        delay = min(float(wait), 120) if wait and wait.isdigit() else 5 * (attempt + 1)
        print(f"  {r.status_code} от {url.split('/')[2]}, жду {delay:.0f}с…", flush=True)
        time.sleep(delay)
    r.raise_for_status()
    return r


def sb(path, method="GET", **kw):
    kw.setdefault("headers", {})
    kw["headers"].update({
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    })
    r = session.request(method, f"{SUPABASE_URL}/rest/v1/{path}", timeout=30, **kw)
    r.raise_for_status()
    return r


def month_window():
    """12 полных месяцев, заканчивая прошлым: (YYYYMM01, YYYYMM01)."""
    first_of_this = date.today().replace(day=1)
    end = first_of_this - timedelta(days=1)          # последний день прошлого месяца
    start = (first_of_this - timedelta(days=365)).replace(day=1)
    return start.strftime("%Y%m01"), end.strftime("%Y%m%d")


RU_API = "https://ru.wikipedia.org/w/api.php"


def sitelinks_batch(ru_titles):
    """ru-названия -> {запрошенное название: {lang: foreign_title}}.

    Двухшагово. wbgetentities по sites=ruwiki отвечает КАНОНИЧЕСКИМ титулом
    статьи (у людей это «Фамилия, Имя»), а карточки названы «Имя Фамилия» —
    прямое сопоставление теряло почти все карточки (они молча пропускались,
    и pageviews_i18n оставался пустым). action=query на ру-вики отдаёт цепочку
    normalized/redirects, по которой запрошенное имя приводится к финальному
    титулу и его QID; сайтлинки добираем вторым запросом уже по QID.
    """
    r = get_with_retry(RU_API, params={
        "action": "query", "format": "json", "redirects": 1,
        "titles": "|".join(ru_titles),
        "prop": "pageprops", "ppprop": "wikibase_item", "maxlag": "5",
    })
    r.raise_for_status()
    q = r.json().get("query") or {}
    step = {}  # запрошенное -> следующее звено (нормализация, затем редирект)
    for m in (q.get("normalized") or []) + (q.get("redirects") or []):
        step[m["from"]] = m["to"]

    def final_title(t, hops=5):
        while t in step and hops > 0:
            t, hops = step[t], hops - 1
        return t

    title_qid = {}
    for p in (q.get("pages") or {}).values():
        qid = (p.get("pageprops") or {}).get("wikibase_item")
        if qid and p.get("title"):
            title_qid[p["title"]] = qid

    req_qid = {t: title_qid.get(final_title(t)) for t in ru_titles}
    qids = sorted({v for v in req_qid.values() if v})

    qid_links = {}
    for j in range(0, len(qids), 50):
        time.sleep(WD_BATCH_PAUSE)
        r2 = get_with_retry(WD_API, params={
            "action": "wbgetentities", "format": "json",
            "ids": "|".join(qids[j:j + 50]), "props": "sitelinks",
            "sitefilter": "|".join(f"{l}wiki" for l in LANGS),
            "maxlag": "5",
        })
        r2.raise_for_status()
        for qid, ent in (r2.json().get("entities") or {}).items():
            links = ent.get("sitelinks") or {}
            qid_links[qid] = {
                lang: links[f"{lang}wiki"]["title"]
                for lang in LANGS if f"{lang}wiki" in links
            }
    return {t: qid_links[v] for t, v in req_qid.items()
            if v and qid_links.get(v)}


def views_12m(lang, title, start, end):
    url = PV_API.format(proj=f"{lang}.wikipedia.org",
                        title=quote(title.replace(" ", "_"), safe=""),
                        start=start, end=end)
    r = get_with_retry(url)
    if r.status_code == 404:      # статьи нет / нет трафика — не ошибка
        return None
    r.raise_for_status()
    return sum(item.get("views", 0) for item in r.json().get("items", []))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20,
                    help="сколько карточек обработать (0 = все)")
    ap.add_argument("--refresh", action="store_true",
                    help="пересобрать и уже заполненные pageviews_i18n")
    args = ap.parse_args()
    apply = os.environ.get("APPLY") == "1"

    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("Нет SUPABASE_URL/SUPABASE_KEY (football_scraper/.env)")

    flt = "category=eq.player&active=is.true&select=id,name"
    if not args.refresh:
        flt += "&pageviews_i18n=is.null"
    cards, offset = [], 0
    while True:
        page = sb(f"cards?{flt}&order=pageviews.desc.nullslast"
                  f"&limit=1000&offset={offset}").json()
        cards += page
        if len(page) < 1000:
            break
        offset += 1000
    if args.limit:
        cards = cards[:args.limit]
    print(f"Карточек к обработке: {len(cards)}  (APPLY={'да' if apply else 'нет — dry-run'})")

    start, end = month_window()
    done = written = 0
    for i in range(0, len(cards), 50):
        chunk = cards[i:i + 50]
        try:
            links = sitelinks_batch([c["name"] for c in chunk])
        except requests.RequestException as e:
            print(f"  wikidata батч упал ({e}), пропуск 50 карточек")
            time.sleep(WD_BATCH_PAUSE)
            continue
        time.sleep(WD_BATCH_PAUSE)
        for c in chunk:
            titles = links.get(c["name"])
            if not titles:
                done += 1
                continue
            payload = {}
            for lang, title in titles.items():
                try:
                    v = views_12m(lang, title, start, end)
                except requests.RequestException:
                    v = None
                if v is not None:
                    payload[lang] = v
                time.sleep(PV_PAUSE)
            if payload:
                if apply:
                    sb(f"cards?id=eq.{c['id']}", method="PATCH",
                       data=json.dumps({"pageviews_i18n": payload}))
                    written += 1
                else:
                    top = sorted(payload.items(), key=lambda kv: -kv[1])[:3]
                    print(f"  {c['name']}: " + ", ".join(f"{l}={v}" for l, v in top))
            done += 1
            if done % 25 == 0:
                print(f"  … {done}/{len(cards)}")
    print(f"Готово: {done}/{len(cards)}, записано pageviews_i18n: {written}")


if __name__ == "__main__":
    main()
