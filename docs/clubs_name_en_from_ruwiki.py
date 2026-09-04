# -*- coding: utf-8 -*-
"""Английское имя клубу — из ruwiki, чтобы у него наконец нашёлся герб.

ЗАЧЕМ. Гербов не хватает 574 клубам, и это НЕ потому, что их нет у ESPN.
Проверено запросом к ESPN 04.09.2026: «Werder Bremen», «Mainz», «Atlético
Madrid», «Fagiano Okayama», «Mito Hollyhock» — все на месте. Не хватает моста:

    club_key        name              name_en   матчей
    verder          Вердер            NULL          58
    maynts          Майнц             NULL          46
    atletiko        Атлетико          NULL          72
    dzhubilo ivata  Джубило Ивата     NULL          72

`apply_espn_crests` сопоставляет по `club_match_key(name_en)` и
`club_match_key(name)`. У этих строк name_en пуст, а name русский — и ни одно
латинское имя ESPN на него не похоже. Клуб играет, виден в приложении и сидит
без герба.

⚠️ МОСТОМ СЛУЖИТ ИДЕНТИФИКАТОР, А НЕ ПОХОЖЕСТЬ СТРОК. Фонетическая
транслитерация русского имени английскому не равна и близко:

    Вердер    → verder      у ESPN werder     (одна буква)
    Майнц     → maynts      у ESPN mainz      (две)
    Рейнджерс → reyndzhers  у ESPN rangers    (четыре)
    Джубило   → dzhubilo    у ESPN jubilo     (три)

Сопоставление по расстоянию тут ошибается МОЛЧА — «Ростов» и «Ростов-на-Дону»
разойдутся, а «Атлетико» и «Атлетико Паранаэнсе» сойдутся. Поэтому путь такой:

    русское имя → статья ruwiki → QID → P31-гард → sitelink enwiki → name_en

⚠️ P31-ГАРД ОБЯЗАТЕЛЕН, И ЭТО НЕ ПЕРЕСТРАХОВКА. «Вердер» — ещё и река, «Париж»
и «Брест» — города, «Атлетико» — десяток клубов. Без гарда строка получила бы
имя не того объекта: ровно так карточка «Зенит» получила диаграмму
астрономического зенита, а «Арминия» — памятник вождю херусков.

⚠️ ВТОРОЙ ГАРД — СТРАНА. P31 отличает клуб от реки, но НЕ отличает «Атлетико
Мадрид» от «Атлетико Паранаэнсе»: клубы оба. Поэтому, когда у строки известна
страна, она сверяется со страной сущности (P17). Расхождение — отказ, а не
догадка.

ВЕРДИКТЫ:
    FILL  нашлась клубная сущность, гарды пройдены, у неё есть enwiki
    SKIP  всё остальное, с причиной. Пустое имя лучше чужого: чужое имя
          приведёт к чужому гербу, и это будет видно игроку.

СУХОЙ ПРОГОН ПО УМОЛЧАНИЮ.

    python docs/clubs_name_en_from_ruwiki.py --limit 40
    python docs/clubs_name_en_from_ruwiki.py --sql-out names.sql
    APPLY=1 python docs/clubs_name_en_from_ruwiki.py

Читает справочник анонимным ключом (VITE_SUPABASE_*), пишет служебным
(SUPABASE_KEY) — чтения хватает и без служебного, поэтому сухой прогон
доступен всегда.
"""
import argparse
import importlib.util
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRAPER = os.path.join(ROOT, "football_scraper")
sys.path.insert(0, SCRAPER)

_spec = importlib.util.spec_from_file_location("run", os.path.join(SCRAPER, "run.py"))
run = importlib.util.module_from_spec(_spec)
sys.modules["run"] = run
_spec.loader.exec_module(run)

from scraper.cache import FileCache                                # noqa: E402
from scraper.pageviews import WikimediaBudget, WikiPagePropsClient  # noqa: E402
from scraper.wikidata import WikidataEnricher                      # noqa: E402

