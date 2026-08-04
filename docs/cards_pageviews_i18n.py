# -*- coding: utf-8 -*-
"""
cards_pageviews_i18n — «слава по языкам»: просмотры статьи карточки в КАЖДОЙ
языковой вики за последние 12 месяцев -> cards.pageviews_i18n (jsonb).

ЗАЧЕМ: cards.pageviews собраны с ру-вики, поэтому и онбординг, и сортировка
коллекции меряют известность по русской культуре. cards.fame считается как
GREATEST(pageviews, max по pageviews_i18n) — этот скрипт наполняет вторую
половину формулы.

КАК РАБОТАЕТ (на карточку — резолв статьи + до 9 pageviews-запросов):
  1. cards (active) -> ru-название;
  2. название -> QID:
     * ИГРОКИ — батчами по 50 через ru-вики action=query (у игрока голое имя
       И ЕСТЬ титул статьи, с точностью до нормализации/редиректа);
     * ВСЕ ОСТАЛЬНЫЕ — через резолвер конвейера (run.resolve_card_qid):
       сначала «<имя> (футбольный клуб)» / «(стадион)», потом голое имя,
       потом полнотекстовый поиск, и на каждом шаге P31-ГАРД. Голое название
       клуба — это обычно город, планета или термин: "Зенит" в ру-вики это
       астрономический зенит (Q82806), "Факел" — факел, "Брест" — город.
       Без гарда мы бы записали славу зенита-надира в карточку клуба;
  3. wbgetentities по QID (батчами по 50) -> sitelinks ru/en/es/pt/fr/zh/
     ja/ko/ar-wiki;
  4. per-article pageviews (wikimedia REST, monthly, последние 12 полных
     месяцев, user-трафик) по каждому сайтлинку;
  5. UPDATE cards SET pageviews_i18n = {"ru": K, "en": N, ...}
     (язык без статьи в jsonb не попадает — это «здесь про него не знают»,
     а не ноль).

ru СОБИРАЕТСЯ НАРАВНЕ С ОСТАЛЬНЫМИ. cards.pageviews исторически хранит ту же
величину, но у неигровых карточек она снята с ЧУЖОЙ статьи (см. п.2), и
починить её можно только тем же резолвом. Русский зритель коллекции читает
pageviews_i18n->>'ru' и падает на pageviews только там, где языков ещё нет.

ЗАПУСК (ключи как у остальных docs-скриптов — из football_scraper/.env:
SUPABASE_URL + SUPABASE_KEY (service_role)):
    python docs/cards_pageviews_i18n.py                # dry-run, первые 20
    python docs/cards_pageviews_i18n.py --limit 500    # dry-run, 500 карточек
    APPLY=1 python docs/cards_pageviews_i18n.py --limit 0   # всё + запись
    python docs/cards_pageviews_i18n.py --categories club --limit 40
    python docs/cards_pageviews_i18n.py --report out.json   # выгрузка резолва

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

# ru first: it is the language cards.pageviews was supposed to hold, and the
# only one we can check the resolution against (a mismatch with the bare card
# name is exactly how a wrong article shows itself).
LANGS = ["ru", "en", "es", "pt", "fr", "zh", "ja", "ko", "ar"]
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


def is_maxlag(response):
    """Ответ MediaWiki «база отстаёт, приходи позже».

    Приходит как HTTP **200** с телом {"error":{"code":"maxlag",...}} — то
    есть выглядит успехом. Без этой проверки батч возвращал пустой
    entities, все карточки в нём объявлялись нерезолвящимися, и прогон
    рапортовал «готово», не записав ничего. Молчаливый ноль вместо ошибки —
    ровно тот случай, который CI не ловит.
    """
    if response.status_code != 200:
        return False
    try:
        return (response.json().get("error") or {}).get("code") == "maxlag"
    except ValueError:
        return False


MAXLAG_POLITE_ATTEMPTS = 2   # сколько раз ждём, прежде чем снять maxlag


def get_with_retry(url, params=None, tries=5):
    """GET с обработкой 429/503 и maxlag: спим Retry-After (или растущий
    бэкофф) и повторяем. Прочие ошибки поднимаются как есть.

    maxlag снимается после MAXLAG_POLITE_ATTEMPTS ожиданий. Отстаёт обычно
    НЕ основная база, а SPARQL-сервис (error.type=wikibase-queryservice,
    лаг сутками), а мы его не спрашиваем: wbgetentities и action=query
    читают ядро. Ждать чужого отставания бесконечно — значит не собрать
    ничего. Остальной конвейер (scraper/wikidata.py, scraper/pageviews.py)
    read-only запросы шлёт вообще без maxlag; здесь мы сначала вежливо
    ждём и только потом равняемся на него.
    """
    params = dict(params or {})
    for attempt in range(tries):
        r = session.get(url, params=params, timeout=30)
        if r.status_code not in (429, 503) and not is_maxlag(r):
            return r
        if is_maxlag(r) and attempt + 1 >= MAXLAG_POLITE_ATTEMPTS and "maxlag" in params:
            print("  maxlag держится — повтор без него (запрос read-only)",
                  flush=True)
            params.pop("maxlag")
            continue
        wait = r.headers.get("Retry-After")
        delay = min(float(wait), 120) if wait and wait.isdigit() else 5 * (attempt + 1)
        reason = "maxlag" if is_maxlag(r) else r.status_code
        print(f"  {reason} от {url.split('/')[2]}, жду {delay:.0f}с…", flush=True)
        time.sleep(delay)
    if is_maxlag(r):
        # Отставание не разошлось и без maxlag запрос не прошёл — это не
        # «пропустить карточку», а «сегодня Wikidata не отвечает».
        raise requests.RequestException(
            "Wikidata maxlag не разошёлся за {} попыток".format(tries))
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


def qids_for_ru_titles(ru_titles):
    """ru-названия -> {запрошенное название: QID|None}. Только для ИГРОКОВ.

    wbgetentities по sites=ruwiki отвечает КАНОНИЧЕСКИМ титулом статьи (у
    людей это «Фамилия, Имя»), а карточки названы «Имя Фамилия» — прямое
    сопоставление теряло почти все карточки (они молча пропускались, и
    pageviews_i18n оставался пустым). action=query на ру-вики отдаёт цепочку
    normalized/redirects, по которой запрошенное имя приводится к финальному
    титулу и его QID.

    Гарда здесь нет намеренно: у игрока голое имя И ЕСТЬ титул статьи, а
    однословные имена («Данте», «Халк») закрыты P106-гардом в резолвере
    конвейера — см. resolve_non_player().
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

    return {t: title_qid.get(final_title(t)) for t in ru_titles}


