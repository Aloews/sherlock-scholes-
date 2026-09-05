# -*- coding: utf-8 -*-
"""Мост «клуб → Transfermarkt» через Викиданные, для клубов без состава.

ЗАЧЕМ. `clubs_roster_transfermarkt.py` строит мост ГОЛОСОВАНИЕМ игроков: до
пяти человек из `club_squad`, у которых уже известен `cards.transfermarkt_id`.
Клубу, впервые появившемуся в расписании, голосовать некем — игроков ноль, и
состав ему не собрать никогда. Замер 05.09.2026: в расписании 435 клубов,
мост есть у 76.

ЦЕПОЧКА, ВСЯ НА ИДЕНТИФИКАТОРАХ ПОСЛЕ ПЕРВОГО ШАГА:

    name_en → поиск в Викиданных → QID с P7223 → verein → состав и стоимость

⚠️ P7223 ИЗМЕРЕНО, А НЕ УГАДАНО. У «Челси» Q9616 несёт P7223 = 631 — ровно
тот `verein/631`, что уже стоял в справочнике. Сверено глазами дальше: Кёльн
3, Аякс 610, Байер 15, Юнион Берлин 89, Анже 1420, Гвадалахара 6711.

⚠️ НАЛИЧИЕ P7223 — ЭТО И ЕСТЬ ГАРД. Отдельный список P31 («футбольный клуб»,
«спортивный клуб», «женская команда»…) пришлось бы вести руками и он всё
равно бы отстал. Сущность с идентификатором клуба на Transfermarkt — клуб на
Transfermarkt, по определению. Это тот же урок, что с P31=Q5 у игроков, но
без списка: гард выражен тем самым свойством, ради которого идёт запрос.

⚠️ НЕОДНОЗНАЧНОСТЬ — ОТКАЗ, А НЕ ВЫБОР. У «Анже» Викиданные знают и основную
команду, и «Angers SCO II». Берётся кандидат, чей английский ярлык РАВЕН
нашему имени, и только если такой один; иначе не берётся ничего. На выборке
из десяти — шесть взятых, четыре отказа («Viktoria Plzeň» против ярлыка
«FC Viktoria Plzeň»). Отказ дешевле чужого клуба: «Страсбур» уже получил
заявку «Челси» и все проверки при этом были зелены.

⚠️ СОПОСТАВЛЯЕТ БАЗА. Здесь только резолв имени во внешний идентификатор;
занятость `verein`, конфликты и запись — в `apply_club_transfermarkt_ids`.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет):
    python docs/clubs_transfermarkt_id_wikidata.py --limit 40
    APPLY=1 python docs/clubs_transfermarkt_id_wikidata.py --playing
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
TM_PROP = "P7223"          # Transfermarkt club ID — проверено на Q9616 → 631
SEARCH_LIMIT = 7
PAUSE = 3.0                # Викиданные режут агрессивно; замерено 429 на 0.5
RETRIES = 4
RETRY_PAUSE = 12.0
PAGE = 1000
RPC_BATCH = 25


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
    """PostgREST режет по db-max-rows=1000. Без страниц молчаливо теряется хвост."""
    out, offset = [], 0
    while True:
        page = sb(path, params=dict(params, limit=PAGE, offset=offset))
        out.extend(page)
        if len(page) < PAGE:
            return out
        offset += PAGE


def wd(params):
    """Ответ Викиданных или None. None — ПОТЕРЯ, а не «ничего не найдено»."""
    url = WD_API + "?" + urllib.parse.urlencode(dict(params, format="json"))
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as fh:
                return json.loads(fh.read())
        except Exception:                                        # noqa: BLE001
            if attempt + 1 == RETRIES:
                return None
            time.sleep(RETRY_PAUSE * (attempt + 1))
    return None


def pick(name, candidates):
    """Кандидат или (None, причина). ЧИСТАЯ ФУНКЦИЯ — её проверяет тест.

    candidates: [(qid, английский ярлык, id на Transfermarkt)], уже отобранные
    по наличию P7223.
    """
    if not candidates:
        return None, "нет кандидата с " + TM_PROP
    if len(candidates) == 1:
        return candidates[0], "один кандидат"
    exact = [c for c in candidates
             if (c[1] or "").strip().lower() == (name or "").strip().lower()]
    if len(exact) == 1:
        return exact[0], "ничья решена точным ярлыком (%d)" % len(candidates)
    return None, "ОТКАЗ: кандидатов %d, точных %d" % (len(candidates), len(exact))


def resolve(name):
    """(qid, tm_id, причина). Потеря источника отличается от отсутствия ответа."""
    r = wd({"action": "wbsearchentities", "search": name,
            "language": "en", "type": "item", "limit": SEARCH_LIMIT})
    if r is None:
        return None, None, "ПОТЕРЯ: поиск не ответил"
    ids = [h["id"] for h in r.get("search", [])]
    if not ids:
        return None, None, "в Викиданных не найден"
    e = wd({"action": "wbgetentities", "ids": "|".join(ids),
            "props": "claims|labels", "languages": "en"})
    if e is None:
        return None, None, "ПОТЕРЯ: сущности не ответили"
    cands = []
    for qid, ent in (e.get("entities") or {}).items():
        tm = [c["mainsnak"]["datavalue"]["value"]
              for c in ent.get("claims", {}).get(TM_PROP, [])
              if c.get("mainsnak", {}).get("datavalue")
              and c.get("rank") != "deprecated"]
        if tm:
            label = (ent.get("labels", {}).get("en", {}) or {}).get("value", "")
            cands.append((qid, label, str(tm[0])))
    hit, why = pick(name, cands)
    if not hit:
        return None, None, why
    return hit[0], hit[2], why


def clubs_to_do(playing_only, limit):
    """Клубы без моста. Сперва те, чьи матчи игрок реально видит."""
    rows = read_all("football_club", {
        "select": "club_key,name,name_en,country,league,crest_url",
        "kind": "eq.club", "transfermarkt_id": "is.null",
        "name_en": "not.is.null", "order": "club_key"})
    if playing_only:
        playing = {r["club_key"] for r in sb("rpc/clubs_in_fixtures", method="POST", body={})}
        rows = [r for r in rows if r["club_key"] in playing]
    return rows[:limit] if limit else rows


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="сколько клубов (0 — все)")
    ap.add_argument("--playing", action="store_true",
                    help="только те, кто есть в расписании матчей")
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"

    clubs = clubs_to_do(args.playing, args.limit)
    print("Клубов без моста в работе: %d  (APPLY=%s)"
          % (len(clubs), "да" if apply_ else "нет — сухой прогон"), flush=True)

    batch, found, refused, lost = [], 0, 0, 0

    def flush():
        """Запись ПО ХОДУ ЦИКЛА: оборванный прогон обязан оставить сделанное."""
        nonlocal batch
        if not (apply_ and batch):
            batch = []
            return
        res = sb("rpc/apply_club_transfermarkt_ids", method="POST",
                 body={"p_rows": batch})
        r0 = (res[0] if isinstance(res, list) else res) or {}
        print("    записано %s, занято другим клубом %s, из %s"
              % (r0.get("written"), r0.get("taken"), r0.get("seen")), flush=True)
        batch = []

    for club in clubs:
        qid, tm_id, why = resolve(club["name_en"])
        if tm_id:
            found += 1
            batch.append({"club_key": club["club_key"],
                          "transfermarkt_id": tm_id, "qid": qid})
        elif why.startswith("ПОТЕРЯ"):
            lost += 1
        else:
            refused += 1
        print("  %-26s %-30s %-16s %s"
              % (club["club_key"][:26], (club["name_en"] or "")[:30],
                 ("verein/" + tm_id) if tm_id else "—", why), flush=True)
        if len(batch) >= RPC_BATCH:
            flush()
        time.sleep(PAUSE)

    flush()
    print("-" * 74)
    print("Мостов найдено   : %d" % found)
    print("Отказов          : %d — неоднозначно или нет %s" % (refused, TM_PROP))
    if lost:
        print("⚠️ ПОТЕРЯНО ОТВЕТОВ: %d — их пустота НИЧЕГО не значит, "
              "повторить прогон" % lost)
    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")


if __name__ == "__main__":
    main()
