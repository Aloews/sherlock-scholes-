# -*- coding: utf-8 -*-
"""Карточки игроков из составов клубов — БЕЗ требования статьи в ру-Википедии.

ЧТО МЕШАЛО. Резолв в `scraper/wikidata.py` описан в его же шапке: «footballer
match WITH a ruwiki article → name_ru set, source=wikidata, high; no russian
article → name_ru=null, source=none, low». Футболист без статьи в РУССКОЙ
Википедии карточкой стать не мог в принципе — сколько бы о нём ни знал
остальной мир. Здесь этого гейта нет.

ЦЕПОЧКА, ВСЯ НА ИДЕНТИФИКАТОРАХ:

    club_roster.tm_player_id → (wdt:P2446, обратно) → QID → ярлыки ВСЕХ языков

⚠️ ПОИСКА ПО ИМЕНИ ЗДЕСЬ НЕТ ВОВСЕ, и это важно. Прошлый резолв шёл по титулу
ру-вики и привёл «Беллингема» на страницу ФАМИЛИИ (Q16479897), а «Халка» — на
персонажа Marvel (Q188760) со славой 90. Обратный поиск по P2446 таких ошибок
не допускает: идентификатор либо принадлежит человеку, либо нет.

⚠️ ДВА ГАРДА, А НЕ ОДИН. P31 = Q5 (человек) И P106 = Q937857 (футболист).
Первого мало: у клуба на Transfermarkt есть страницы тренеров и функционеров.

⚠️ ИМЯ БЕРЁТСЯ ИЗ ЛЮБЫХ ЯЗЫКОВ, русский — лишь один из девяти. Нет русского
ярлыка — берётся латинский, и карточка всё равно заводится: требование статьи
в ру-вики касается ПОЛЬЗОВАТЕЛЯ, а не игрока.

⚠️ КАРТОЧКИ ЗАВОДЯТСЯ АКТИВНЫМИ — решение владельца, отменяющее прежнее
правило «голые карточки нельзя». Его довод: нынешних игроков «уже все выучили
и они повторяются», нужны все футболисты. Сузить колоду до знаменитых
по-прежнему можно фильтром `fame_min`.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет):
    python docs/cards_from_roster.py --limit 200
    APPLY=1 python docs/cards_from_roster.py
"""
import argparse
import json
import os
import time
import urllib.parse
import urllib.request