def sitelinks_for_qids(qids):
    """QID -> {lang: foreign_title} по всем LANGS, батчами по 50."""
    qid_links = {}
    qids = sorted({q for q in qids if q})
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
    return qid_links


# --------------------------------------------------------------------------
# Неигровые карточки: резолв через конвейер, а не по голому названию.
#
# Загружается ЛЕНИВО — run.py тянет за собой конфиг, кеш и бюджеты скрапера,
# и прогону, где неигровых карточек нет, всё это не нужно.
# --------------------------------------------------------------------------
_pipeline = None


def pipeline():
    """(run, resolver, wikidata, cache, budget) конвейера — один раз за прогон.

    Тот же резолвер, что у фото и описаний: своя вторая реализация разошлась
    бы с ними, и карточка получила бы славу одной статьи, фото другой.
    Бюджет — photos_budget.json, как в cards_pageviews_refix.py: резолв
    титула/QID идёт по бюджету фото, сами pageviews — мимо (у этого скрипта
    свой контракт вежливости, см. PV_PAUSE).
    """
    global _pipeline
    if _pipeline is not None:
        return _pipeline

    import importlib.util

    scraper = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "..", "football_scraper")
    sys.path.insert(0, scraper)
    spec = importlib.util.spec_from_file_location(
        "run", os.path.join(scraper, "run.py"))
    run = importlib.util.module_from_spec(spec)
    sys.modules["run"] = run
    spec.loader.exec_module(run)

    from scraper.cache import FileCache
    from scraper.pageviews import WikimediaBudget, WikiPagePropsClient
    from scraper.wikidata import WikidataEnricher

    cfg = json.load(open(os.path.join(scraper, "config.json"), encoding="utf-8"))
    cache = FileCache(os.path.join(scraper, cfg["cache"]["dir"]),
                      cfg["cache"]["enabled"])
    budget = WikimediaBudget(
        cfg.get("photos", {}).get("daily_request_budget", 5000),
        os.path.join(scraper, cfg["cache"]["dir"], "photos_budget.json"))
    pv = cfg["pageviews"]
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget)
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    _pipeline = (run, resolver, wikidata, cache, budget)
    return _pipeline