# Страна строки справочника приходит по-разному: где «Япония», где «MX».
# Сверяется только то, что удалось привести к одному виду; остальное не
# сверяется вовсе — молчаливая догадка тут хуже пропуска.
COUNTRY_ALIASES = {
    "испания": "spain", "англия": "england", "германия": "germany",
    "италия": "italy", "франция": "france", "россия": "russia",
    "португалия": "portugal", "нидерланды": "netherlands", "бельгия": "belgium",
    "турция": "turkey", "япония": "japan", "китай": "china", "бразилия": "brazil",
    "аргентина": "argentina", "мексика": "mexico", "сша": "united states",
    "шотландия": "scotland", "украина": "ukraine", "беларусь": "belarus",
    "польша": "poland", "австрия": "austria", "швейцария": "switzerland",
    "дания": "denmark", "швеция": "sweden", "норвегия": "norway",
    "греция": "greece", "хорватия": "croatia", "сербия": "serbia",
    "чехия": "czech republic", "венгрия": "hungary", "румыния": "romania",
    "болгария": "bulgaria", "казахстан": "kazakhstan", "южная корея": "south korea",
    "саудовская аравия": "saudi arabia", "оаэ": "united arab emirates",
    "катар": "qatar", "иран": "iran", "австралия": "australia",
    "колумбия": "colombia", "чили": "chile", "уругвай": "uruguay",
    "парагвай": "paraguay", "перу": "peru", "эквадор": "ecuador",
    "марокко": "morocco", "египет": "egypt", "тунис": "tunisia",
    "алжир": "algeria", "нигерия": "nigeria", "юар": "south africa",
    "израиль": "israel", "кипр": "cyprus", "финляндия": "finland",
    "ирландия": "ireland", "уэльс": "wales", "словакия": "slovakia",
    "словения": "slovenia", "азербайджан": "azerbaijan", "армения": "armenia",
    "узбекистан": "uzbekistan", "индия": "india", "таиланд": "thailand",
    "индонезия": "indonesia", "вьетнам": "vietnam", "малайзия": "malaysia",
}


def norm_country(v):
    if not v:
        return None
    s = str(v).strip().lower()
    if not s:
        return None
    # «Испания. Ла Лига» — берём часть до точки.
    s = s.split(".")[0].strip()
    return COUNTRY_ALIASES.get(s, s if len(s) > 2 else None)


def sb_get(url, key, path, params):
    full = url.rstrip("/") + "/rest/v1/" + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        full, headers={"apikey": key, "Authorization": "Bearer " + key})
    with urllib.request.urlopen(req, timeout=60) as fh:
        return json.load(fh)


def sb_patch(url, key, path, params, body):
    full = url.rstrip("/") + "/rest/v1/" + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        full, data=json.dumps(body).encode(),
        headers={"apikey": key, "Authorization": "Bearer " + key,
                 "Content-Type": "application/json", "Prefer": "return=minimal"},
        method="PATCH")
    with urllib.request.urlopen(req, timeout=60) as fh:
        fh.read()


