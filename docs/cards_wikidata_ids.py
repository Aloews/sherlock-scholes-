# -*- coding: utf-8 -*-
"""Внешние идентификаторы карточек: QID, Transfermarkt (P2446), страна (P27).

ЗАЧЕМ. Обогащать карточку можно только по QID — резолв по ИМЕНИ промахивается
и промахивается МОЛЧА. Замер 03.09.2026 на первых четырёх карточках очереди:
«Гарри Невилл» (в ру-вики «Невилл, Гари»), «Хын Мин Сон» («Сон Хын Мин»),
«Расмус Хёйлунн», «Скотт МакТоминэй» — 4 из 4 не найдены. До 04.09.2026 QID
846 заведённых карточек жил в файле репозитория, потому что колонки не было;
теперь он в `cards.wikidata_qid`, и этот скрипт его туда кладёт.

ЦЕПОЧКА ДО СТОИМОСТИ, замерена целиком, а не выведена по имени:

    QID → wdt:P2446 (id Transfermarkt) → профиль по id → текущая стоимость

⚠️ P2446 БЕРЁТСЯ ЧЕРЕЗ wbgetentities, А НЕ ЧЕРЕЗ SPARQL. WDQS при
лимитировании прямо пишет «Aggressively rate-limiting to 1 req / min», и
замер той же выборки дал: SPARQL — ноль ответов, wbgetentities — 605 значений
из 846. Это два РАЗНЫХ лимита у одного проекта, и второй отвечает, когда
первый молчит.

⚠️ СТРАНА ПИШЕТСЯ ТОЛЬКО ПРИ ОДНОМ ГРАЖДАНСТВЕ. P27 бывает несколько — у
Джеффа Эхатора Италия и Нигерия, у Байрактаревича США и Босния, — и выбрать
одну наугад значит записать неверную. Двойным гражданам страна остаётся
пустой: «не знаем» честнее выдуманного.

⚠️ ISO-КОД БЕРЁТСЯ ИЗ ВИКИДАННЫХ (P297), А НЕ ИЗ СЛОВАРЯ В ЭТОМ ФАЙЛЕ.
`cards.country` — это alpha-2 («RU», «TJ», «LU»), и рукописная таблица
«QID страны → код» разошлась бы с источником молча. Стран в выборке две
сотни, спрашиваются они одной пачкой.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет через RPC одной транзакцией):
    python docs/cards_wikidata_ids.py --from-tsv docs/data/new_player_cards_2026-09-03.tsv
    APPLY=1 python docs/cards_wikidata_ids.py --from-tsv docs/data/...tsv
    APPLY=1 python docs/cards_wikidata_ids.py --from-db --limit 500
"""
import argparse
import importlib.util
import io
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

_spec = importlib.util.spec_from_file_location(
    "cards_pageviews_i18n", os.path.join(HERE, "cards_pageviews_i18n.py"))
pvi = importlib.util.module_from_spec(_spec)
sys.modules["cards_pageviews_i18n"] = pvi
_spec.loader.exec_module(pvi)

WD_BATCH = 50
# Одна пачка RPC — одна транзакция. Потолок не про производительность, а про
# размер тела запроса: PostgREST режет слишком большое, и обрыв посреди
# выписки уже закрывал в этом проекте 253 строки состава.
RPC_BATCH = 400


def cards_from_tsv(path):
    """[(card_id, name, qid)] из card_id\tname_ru\tname_en\tqid."""
    out = []
    for line in io.open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line or line.startswith("#"):
            continue
        p = line.split("\t")
        if len(p) >= 4 and p[3].startswith("Q"):
            out.append((p[0], p[1], p[3]))
    return out


# PostgREST режет ответ по db-max-rows (у этого проекта 1000). Одна страница
# на 1000 строк молча выглядит как «столько и есть» — этот проект уже читал
# «карточек в колоде: 1000» как нормальное число.
PAGE = 1000


def cards_from_db(limit):
    """Карточки, у которых QID УЖЕ есть, но нет id Transfermarkt.

    Это второй заход того же скрипта: QID проставлен прошлым прогоном (или
    резолвом фото/описаний), а P2446 ещё не спрашивали.

    Читается СТРАНИЦАМИ и обязательно с `order`: без устойчивого порядка
    смещение отдаёт другую выборку — часть строк придёт дважды, часть не
    придёт вовсе.
    """
    out, offset = [], 0
    while True:
        page = pvi.sb("cards", params={
            "select": "id,name,wikidata_qid",
            "wikidata_qid": "not.is.null",
            "transfermarkt_id": "is.null",
            "order": "id", "limit": str(PAGE), "offset": str(offset)}).json()
        out.extend((r["id"], r.get("name") or r["id"], r["wikidata_qid"])
                   for r in page)
        if len(page) < PAGE or (limit and len(out) >= limit):
            return out[:limit] if limit else out
        offset += PAGE


def claims_for(qids, props="claims"):
    """QID -> claims. Батчами по 50, с откатом на 429/maxlag."""
    out = {}
    for i in range(0, len(qids), WD_BATCH):
        chunk = qids[i:i + WD_BATCH]
        time.sleep(pvi.WD_BATCH_PAUSE)
        r = pvi.get_with_retry(pvi.WD_API, params={
            "action": "wbgetentities", "format": "json",
            "ids": "|".join(chunk), "props": props, "maxlag": "5"})
        r.raise_for_status()
        for qid, ent in (r.json().get("entities") or {}).items():
            out[qid] = ent.get("claims") or {}
        print("  wbgetentities: %d/%d" % (min(i + WD_BATCH, len(qids)), len(qids)),
              flush=True)
    return out