UA = ("sherlock-scholes-bot/1.0 "
      "(https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
WDQS = "https://query.wikidata.org/sparql"
WD_API = "https://www.wikidata.org/w/api.php"
HUMAN, FOOTBALLER = "Q5", "Q937857"
# Девять локалей интерфейса: только для них имеет смысл заполнять `langs`.
UI_LANGS = ["ru", "en", "es", "pt", "fr", "ar", "ja", "ko", "zh"]
CHUNK = 500          # обратный поиск по P2446 — пачкой, а не по одному
ENT_CHUNK = 40       # wbgetentities с ярлырами девяти языков — тело большое
RATE_PAUSE = 65.0    # WDQS при лимитировании прямо пишет «1 req / min»
PAUSE = 2.0
RETRIES = 4
PAGE = 1000
RPC_BATCH = 200


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
    """{id на TM: QID} обратным запросом по P2446. Потери СЧИТАЮТСЯ отдельно.

    ⚠️ Здесь WDQS уместен, а wbgetentities нет: нужен ОБРАТНЫЙ поиск «у кого
    P2446 равен вот этим», а тот умеет только «дай свойства этой сущности».
    """
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
            except Exception:                                    # noqa: BLE001
                if attempt + 1 < RETRIES:
                    time.sleep(RATE_PAUSE)
        if got is None:
            lost += len(part)
            print("  ⚠️ пачка %d потеряна" % (i // CHUNK), flush=True)
            continue
        for b in got["results"]["bindings"]:
            out[b["tm"]["value"]] = b["p"]["value"].rsplit("/", 1)[-1]
        print("  P2446: %d/%d, найдено %d"
              % (min(i + CHUNK, len(tm_ids)), len(tm_ids), len(out)), flush=True)
        time.sleep(PAUSE)
    return out, lost


def wd(params):
    url = WD_API + "?" + urllib.parse.urlencode(dict(params, format="json"))
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as fh:
                return json.loads(fh.read())
        except Exception:                                        # noqa: BLE001
            if attempt + 1 < RETRIES:
                time.sleep(12 * (attempt + 1))
    return None


def claim_has(claims, prop, want):
    """Есть ли у сущности утверждение prop = want. ЧИСТАЯ ФУНКЦИЯ."""
    for c in claims.get(prop, []) or []:
        v = (c.get("mainsnak", {}) or {}).get("datavalue", {}) or {}
        val = v.get("value")
        if isinstance(val, dict) and val.get("id") == want:
            return True
    return False


def natural_name(label):
    """«Де Влигер, Тибе» → «Тибе Де Влигер». ЧИСТАЯ ФУНКЦИЯ.

    ⚠️ Часть ярлыков Викиданных записана в справочной форме «Фамилия, Имя», и
    на карточке это читается неестественно: в колоде «Зинедин Зидан», а не
    «Зидан, Зинедин». Разворот только по ОДНОЙ запятой — «Смит, Джон, мл.»
    трогать нельзя, там запятая значит другое.
    """
    if not label or label.count(",") != 1:
        return label
    tail, head = [p.strip() for p in label.split(",")]
    if not tail or not head:
        return label
    return head + " " + tail


def is_footballer(claims):
    """ЧЕЛОВЕК И ФУТБОЛИСТ — оба условия, а не одно. ЧИСТАЯ ФУНКЦИЯ.

    ⚠️ P31 = Q5 мало. На странице клуба у Transfermarkt есть тренеры и
    функционеры — они люди, но карточками игроков быть не должны. И наоборот,
    одного P106 мало бы не было, но пара дешевле рассуждений о том, какой
    гард сильнее.

    Проверено на тех, кто эту колоду уже травил: Q188760 (Халк, персонаж
    Marvel — стоял у карточки «Халк» со славой 90) и Q16479897 («Bellingham
    (surname)», страница ФАМИЛИИ) отвергаются оба, как и Q9616 («Челси»,
    вовсе не человек).
    """
    return claim_has(claims, "P31", HUMAN) and claim_has(claims, "P106", FOOTBALLER)


def names_for_qids(qids):
    """{QID: {'labels': {lang: имя}}} для тех, кто ЧЕЛОВЕК и ФУТБОЛИСТ.

    Пустой ответ источника — ПОТЕРЯ, а не «не футболист»: отрицательный вывод
    из молчания уже стоил этому проекту 120 карточек с чужими просмотрами.
    """
    out, lost = {}, 0
    for i in range(0, len(qids), ENT_CHUNK):
        part = qids[i:i + ENT_CHUNK]
        e = wd({"action": "wbgetentities", "ids": "|".join(part),
                "props": "claims|labels", "languages": "|".join(UI_LANGS)})
        if e is None:
            lost += len(part)
            continue
        for qid, ent in (e.get("entities") or {}).items():
            claims = ent.get("claims", {})
            if not is_footballer(claims):
                continue
            labels = {lg: (ent.get("labels", {}).get(lg, {}) or {}).get("value")
                      for lg in UI_LANGS}
            rec = {lg: natural_name(v) for lg, v in labels.items() if v}
            # ⚠️ Гражданство берётся ИДЕНТИФИКАТОРОМ (P27 → QID страны), а не
            # названием из ростера: «Spain» пришлось бы отображать в «ES»
            # словарём, который сам стал бы источником ошибок. Без страны
            # карточка выпадает из фильтров по странам и континентам.
            cit = [c["mainsnak"]["datavalue"]["value"]["id"]
                   for c in claims.get("P27", [])
                   if c.get("mainsnak", {}).get("datavalue")
                   and isinstance(c["mainsnak"]["datavalue"]["value"], dict)
                   and c.get("rank") != "deprecated"]
            # Двойное гражданство — не повод выбирать наугад: берём, только
            # если оно одно.
            rec["__country_qid"] = cit[0] if len(cit) == 1 else None
            out[qid] = rec
        print("  ярлыки: %d/%d, футболистов %d"
              % (min(i + ENT_CHUNK, len(qids)), len(qids), len(out)), flush=True)
        time.sleep(PAUSE)
    return out, lost


def iso2_for_countries(country_qids):
    """{QID страны: ISO alpha-2} по P297. Пустой ответ — потеря, не «нет кода»."""
    out = {}
    qids = sorted({q for q in country_qids if q})
    for i in range(0, len(qids), ENT_CHUNK):
        part = qids[i:i + ENT_CHUNK]
        e = wd({"action": "wbgetentities", "ids": "|".join(part),
                "props": "claims"})
        if e is None:
            continue
        for qid, ent in (e.get("entities") or {}).items():
            for c in ent.get("claims", {}).get("P297", []):
                v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
                if isinstance(v, str) and len(v) == 2:
                    out[qid] = v.upper()
                    break
        time.sleep(PAUSE)
    return out


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"

    rows = read_all("club_roster", {"select": "tm_player_id,name,nationality",
                                    "card_id": "is.null",
                                    "order": "tm_player_id"})
    seen, uniq = set(), []
    for r in rows:
        if r["tm_player_id"] not in seen:
            seen.add(r["tm_player_id"])
            uniq.append(r)
    if args.limit:
        uniq = uniq[:args.limit]
    print("Игроков состава без карточки: %d  (APPLY=%s)"
          % (len(uniq), "да" if apply_ else "нет — сухой прогон"), flush=True)
    if not uniq:
        return

    by_tm = {r["tm_player_id"]: r for r in uniq}
    qid_of, lost1 = qids_for_tm(sorted(by_tm))
    print("-" * 70)
    print("QID найден у %d из %d" % (len(qid_of), len(by_tm)))
    names, lost2 = names_for_qids(sorted(set(qid_of.values())))
    print("Из них человек И футболист: %d" % len(names))

    iso = iso2_for_countries([v.get("__country_qid") for v in names.values()])
    print("Стран с кодом ISO: %d" % len(iso))

    payload = []
    for tm_id, qid in qid_of.items():
        lab = names.get(qid)
        if not lab:
            continue                    # не футболист либо ответ потерян
        # ⚠️ `langs` НЕ СТАВИТСЯ. Отсечь игрока без русского ярлыка от русской
        # игры значило бы оставить русского пользователя с той же заученной
        # колодой — ровно с тем, на что владелец и жалуется. Имя тогда просто
        # латиницей: оно читается и объясняется.
        payload.append({
            "tm_player_id": tm_id,
            "qid": qid,
            "name_ru": lab.get("ru"),
            "name_en": lab.get("en") or by_tm[tm_id]["name"],
            "country": iso.get(lab.get("__country_qid")),
            "langs": None,
        })

    print("-" * 70)
    print("Готово к заведению: %d" % len(payload))
    if lost1 or lost2:
        print("⚠️ ПОТЕРЯНО ОТВЕТОВ: %d — их пустота НИЧЕГО не значит, "
              "повторить прогон" % (lost1 + lost2))
    if not apply_:
        for p in payload[:10]:
            print("   %-10s %-28s %-28s страна=%s"
                  % (p["tm_player_id"], (p["name_ru"] or "—")[:28],
                     (p["name_en"] or "")[:28], p.get("country") or "—"))
        print("\nСухой прогон. APPLY=1 — завести (АКТИВНЫМИ).")
        return

    done = 0
    for i in range(0, len(payload), RPC_BATCH):
        res = sb("rpc/create_cards_from_roster", method="POST",
                 body={"p_rows": payload[i:i + RPC_BATCH]})
        r0 = (res[0] if isinstance(res, list) else res) or {}
        done += r0.get("created") or 0
        print("  заведено %s, связано %s, пропущено %s, из %s"
              % (r0.get("created"), r0.get("linked"),
                 r0.get("skipped"), r0.get("seen")), flush=True)
    print("-" * 70)
    print("ЗАВЕДЕНО КАРТОЧЕК: %d — активными, см. шапку." % done)


if __name__ == "__main__":
    main()
