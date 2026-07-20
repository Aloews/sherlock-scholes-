# -*- coding: utf-8 -*-
"""
cards_career_localize — русские/латинские имена клубов для карьерных строк.

ЗАЧЕМ: в итогах игры карьера рисуется из двух источников с разным языком
названий клубов:
  * cards.career_stats  — из АНГЛИЙСКОЙ вики (инфобокс) -> «Sochi»,
    «Shinnik Yaroslavl» режут глаз в русском интерфейсе;
  * cards.legend_career — из русских лейблов Wikidata -> «ЖФК Барселона»
    нечитаем для иностранцев.
Скрипт добирает недостающую сторону: career_stats[i].club_ru и
legend_career.clubs[i].club_en. Фронт выбирает имя по языку интерфейса.

КАК: имя клуба -> поиск статьи ("<имя> football club") в en/ru-вики ->
QID (pageprops, цепочка redirects) -> проверка P31 = футбольный клуб ->
labels ru+en одним wbgetentities-батчем. Неуверенные совпадения
ПРОПУСКАЮТСЯ (лучше латиница, чем неверный перевод). Резолвы кешируются в
football_scraper/cache, так что ночные повторы почти бесплатны.

ЗАПУСК (ключи из окружения или football_scraper/.env):
    python docs/cards_career_localize.py            # dry-run
    APPLY=1 python docs/cards_career_localize.py    # запись
"""

import json
import os
import sys
import time

import requests

HERE = os.path.dirname(__file__)
SCRAPER = os.path.join(HERE, "..", "football_scraper")
sys.path.insert(0, SCRAPER)
from dotenv import load_dotenv  # noqa: E402
from scraper.cache import FileCache  # noqa: E402

load_dotenv(os.path.join(SCRAPER, ".env"))
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
APPLY = os.environ.get("APPLY") == "1"

WD_API = "https://www.wikidata.org/w/api.php"
UA = {"User-Agent": ("sherlock-scholes-career-localize/1.0 "
                     "(https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")}
PAUSE = 0.4          # сек между поисковыми запросами (контракт вежливости)
BATCH_PAUSE = 1.2    # сек между батчевыми запросами

# P31-значения, которые считаем «футбольным клубом». Только уверенные:
# сомнительный QID => клуб остаётся без перевода, это безопаснее ошибки.
CLUB_P31 = {"Q476028"}   # association football club

session = requests.Session()
session.headers.update(UA)


def get_with_retry(url, params=None, tries=5):
    for attempt in range(tries):
        r = session.get(url, params=params, timeout=30)
        if r.status_code not in (429, 503):
            return r
        wait = r.headers.get("Retry-After")
        delay = min(float(wait), 120) if wait and wait.isdigit() else 5 * (attempt + 1)
        print(f"  {r.status_code}, жду {delay:.0f}с…", flush=True)
        time.sleep(delay)
    r.raise_for_status()
    return r


def sb(path, method="GET", **kw):
    kw.setdefault("headers", {})
    kw["headers"].update({
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    })
    r = session.request(method, f"{SUPABASE_URL}/rest/v1/{path}", timeout=30, **kw)
    r.raise_for_status()
    return r


def wiki_api(lang):
    return f"https://{lang}.wikipedia.org/w/api.php"


def search_title(lang, query):
    """Первый поисковый хит '<имя> football club' в lang-вики (или None)."""
    r = get_with_retry(wiki_api(lang), params={
        "action": "query", "list": "search", "format": "json",
        "srsearch": f"{query} футбольный клуб" if lang == "ru" else f"{query} football club",
        "srlimit": 1, "maxlag": "5",
    })
    hits = r.json().get("query", {}).get("search", [])
    return hits[0]["title"] if hits else None


def title_qid(lang, title):
    """Статья -> QID через pageprops (redirects=1)."""
    r = get_with_retry(wiki_api(lang), params={
        "action": "query", "format": "json", "redirects": 1,
        "titles": title, "prop": "pageprops", "ppprop": "wikibase_item",
        "maxlag": "5",
    })
    for p in (r.json().get("query", {}).get("pages") or {}).values():
        qid = (p.get("pageprops") or {}).get("wikibase_item")
        if qid:
            return qid
    return None