def env(name):
    if os.environ.get(name):
        return os.environ[name]
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        for line in io.open(path, encoding="utf-8"):
            if line.strip().startswith(name + "="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return None


def candidates_for(name):
    """Заголовки-кандидаты в порядке убывания точности."""
    n = (name or "").strip()
    if not n:
        return []
    return [n + " (футбольный клуб)", n]


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="сколько клубов (0 — все)")
    ap.add_argument("--sql-out", default=None, help="куда выписать UPDATE")
    ap.add_argument("--min-matches", type=int, default=1,
                    help="только клубы, сыгравшие хотя бы столько матчей")
    args = ap.parse_args()
    apply = os.environ.get("APPLY") == "1"

    url = env("VITE_SUPABASE_URL") or env("SUPABASE_URL")
    read_key = env("VITE_SUPABASE_ANON_KEY") or env("SUPABASE_KEY")
    write_key = env("SUPABASE_KEY")
    if not (url and read_key):
        raise SystemExit("нет VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY")
    if apply and not write_key:
        raise SystemExit("APPLY=1, но SUPABASE_KEY не задан — писать нечем")

    rows = sb_get(url, read_key, "football_club", {
        "select": "club_key,name,name_en,kind,country,league",
        "crest_url": "is.null", "name_en": "is.null",
        "order": "club_key", "limit": 2000})
    if args.limit:
        rows = rows[:args.limit]
    print("Клубов без герба и без name_en: %d  (APPLY=%s)"
          % (len(rows), "да" if apply else "нет — сухой прогон"), flush=True)

    cfg = json.load(io.open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))
    pv = cfg["pageviews"]
    cache = FileCache(os.path.join(SCRAPER, cfg["cache"]["dir"]), cfg["cache"]["enabled"])
    budget = WikimediaBudget(
        cfg.get("photos", {}).get("daily_request_budget", 5000),
        os.path.join(SCRAPER, cfg["cache"]["dir"], "photos_budget.json"))
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    ru = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget)

    allow = run.CARD_P31_ALLOW["club"]
    fills, skips = [], {}

    def skip(why):
        skips[why] = skips.get(why, 0) + 1

    for i, row in enumerate(rows, 1):
        name = (row.get("name") or "").strip()
        if not name:
            skip("пустое имя")
            continue

        def club_qid(cand):
            """QID заголовка, если это КЛУБ. ⚠️ Страница-неоднозначность
            («Вердер» — река, клуб, посёлок) несёт QID самой неоднозначности,
            а не клуба, и брать его нельзя — так карточка и получает чужое."""
            try:
                res = ru.qid_for_title(cand) or {}
            except Exception:                                     # noqa: BLE001
                return None
            if res.get("disambig"):
                return None
            q = res.get("qid")
            if not q:
                return None
            return q if set(wikidata.instance_of_qids(q)) & allow else None

        qid = title = None
        for cand in candidates_for(name):
            q = club_qid(cand)
            if q:
                qid, title = q, cand
                break
        if not qid:
            # Последняя попытка — полнотекстовый поиск: «Джубило Ивата» без
            # уточнения в заголовке не находится, а поиском находится.
            try:
                found = ru.search_titles(name + " футбольный клуб", limit=3)
            except Exception:                                     # noqa: BLE001
                found = []
            for cand in found:
                q = club_qid(cand)
                if q:
                    qid, title = q, cand
                    break
        if not qid:
            skip("клубная сущность не найдена")
            continue

        want = norm_country(row.get("country")) or norm_country(row.get("league"))
        got = None
        if want:
            try:
                for c_qid in wikidata.claim_qids(qid, "P17"):
                    got = wikidata.label_en_for_qid(c_qid)
                    if got:
                        break
            except Exception:                                     # noqa: BLE001
                got = None
            # Страна неизвестна — это НЕ повод отказать: у части клубов P17
            # просто не проставлен. Отказ только при явном расхождении.
            if got and norm_country(got) != want:
                skip("страна не совпала")
                continue

        titles = wikidata.titles_for_qid(qid) or {}
        en = titles.get("enwiki")
        if not en:
            skip("нет статьи в enwiki")
            continue

        fills.append({"club_key": row["club_key"], "name": name,
                      "name_en": en, "qid": qid, "via": title,
                      "country": got or want or ""})
        if i % 25 == 0:
            print("  %d/%d, найдено %d" % (i, len(rows), len(fills)), flush=True)

    print("-" * 78)
    print("FILL (нашлось английское имя): %d" % len(fills))
    for why, n in sorted(skips.items(), key=lambda kv: -kv[1]):
        print("SKIP %-34s %d" % (why, n))
    print("-" * 78)
    for f in fills[:40]:
        print("  %-22s %-30s %s" % (f["name"][:22], f["name_en"][:30], f["qid"]))

    if args.sql_out and fills:
        def q(v):
            return "'" + str(v).replace("'", "''") + "'"
        out = ["-- name_en клубам из ruwiki. Сгенерировано",
               "-- docs/clubs_name_en_from_ruwiki.py. Строк: %d." % len(fills),
               "-- Пишется только там, где name_en пуст."]
        for f in fills:
            out.append("update football_club set name_en = %s where club_key = %s "
                       "and name_en is null;  -- %s" % (q(f["name_en"]), q(f["club_key"]), f["qid"]))
        io.open(args.sql_out, "w", encoding="utf-8").write("\n".join(out) + "\n")
        print("SQL выписан в %s" % args.sql_out)

    if apply and fills:
        for f in fills:
            sb_patch(url, write_key, "football_club",
                     {"club_key": "eq." + f["club_key"], "name_en": "is.null"},
                     {"name_en": f["name_en"]})
        print("Записано: %d" % len(fills))
    elif fills:
        print("\nСУХОЙ ПРОГОН — ничего не записано. Повторить с APPLY=1.")


if __name__ == "__main__":
    main()
