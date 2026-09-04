# -*- coding: utf-8 -*-
"""Связать полный состав клуба с карточками колоды — по идентификатору.

ЗАЧЕМ. `apply_club_roster` связывает строку ростера с карточкой только по
`cards.transfermarkt_id`, а его нет у 1783 активных карточек игроков: 1633
строки из 2644 остались без карточки. Читалось это как «состав шире колоды»,
а на деле Беллингем в колоде ЕСТЬ — активная карточка с фото, и он стоит в
`card_current_club` у «Реала», то есть и в фэнтези. Просто моста не было.

ЦЕПОЧКА, ВСЯ НА ИДЕНТИФИКАТОРАХ:

    id на Transfermarkt → (wdt:P2446, обратно) → QID → cards.wikidata_qid

⚠️ ЗАПРОС ИДЁТ В WDQS, И ЭТО ТОТ СЛУЧАЙ, КОГДА ОН УМЕСТЕН. Здесь нужен
ОБРАТНЫЙ поиск — «у кого P2446 равен вот этим двум с половиной тысячам
значений», — а `wbgetentities` умеет только «дай свойства вот этой сущности».
Одним запросом на пачку вместо перебора.

⚠️ ВТОРОЙ ПУТЬ — ТОЧНОЕ ЛАТИНСКОЕ ИМЯ В ПРЕДЕЛАХ КЛУБА, и он живёт в SQL
(`link_roster_to_cards`), а не здесь: сопоставляет база, у неё словарь
псевдонимов клубов. Это не похожесть, а равенство строки, суженное клубом.

ЗАПУСК (сухой по умолчанию; APPLY=1 связывает):
    python docs/roster_link_cards.py
    APPLY=1 python docs/roster_link_cards.py
"""
import argparse
import json
import os
import time
import urllib.parse
import urllib.request

UA = ("sherlock-scholes-i18n-pageviews/1.1 "
      "(https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
WDQS = "https://query.wikidata.org/sparql"
CHUNK = 500
# WDQS при лимитировании прямо пишет «1 req / min». Откат короче заявленного
# лимита — это отсутствие отката.
RATE_PAUSE = 65.0
RETRIES = 4
PAGE = 1000


def sb(path, method="GET", body=None, params=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    key = os.environ["SUPABASE_KEY"]
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "apikey": key, "Authorization": "Bearer " + key,
        "Content-Type": "application/json"})
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


def qids_for_tm(tm_ids):
    """{id на TM: QID} обратным запросом по P2446. Потери считаются."""
    out, lost = {}, 0
    for i in range(0, len(tm_ids), CHUNK):
        part = tm_ids[i:i + CHUNK]
        q = ('SELECT ?tm ?p WHERE { VALUES ?tm { %s } ?p wdt:P2446 ?tm . }'
             % " ".join('"%s"' % t for t in part))
        got = None
        for attempt in range(RETRIES):
            try:
                req = urllib.request.Request(
                    WDQS, data=urllib.parse.urlencode({"query": q}).encode(),
                    headers={"User-Agent": UA,
                             "Accept": "application/sparql-results+json"})
                got = json.load(urllib.request.urlopen(req, timeout=180))
                break
            except Exception as exc:                            # noqa: BLE001
                if attempt + 1 == RETRIES:
                    print("  ⚠️ пачка %d потеряна: %s" % (i // CHUNK, str(exc)[:60]),
                          flush=True)
                else:
                    time.sleep(RATE_PAUSE)
        if got is None:
            lost += len(part)
            continue
        for b in got["results"]["bindings"]:
            out[b["tm"]["value"]] = b["p"]["value"].rsplit("/", 1)[-1]
        print("  P2446: %d/%d, найдено %d" % (min(i + CHUNK, len(tm_ids)),
                                              len(tm_ids), len(out)), flush=True)
        time.sleep(2.0)
    return out, lost


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"

    rows = read_all("club_roster", {"select": "tm_player_id,card_id,name,club_key",
                                    "card_id": "is.null", "order": "club_key,tm_player_id"})
    if args.limit:
        rows = rows[:args.limit]
    tm_ids = sorted({r["tm_player_id"] for r in rows})
    print("Строк ростера без карточки: %d (уникальных игроков %d)"
          % (len(rows), len(tm_ids)))
    if not tm_ids:
        print("Связывать нечего.")
        return

    qid_of, lost = qids_for_tm(tm_ids)
    print("-" * 70)
    print("QID найден у %d из %d" % (len(qid_of), len(tm_ids)))
    if lost:
        print("⚠️ ОТВЕТОВ ПОТЕРЯНО: %d — их пустота НИЧЕГО не значит, "
              "повторить прогон" % lost)

    if not apply_:
        print("\nСухой прогон. APPLY=1 — связать.")
        return

    payload = [{"tm_player_id": t, "qid": q} for t, q in qid_of.items()]
    res = sb("rpc/link_roster_to_cards", method="POST", body={"p_rows": payload})
    r0 = (res[0] if isinstance(res, list) else res) or {}
    print("Связано по QID              : %s" % r0.get("by_qid"))
    print("Связано точным именем в клубе: %s" % r0.get("by_name"))
    if r0.get("ambiguous"):
        print("⚠️ Неоднозначных отброшено   : %s — на строку претендовали две "
              "карточки или наоборот" % r0["ambiguous"])

    # ⚠️ ВТОРОЙ ШАГ, БЕЗ КОТОРОГО ПОЧИНКА НЕ ЗАКАНЧИВАЕТСЯ. У 120 карточек QID
    # пришлось снять — он указывал на страницу ФАМИЛИИ, и по ней же сняты
    # просмотры (у Беллингема отсюда fame = 7). Ночной резолв идёт по имени и
    # с новым P31-гардом ту же страницу отвергнет, то есть карточка осталась
    # бы без QID навсегда. Ростер даёт верный QID по идентификатору.
    #
    # ⚠️ ВЫБОРКА ЗДЕСЬ ДРУГАЯ, И ЭТО НЕ МЕЛОЧЬ. Связывать надо строки БЕЗ
    # карточки, а чинить QID — у тех, кто карточку УЖЕ имеет. Первый прогон
    # подавал сюда тот же список и дописал два QID вместо сотни.
    need_qid = read_all("club_roster",
                        {"select": "tm_player_id,cards!inner(wikidata_qid)",
                         "card_id": "not.is.null",
                         "cards.wikidata_qid": "is.null",
                         "order": "tm_player_id"})
    need_ids = sorted({r["tm_player_id"] for r in need_qid})
    print("-" * 70)
    print("Связанных карточек без QID: %d" % len(need_ids))
    extra, lost2 = ({}, 0)
    if need_ids:
        extra, lost2 = qids_for_tm(need_ids)
        if lost2:
            print("⚠️ ОТВЕТОВ ПОТЕРЯНО: %d" % lost2)
    payload2 = [{"tm_player_id": t, "qid": q}
                for t, q in dict(qid_of, **extra).items()]
    res2 = sb("rpc/backfill_card_qid_from_roster", method="POST",
              body={"p_rows": payload2})
    r2 = (res2[0] if isinstance(res2, list) else res2) or {}
    print("QID дописан карточкам       : %s" % r2.get("written"))
    if r2.get("taken"):
        print("  из них пропущено          : %s — QID уже занят другой "
              "карточкой (дубль в колоде)" % r2["taken"])


if __name__ == "__main__":
    main()