def _values(claims, prop):
    """Значения свойства как список; у внешнего id это строки, у ссылки — QID."""
    vals = []
    for c in claims.get(prop) or []:
        # Устаревшее заявление (rank = deprecated) — это ПОМЕЧЕННАЯ ОШИБКА
        # источника, а не старое значение. Брать его нельзя.
        if c.get("rank") == "deprecated":
            continue
        v = (c.get("mainsnak") or {}).get("datavalue", {}).get("value")
        if isinstance(v, dict):
            v = v.get("id")
        if v:
            vals.append(v)
    return vals


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from-tsv", default=None,
                    help="таблица card_id\tname_ru\tname_en\tqid")
    ap.add_argument("--from-db", action="store_true",
                    help="карточки с готовым QID, но без id Transfermarkt")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sql-out", default=None,
                    help="выписать UPDATE'ы вместо записи (для глаз)")
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"

    if args.from_tsv:
        cards = cards_from_tsv(args.from_tsv)
    elif args.from_db:
        cards = cards_from_db(args.limit)
    else:
        raise SystemExit("нужен --from-tsv или --from-db")
    if args.limit:
        cards = cards[:args.limit]
    if not cards:
        raise SystemExit("ни одной карточки с QID — не тот вход?")
    print("Карточек с QID: %d" % len(cards))

    qids = sorted({q for _i, _n, q in cards})
    claims = claims_for(qids)
    print("Сущностей получено: %d из %d" % (len(claims), len(qids)))

    # Страны: сначала собираем QID стран, потом ОДНОЙ пачкой спрашиваем их
    # alpha-2. Словарь «QID → код» в этом файле не заводится намеренно.
    country_qids = set()
    for cl in claims.values():
        vs = _values(cl, "P27")
        if len(vs) == 1:
            country_qids.add(vs[0])
    iso = {}
    if country_qids:
        print("Стран к резолву: %d" % len(country_qids))
        for cq, cl in claims_for(sorted(country_qids)).items():
            codes = _values(cl, "P297")
            if codes:
                iso[cq] = codes[0].upper()
        print("Стран с alpha-2: %d" % len(iso))

    rows, no_tm, dual, no_entity = [], 0, 0, 0
    for card_id, name, qid in cards:
        cl = claims.get(qid)
        if cl is None:
            no_entity += 1
            continue
        tm = _values(cl, "P2446")
        p27 = _values(cl, "P27")
        if not tm:
            no_tm += 1
        if len(p27) > 1:
            dual += 1
        country = iso.get(p27[0]) if len(p27) == 1 else None
        rows.append({"card_id": card_id, "qid": qid,
                     "transfermarkt_id": tm[0] if tm else None,
                     "country": country})

    print("-" * 70)
    print("Строк к записи             : %d" % len(rows))
    print("Из них с id Transfermarkt  : %d" % sum(1 for r in rows if r["transfermarkt_id"]))
    print("Из них со страной          : %d" % sum(1 for r in rows if r["country"]))
    print("Без P2446 у источника      : %d" % no_tm)
    print("Двойное гражданство        : %d — страна оставлена пустой" % dual)
    if no_entity:
        print("⚠️ СУЩНОСТЕЙ НЕ ПРИШЛО      : %d — это потеря ответа, а не "
              "отсутствие данных. Повторить прогон." % no_entity)
    for r in rows[:8]:
        nm = next(n for i, n, _q in cards if i == r["card_id"])
        print("  %-28s %-11s TM=%-9s %s" % (nm[:27], r["qid"],
                                            r["transfermarkt_id"] or "-",
                                            r["country"] or "-"))

    if args.sql_out:
        out = ["-- Внешние идентификаторы карточек (docs/cards_wikidata_ids.py).",
               "-- Строк: %d." % len(rows), "begin;"]
        for r in rows:
            sets = ["wikidata_qid = coalesce(wikidata_qid, '%s')" % r["qid"]]
            if r["transfermarkt_id"]:
                sets.append("transfermarkt_id = coalesce(transfermarkt_id, '%s')"
                            % r["transfermarkt_id"])
            if r["country"]:
                sets.append("country = coalesce(country, '%s')" % r["country"])
            out.append("update cards set %s where id = '%s';"
                       % (", ".join(sets), r["card_id"]))
        out.append("commit;")
        io.open(args.sql_out, "w", encoding="utf-8").write("\n".join(out) + "\n")
        print("SQL выписан в %s" % args.sql_out)

    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")
        return

    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_KEY"]
    written = seen = 0
    for i in range(0, len(rows), RPC_BATCH):
        body = json.dumps({"p_rows": rows[i:i + RPC_BATCH]}).encode()
        req = urllib.request.Request(
            url + "/rest/v1/rpc/apply_card_wikidata_ids", data=body,
            headers={"apikey": key, "Authorization": "Bearer " + key,
                     "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=180) as fh:
            res = json.load(fh)
        r0 = res[0] if isinstance(res, list) else res
        written += r0["written"]
        seen += r0["seen"]
        print("  записано %d из %d (пачка %d)" % (r0["written"], r0["seen"],
                                                  i // RPC_BATCH + 1), flush=True)
    print("ИТОГО записано: %d из %d прочитанных" % (written, seen))


if __name__ == "__main__":
    main()
