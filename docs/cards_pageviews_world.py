# -*- coding: utf-8 -*-
"""Просмотры по ВСЕМ языковым разделам, а не по девяти локалям интерфейса.

ЗАЧЕМ, ОДНИМ ЗАМЕРОМ. `cards.pageviews_i18n` наполнялся списком
LANGS = ru en es pt fr zh ja ko ar — это девять локалей ПРИЛОЖЕНИЯ, а не
девять языков, на которых читают про футболистов. Замер 04.09.2026 на боевых
данных:

    активных игроков                                     2918
    из них БЕЗ ЕДИНОГО просмотра на языке своей страны    1452   (49.8 %)

Половина колоды. Турка меряют по-русски и по-испански, поляка — по-английски
и по-арабски, серба, украинца, грека, иранца, вьетнамца — тем же. Кореец,
японец и китаец в девятку попали, и именно поэтому дыра выглядела маленькой:
её закрывали как раз те три языка, из-за которых её и заметили.

ЧТО СОБИРАЕТСЯ. Языки берутся не списком, а ИЗ САМОЙ СУЩНОСТИ: `wbgetentities`
отдаёт sitelinks — все разделы, где статья про этого человека есть. Из них
спрашиваются:

  --home  (по умолчанию)  языки страны карточки (country_wiki_lang) плюс
                          девять локалей. Дёшево и закрывает ту самую дыру.
  --all                   все разделы, где статья есть. Дороже примерно
                          вдвое (медиана 20 разделов на карточку, среднее
                          21.6, максимум 54 — замер на 50 новых карточках),
                          зато `fame_world` становится настоящей суммой.

⚠️ УЖЕ СОБРАННЫЙ ЯЗЫК НЕ ПЕРЕСПРАШИВАЕТСЯ. Бюджет Wikimedia конечен, и
повторный прогон обязан добирать, а не начинать сначала.

⚠️ ЗАПИСЬ — СЛИЯНИЕ, А НЕ ЗАМЕНА. `merge_card_pageviews` дописывает языки к
уже лежащим (`||`). Присваивание целиком стёрло бы то, что собрал соседний
скрипт другой выборкой языков, и обнаружилось бы это только тем, что
известность у половины колоды однажды «упала».

⚠️ КЛЮЧ SITELINK — НЕ КОД ЯЗЫКА. `enwiki` → `en`, но `commonswiki`,
`specieswiki`, `metawiki` — вообще не языки, а `be_x_oldwiki` пишется через
подчёркивания. Отсев идёт по ЖИВОМУ списку sitematrix, а не по догадке о том,
что «wiki на конце значит язык».

⚠️ ПИШЕТСЯ ПО ХОДУ, А НЕ В КОНЦЕ. Прогон идёт часами, и «собрать всё в
массив, записать после цикла» означает, что обрыв теряет ВСЁ, а не последнюю
пачку. Этот проект уже так терял целый прогон (WORKER_RESOURCE_LIMIT на 23
турнирах записал ноль строк), а прошлая сессия оборвалась между шагами и
закрыла 253 строки состава. Каждая пачка — одна транзакция и идемпотентна,
поэтому повтор после обрыва просто добирает недостающее.

⚠️ ПОСЛЕ ПРОГОНА ОБЯЗАТЕЛЕН refresh_card_fame(). Слава — перцентиль, и новые
просмотры двигают шкалу; без пересчёта собранное не доедет ни до колоды, ни
до уровня состава в прогнозах.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет через RPC):
    python docs/cards_pageviews_world.py --limit 20
    APPLY=1 python docs/cards_pageviews_world.py --home --limit 600
    APPLY=1 python docs/cards_pageviews_world.py --all  --limit 300
"""
import argparse
import collections
import importlib.util
import io
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.join(os.path.dirname(HERE), "football_scraper")

_spec = importlib.util.spec_from_file_location(
    "cards_pageviews_i18n", os.path.join(HERE, "cards_pageviews_i18n.py"))