def resolve_non_player(card):
    """QID неигровой карточки, или None, если уверенно не резолвится.

    None — это НОРМАЛЬНЫЙ исход, а не сбой: пустой pageviews_i18n оставляет
    карточку на русском порядке, а записанная слава чужой статьи испортила бы
    и сортировку, и рамку редкости. «Брест» (город в Белоруссии), «Монреаль»
    (город) именно так и отсекаются.
    """
    run, resolver, wikidata, cache, budget = pipeline()
    validate = run.make_card_qid_validator(card, wikidata, cache, budget)
    qid, _title, _via = run.resolve_card_qid(
        resolver, card, run.cards_photos_candidates(card), validate)
    return qid


def views_12m(lang, title, start, end):
    url = PV_API.format(proj=f"{lang}.wikipedia.org",
                        title=quote(title.replace(" ", "_"), safe=""),
                        start=start, end=end)
    r = get_with_retry(url)
    if r.status_code == 404:      # статьи нет / нет трафика — не ошибка
        return None
    r.raise_for_status()
    return sum(item.get("views", 0) for item in r.json().get("items", []))


def resolve_chunk(chunk):
    """Карточки -> {id: {lang: title}}. Игроки батчем, остальные по одной."""
    players = [c for c in chunk if c.get("category") == "player"]
    others = [c for c in chunk if c.get("category") != "player"]

    qid_by_id = {}
    if players:
        by_title = qids_for_ru_titles([c["name"] for c in players])
        for c in players:
            qid_by_id[c["id"]] = by_title.get(c["name"])
    for c in others:
        qid_by_id[c["id"]] = resolve_non_player(c)

    links_by_qid = sitelinks_for_qids(qid_by_id.values())
    return {cid: links_by_qid.get(qid) or {} for cid, qid in qid_by_id.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20,
                    help="сколько карточек обработать (0 = все)")
    ap.add_argument("--refresh", action="store_true",
                    help="пересобрать и уже заполненные pageviews_i18n")
    ap.add_argument("--categories", default="",
                    help="только эти категории, через запятую (по умолчанию все)")
    ap.add_argument("--report", default="",
                    help="выгрузить резолв и просмотры в JSON-файл")
    args = ap.parse_args()
    apply = os.environ.get("APPLY") == "1"

    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("Нет SUPABASE_URL/SUPABASE_KEY (football_scraper/.env)")

    flt = "active=is.true&select=id,name,name_en,category"
    cats = [c.strip() for c in args.categories.split(",") if c.strip()]
    if cats:
        flt += "&category=in.({})".format(",".join(cats))
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
    done = written = unresolved = 0
    report = []
    for i in range(0, len(cards), 50):
        chunk = cards[i:i + 50]
        try:
            links = resolve_chunk(chunk)
        except requests.RequestException as e:
            print(f"  wikidata батч упал ({e}), пропуск 50 карточек")
            time.sleep(WD_BATCH_PAUSE)
            continue
        except RuntimeError as e:
            # Дневной бюджет Wikimedia кончился. Он ОБЩИЙ с шагами фото и
            # описаний (photos_budget.json), так что в ночном прогоне стену
            # ставит их трафик, а не наш. Останавливаемся вежливо, как
            # cards_descriptions_build.py: резолв уже сложен в кеш, и завтра
            # прогон продолжится с него, а не начнёт заново.
            print(f"\n!!! {e}")
            print("!!! Прогресс резолва сохранён в кеше, продолжите завтра.",
                  flush=True)
            break
        time.sleep(WD_BATCH_PAUSE)
        for c in chunk:
            titles = links.get(c["id"])
            if not titles:
                unresolved += 1
                done += 1
                print(f"  — {c['name']}: статья не найдена (или отбракована "
                      f"P31-гардом), pageviews_i18n не тронут")
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
                report.append({"id": c["id"], "name": c["name"],
                               "category": c.get("category"),
                               "ru_title": titles.get("ru"),
                               "views": payload})
            done += 1
            if done % 25 == 0:
                print(f"  … {done}/{len(cards)}")

    if args.report:
        with open(args.report, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False)
        print(f"Отчёт: {args.report} ({len(report)} карточек)")
    print(f"Готово: {done}/{len(cards)}, записано pageviews_i18n: {written}, "
          f"не резолвится: {unresolved}")


if __name__ == "__main__":
    main()