def qid_details(qids):
    """{qid: {"p31": set, "ru": label, "en": label}} батчами по 50."""
    out = {}
    qids = sorted(set(qids))
    for i in range(0, len(qids), 50):
        time.sleep(BATCH_PAUSE)
        r = get_with_retry(WD_API, params={
            "action": "wbgetentities", "format": "json",
            "ids": "|".join(qids[i:i + 50]),
            "props": "claims|labels", "languages": "ru|en", "maxlag": "5",
        })
        for qid, ent in (r.json().get("entities") or {}).items():
            p31 = set()
            for st in (ent.get("claims") or {}).get("P31", []):
                try:
                    p31.add(st["mainsnak"]["datavalue"]["value"]["id"])
                except (KeyError, TypeError):
                    continue
            labels = ent.get("labels") or {}
            out[qid] = {"p31": p31,
                        "ru": (labels.get("ru") or {}).get("value"),
                        "en": (labels.get("en") or {}).get("value")}
    return out


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("Нет SUPABASE_URL/SUPABASE_KEY (football_scraper/.env)")

    cache = FileCache(os.path.join(SCRAPER, "cache"), True)

    cards, offset = [], 0
    sel = ("cards?select=id,career_stats,legend_career"
           "&or=(career_stats.not.is.null,legend_career.not.is.null)"
           "&active=is.true&order=id.asc")
    while True:
        page = sb(f"{sel}&limit=1000&offset={offset}").json()
        cards += page
        if len(page) < 1000:
            break
        offset += 1000

    # Имена, которым не хватает перевода. en-имена (career_stats) переводим
    # на ru; ru-имена (legend_career) — на en.
    need = {"en": set(), "ru": set()}
    for c in cards:
        for row in c.get("career_stats") or []:
            if row.get("club") and not row.get("club_ru"):
                need["en"].add(row["club"])
        for row in (c.get("legend_career") or {}).get("clubs") or []:
            if row.get("club") and not row.get("club_en"):
                need["ru"].add(row["club"])
    print(f"Карточек: {len(cards)} | клубов к переводу: "
          f"en->ru {len(need['en'])}, ru->en {len(need['ru'])}  "
          f"(APPLY={'да' if APPLY else 'нет — dry-run'})", flush=True)

    # 1) имя -> QID (кешируется навсегда; null-результат тоже кешируется).
    name_qid = {"en": {}, "ru": {}}
    for lang in ("en", "ru"):
        fresh = []
        for name in sorted(need[lang]):
            hit = cache.get(f"club_qid_{lang}", name)
            if hit is not None:
                name_qid[lang][name] = hit.get("qid")
            else:
                fresh.append(name)
        for i, name in enumerate(fresh, 1):
            title = search_title(lang, name)
            time.sleep(PAUSE)
            qid = title_qid(lang, title) if title else None
            time.sleep(PAUSE)
            cache.set(f"club_qid_{lang}", name, {"qid": qid})
            name_qid[lang][name] = qid
            if i % 25 == 0:
                print(f"  [{lang}] {i}/{len(fresh)} resolved…", flush=True)

    # 2) QID -> P31 + labels (кеш).
    all_qids = {q for m in name_qid.values() for q in m.values() if q}
    details, fresh_qids = {}, []
    for q in all_qids:
        hit = cache.get("club_labels", q)
        if hit is not None:
            details[q] = {"p31": set(hit.get("p31") or []),
                          "ru": hit.get("ru"), "en": hit.get("en")}
        else:
            fresh_qids.append(q)
    if fresh_qids:
        for q, d in qid_details(fresh_qids).items():
            details[q] = d
            cache.set("club_labels", q, {"p31": sorted(d["p31"]),
                                         "ru": d["ru"], "en": d["en"]})

    def translated(name, src_lang, dst_lang):
        """Перевод имени клуба или None, если совпадение неуверенное."""
        qid = name_qid[src_lang].get(name)
        d = details.get(qid) if qid else None
        if not d or not (d["p31"] & CLUB_P31):
            return None
        label = d.get(dst_lang)
        return label if label and label != name else None

    patched = skipped = 0
    for c in cards:
        body = {}
        cs = c.get("career_stats")
        if cs and any(r.get("club") and not r.get("club_ru") for r in cs):
            changed = False
            for row in cs:
                if row.get("club") and not row.get("club_ru"):
                    ru = translated(row["club"], "en", "ru")
                    if ru:
                        row["club_ru"] = ru
                        changed = True
            if changed:
                body["career_stats"] = cs
        lc = c.get("legend_career")
        clubs = (lc or {}).get("clubs") or []
        if clubs and any(r.get("club") and not r.get("club_en") for r in clubs):
            changed = False
            for row in clubs:
                if row.get("club") and not row.get("club_en"):
                    en = translated(row["club"], "ru", "en")
                    if en:
                        row["club_en"] = en
                        changed = True
            if changed:
                body["legend_career"] = lc
        if not body:
            continue
        if APPLY:
            sb(f"cards?id=eq.{c['id']}", method="PATCH", data=json.dumps(body))
        patched += 1

    unresolved = sum(1 for lang in ("en", "ru") for n in need[lang]
                     if not translated(n, lang, "ru" if lang == "en" else "en"))
    print(f"Готово: карточек обновлено {patched} "
          f"({'записано' if APPLY else 'dry-run, без записи'}); "
          f"клубов без уверенного перевода: {unresolved} (остаются как есть)",
          flush=True)


if __name__ == "__main__":
    main()