pvi = importlib.util.module_from_spec(_spec)
sys.modules["cards_pageviews_i18n"] = pvi
_spec.loader.exec_module(pvi)

SITEMATRIX = ("https://meta.wikimedia.org/w/api.php?action=sitematrix"
              "&format=json&smtype=language&smlangprop=code|site")
PAGE = 1000          # PostgREST режет по db-max-rows; читать надо страницами

# ⚠️ ПАУЗА В СЕКУНДУ, А НЕ 0.15. Замер 04.09.2026: на 0.15 с (унаследованной у
# cards_pageviews_by_qid) wikimedia.org отвечал 429 тринадцать раз за первые
# 25 карточек, а каждый отказ стоит минуты ожидания — то есть быстрая пауза
# оказалась ВДВОЕ МЕДЛЕННЕЕ медленной. Секунда — тот же контракт вежливости,
# что у всего остального конвейера (min_pause_seconds в config.json).
PV_PAUSE = 1.0
WD_BATCH = 50
RPC_BATCH = 200


def live_wikipedias():
    """Коды живых языковых Википедий. Кешируется на диск скрапера."""
    path = os.path.join(SCRAPER, "cache", "sitematrix.json")
    if os.path.exists(path):
        return set(json.load(io.open(path, encoding="utf-8")))
    r = pvi.get_with_retry(SITEMATRIX)
    r.raise_for_status()
    out = set()
    for k, v in (r.json().get("sitematrix") or {}).items():
        if not k.isdigit():
            continue
        for s in v.get("site") or []:
            if s.get("code") == "wiki" and not s.get("closed"):
                out.add(v["code"])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(sorted(out), io.open(path, "w", encoding="utf-8"))
    return out


def all_sitelinks(qids, wikis):
    """QID -> {lang: title} по ВСЕМ разделам, отсеяно по живому sitematrix.

    Отдельная функция, а не правка sitelinks_for_qids: там задан вопрос «дай
    девять локалей интерфейса», здесь — «дай все языки, где статья есть». Это
    разные вопросы, и склеивать их в один флаг значит однажды получить не тот.
    """
    out = {}
    qids = sorted({q for q in qids if q})
    for j in range(0, len(qids), WD_BATCH):
        time.sleep(pvi.WD_BATCH_PAUSE)
        r = pvi.get_with_retry(pvi.WD_API, params={
            "action": "wbgetentities", "format": "json",
            "ids": "|".join(qids[j:j + WD_BATCH]), "props": "sitelinks",
            "maxlag": "5"})
        r.raise_for_status()
        for qid, ent in (r.json().get("entities") or {}).items():
            links = {}
            for site, v in (ent.get("sitelinks") or {}).items():
                if not site.endswith("wiki"):
                    continue
                lang = site[:-4].replace("_", "-")
                if lang in wikis:
                    links[lang] = v["title"]
            out[qid] = links
        print("  sitelinks: %d/%d" % (min(j + WD_BATCH, len(qids)), len(qids)),
              flush=True)
    return out


def country_langs():
    """{страна: [языки]} из БАЗЫ — правило одно и оно серверное."""
    out, offset = collections.defaultdict(list), 0
    while True:
        page = pvi.sb("country_wiki_lang", params={
            "select": "country_code,lang", "order": "country_code,lang",
            "limit": str(PAGE), "offset": str(offset)}).json()
        for r in page:
            out[r["country_code"]].append(r["lang"])
        if len(page) < PAGE:
            return out
        offset += PAGE


def pick_cards(limit, only_missing_home, cmap, countries=None):
    """Карточки игроков, которым сбор нужнее всего.

    Порядок — по славе вниз: бюджет тратится на тех, кого игрок увидит.
    """
    out, offset = [], 0
    while True:
        page = pvi.sb("cards", params={
            "select": "id,name,country,fame,wikidata_qid,pageviews_i18n",
            "category": "eq.player",
            "order": "fame.desc.nullslast,id",
            "limit": str(PAGE), "offset": str(offset)}).json()
        for c in page:
            if countries and (c.get("country") or "") not in countries:
                continue
            have = set((c.get("pageviews_i18n") or {}).keys())
            want = set(cmap.get(c.get("country") or "", []))
            if only_missing_home and want and want <= have:
                continue          # дома уже измерен — не тратим бюджет
            out.append(c)
        if len(page) < PAGE or (limit and len(out) >= limit):
            return out[:limit] if limit else out
        offset += PAGE


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--home", action="store_true",
                   help="языки страны карточки плюс девять локалей (по умолчанию)")
    g.add_argument("--all", dest="all_langs", action="store_true",
                   help="все разделы, где статья есть")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--countries", default=None,
                    help="только эти страны через запятую (TR,PL,RS…). Бюджет "
                         "конечен, и тратить его стоит сначала на те, чей язык "
                         "в девятку локалей не входит вовсе")
    ap.add_argument("--sql-out", default=None)
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"

    wikis = live_wikipedias()
    print("Живых языковых Википедий: %d" % len(wikis))
    cmap = country_langs()
    print("Стран в карте языков    : %d" % len(cmap))

    only = {c.strip().upper() for c in (args.countries or "").split(",") if c.strip()}
    if only:
        print("Отбор по странам        : %s" % ", ".join(sorted(only)))
    cards = pick_cards(args.limit, not args.all_langs, cmap, only or None)
    print("Карточек в работе       : %d" % len(cards))
    if not cards:
        print("Дома измерены все — собирать нечего.")
        return

    # QID: из базы, а у кого его нет — резолвом по ру-титулу, батчами по 50.
    need = [c for c in cards if not c.get("wikidata_qid")]
    print("Без QID в базе          : %d — резолвятся по титулу ру-вики" % len(need))
    for i in range(0, len(need), WD_BATCH):
        chunk = need[i:i + WD_BATCH]
        by_title = pvi.qids_for_ru_titles([c["name"] for c in chunk])
        for c in chunk:
            c["wikidata_qid"] = by_title.get(c["name"])
        print("  qid: %d/%d" % (min(i + WD_BATCH, len(need)), len(need)), flush=True)

    resolved = [c for c in cards if c.get("wikidata_qid")]
    print("С QID                   : %d из %d" % (len(resolved), len(cards)))

    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_KEY", "")

    # ⚠️ QID СОХРАНЯЮТСЯ ДО фазы просмотров, а не после неё. Резолв стоит
    # дорого, фаза просмотров идёт часами, и обрыв между ними выбросил бы
    # всю работу резолвера. Следующий прогон её тогда повторяет с нуля.
    if apply_ and need:
        ids = [{"card_id": c["id"], "qid": c["wikidata_qid"]}
               for c in need if c.get("wikidata_qid")]
        saved, clashes = 0, 0
        for i in range(0, len(ids), RPC_BATCH):
            r = _rpc(url, key, "apply_card_wikidata_ids",
                     {"p_rows": ids[i:i + RPC_BATCH]})
            r0 = r[0] if isinstance(r, list) else r
            saved += r0["written"]
            clashes += r0.get("conflicts") or 0
        print("QID сохранено в базу    : %d" % saved, flush=True)
        if clashes:
            # ⚠️ Это НЕ помеха сбору, а находка: один QID у двух карточек —
            # дубль в колоде. Печатается поимённо, иначе число ни о чём.
            print("⚠️ ОДИН QID У ДВУХ КАРТОЧЕК: %d — это дубли в колоде, "
                  "проверить глазами:" % clashes, flush=True)
            for row in _rpc(url, key, "card_qid_conflicts", {"p_rows": ids})[:20]:
                print("    %-11s %-26s ← уже у %-26s (active=%s)"
                      % (row["qid"], (row["card_name"] or "")[:25],
                         (row["holder_name"] or "")[:25], row["holder_active"]))

    links = all_sitelinks([c["wikidata_qid"] for c in resolved], wikis)
    depth = [len(links.get(c["wikidata_qid"]) or {}) for c in resolved]
    if depth:
        print("Разделов на карточку    : медиана %d, максимум %d"
              % (sorted(depth)[len(depth) // 2], max(depth)))

    start, end = pvi.month_window()
    print("Окно                    : %s..%s" % (start, end))

    rows, asked, got, no_article = [], 0, 0, 0
    written, pending = 0, []

    def flush():
        """Записать накопленное. Одна пачка — одна транзакция, повтор — no-op."""
        nonlocal written, pending
        if not (apply_ and pending):
            pending = []
            return
        r = _rpc(url, key, "merge_card_pageviews", {"p_rows": pending})
        r0 = r[0] if isinstance(r, list) else r
        written += r0["written"]
        print("    записано %d из %d (всего %d)"
              % (r0["written"], r0["seen"], written), flush=True)
        pending = []

    for n, c in enumerate(resolved, 1):
        titles = links.get(c["wikidata_qid"]) or {}
        if not titles:
            no_article += 1
            continue
        have = set((c.get("pageviews_i18n") or {}).keys())
        if args.all_langs:
            want = set(titles)
        else:
            want = (set(cmap.get(c.get("country") or "", [])) | set(pvi.LANGS)) \
                   & set(titles)
        want -= have                       # уже собранное не переспрашиваем
        views = {}
        for lang in sorted(want):
            asked += 1
            try:
                v = pvi.views_12m(lang, titles[lang], start, end)
            except Exception:                                   # noqa: BLE001
                v = None
            if v is not None:
                views[lang] = v
                got += 1
            time.sleep(PV_PAUSE)
        if views:
            rows.append({"card_id": c["id"], "views": views})
            pending.append({"card_id": c["id"], "views": views})
        if len(pending) >= RPC_BATCH:
            flush()
        if n % 25 == 0 or n == len(resolved):
            print("  %d/%d  запрошено %d, получено %d" % (n, len(resolved), asked, got),
                  flush=True)
    flush()

    print("-" * 70)
    print("Карточек с новыми языками : %d" % len(rows))
    print("Запросов просмотров       : %d, ответов с числом: %d" % (asked, got))
    print("Статьи нет ни на одном яз.: %d" % no_article)
    for r in rows[:6]:
        nm = next(c["name"] for c in resolved if c["id"] == r["card_id"])
        top = sorted(r["views"].items(), key=lambda kv: -kv[1])[:4]
        print("  %-26s %s" % (nm[:25], ", ".join("%s=%d" % kv for kv in top)))

    if args.sql_out:
        out = ["-- Просмотры по всем языкам (docs/cards_pageviews_world.py).",
               "-- Строк: %d. Окно %s..%s." % (len(rows), start, end),
               "-- ⚠️ Слияние, а не замена: || к уже лежащему.",
               "-- ⚠️ ПОСЛЕ применения обязателен select refresh_card_fame().",
               "begin;"]
        for r in rows:
            out.append("update cards set pageviews_i18n = "
                       "coalesce(pageviews_i18n, '{}'::jsonb) || '%s'::jsonb "
                       "where id = '%s';"
                       % (json.dumps(r["views"], ensure_ascii=False).replace("'", "''"),
                          r["card_id"]))
        out.append("commit;")
        io.open(args.sql_out, "w", encoding="utf-8").write("\n".join(out) + "\n")
        print("SQL выписан в %s" % args.sql_out)

    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")
        return

    print("ИТОГО карточек обновлено: %d" % written)
    print("⚠️ Теперь обязателен: python docs/cards_fame_refresh.py")


def _rpc(url, key, name, body):
    req = urllib.request.Request(
        url + "/rest/v1/rpc/" + name, data=json.dumps(body).encode(),
        headers={"apikey": key, "Authorization": "Bearer " + key,
                 "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as fh:
        return json.load(fh)


if __name__ == "__main__":
    main()
