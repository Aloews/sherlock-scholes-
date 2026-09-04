# -*- coding: utf-8 -*-
"""Рыночная стоимость игроков составов — с Transfermarkt, через P2446.

ИСТОЧНИК НАЗВАН ПРЯМО, И ЭТО НАМЕРЕННО. Данные берутся с transfermarkt.com.
Владелец решение принял осознанно и повторил его: «бери рейтинг и важную
информацию с трансфермаркет», «нужны они все». `robots.txt` сайта на 04.09.2026
разрешает обход всем, кроме `wget` (`User-agent: * / Allow: /`), но разрешение
робота — не лицензия: условия использования сайта переиспользование данных
ограничивают. Поэтому происхождение записано и здесь, и в шапке колонки в базе,
и в карте проекта. Прятать его не нужно и незачем.

ЗАЧЕМ. Уровень игрока сейчас считается из постраничных просмотров — это
известность, а не футбольная сила. Замер 04.09.2026: игроков в открытых
составах 1362, у всех до единого `market_value_eur` пуст.

⚠️ У ИГРОКОВ СОСТАВОВ НЕТ НИ ОДНОГО QID. Соседняя сессия завела колонки и
разрешила 799 `transfermarkt_id` — но у карточек, которых НЕТ ни в одном
составе (это 846 «голых» карточек, заведённых 03.09 и пока погашенных). У 1362
игроков составов QID нет вовсе, поэтому мост строится здесь и с нуля.

ТРИ ШАГА, И КАЖДЫЙ ПРОВЕРЯЕМ ОТДЕЛЬНО:

    1. карточка → QID     ruwiki + гарды P31/P106 (как в остальных сборщиках)
    2. QID → id на TM     P2446, пачками по 50 (28 запросов вместо 1362)
    3. id → стоимость     профиль игрока, оттуда сумма И ДАТА ОЦЕНКИ

⚠️ ДАТА БЕРЁТСЯ СО СТРАНИЦЫ, А НЕ `current_date`. На профиле стоит «Last
update: 02/06/2026»; подставить сегодняшнее число значило бы объявить оценку
трёхмесячной давности сегодняшней. Стоимость устаревает, и по колонке
`market_value_at` это должно быть видно.

⚠️ ОТСУТСТВИЕ СТОИМОСТИ — НЕ ОШИБКА. У игроков низших лиг её на TM просто нет,
там стоит «-». Пустое поле честнее нуля: ноль означал бы «оценён в ничто» и
утащил бы вниз любой средний.

СУХОЙ ПРОГОН ПО УМОЛЧАНИЮ.

    python docs/players_market_value_transfermarkt.py --limit 20
    python docs/players_market_value_transfermarkt.py --sql-out mv.sql
    APPLY=1 python docs/players_market_value_transfermarkt.py

Читает анонимным ключом (VITE_SUPABASE_*), пишет служебным (SUPABASE_KEY).
"""
import argparse
import importlib.util
import io
import json
import os
import re
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

TM_PROFILE = "https://www.transfermarkt.com/spieler/profil/spieler/%s"
# ⚠️ UA НАЗЫВАЕТ НАС, А НЕ ПРИТВОРЯЕТСЯ БРАУЗЕРОМ. Здесь стояла строка
# «Mozilla/5.0 … Chrome/124.0 Safari/537.36» — это маскировка происхождения
# запроса, а не вежливость, и она противоречит тому, ради чего источник
# вообще называется в шапке. Проверено 04.09.2026: тот же профиль отвечает
# **200** на UA с контактом, так что притворяться было и незачем.
# robots.txt сайта на ту же дату: `User-agent: * / Allow: /`.
# Тот же вывод уже записан в docs/MAP.md про ESPN: строка с контактом честнее
# той, что блокировали, а не хитрее.
TM_UA = ("SherlockScholesBot/1.0 "
         "(+https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
TM_PAUSE = 1.5
UNITS = {"bn": 1_000_000_000, "m": 1_000_000, "k": 1_000}

# Сумма на профиле размечена так:
#   <span class="waehrung">€</span>15.00<span class="waehrung">m</span>
VALUE_RE = re.compile(
    r'data-header__market-value-wrapper.*?'
    r'<span class="waehrung">\s*€\s*</span>\s*([\d.,]+)\s*'
    r'<span class="waehrung">\s*(bn|m|k)\s*</span>',
    re.S | re.I)
# «Last update: 02/06/2026» — день/месяц/год.
UPDATED_RE = re.compile(
    r'data-header__last-update[^>]*>[^<]*?(\d{2})/(\d{2})/(\d{4})', re.S | re.I)
# Запасной якорь — мета-описание: «➤ Market value: €15.00m ➤».
META_RE = re.compile(
    r'Market value:\s*€\s*([\d.,]+)\s*(bn|m|k)\b', re.I)


def parse_market_value(html):
    """(евро:int|None, дата:str|None) со страницы профиля.

    ⚠️ ЧИСЛО ТУТ В АНГЛИЙСКОМ ФОРМАТЕ: «15.00m» — это 15 миллионов, а не 15
    сотых. Точка — десятичный разделитель, запятая — разделитель тысяч
    («1,250.00k»), и снимать надо именно запятую.
    """
    if not html:
        return None, None
    m = VALUE_RE.search(html) or META_RE.search(html)
    if not m:
        return None, None
    try:
        amount = float(m.group(1).replace(",", ""))
    except ValueError:
        return None, None
    euros = int(round(amount * UNITS[m.group(2).lower()]))
    if euros <= 0:
        return None, None

    at = None
    d = UPDATED_RE.search(html)
    if d:
        day, month, year = d.group(1), d.group(2), d.group(3)
        at = "%s-%s-%s" % (year, month, day)
    return euros, at


def fetch_profile(tm_id, tries=3):
    url = TM_PROFILE % urllib.parse.quote(str(tm_id))
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": TM_UA,
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml",
            })
            with urllib.request.urlopen(req, timeout=40) as fh:
                return fh.read().decode("utf-8", "replace")
        except Exception:                                          # noqa: BLE001
            if attempt == tries:
                return None
            time.sleep(TM_PAUSE * 3 * attempt)
    return None


def env(name):
    if os.environ.get(name):
        return os.environ[name]
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        for line in io.open(path, encoding="utf-8"):
            if line.strip().startswith(name + "="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return None


def sb_get(url, key, path, params):
    full = url.rstrip("/") + "/rest/v1/" + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        full, headers={"apikey": key, "Authorization": "Bearer " + key})
    with urllib.request.urlopen(req, timeout=60) as fh:
        return json.load(fh)


MV_BATCH = 100        # обрыв теряет не больше сотни оценок


def sb_rpc(url, key, name, body):
    """Вызов серверной функции. Пачка — одна транзакция, повтор — no-op."""
    req = urllib.request.Request(
        url.rstrip("/") + "/rest/v1/rpc/" + name,
        data=json.dumps(body).encode(),
        headers={"apikey": key, "Authorization": "Bearer " + key,
                 "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as fh:
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


def squad_players(url, key):
    """Карточки игроков, стоящие сейчас хоть в одном составе.

    ⚠️ PostgREST РЕЖЕТ ОТВЕТ ПО db-max-rows (1000), поэтому и составы, и
    карточки читаются страницами с устойчивым `order`. Без него страницы
    перекрываются, и часть игроков не приходит вовсе.
    """
    ids, offset = set(), 0
    while True:
        page = sb_get(url, key, "club_squad", {
            "select": "card_id", "left_at": "is.null",
            "order": "card_id", "limit": 1000, "offset": offset})
        if not page:
            break
        ids.update(r["card_id"] for r in page if r.get("card_id"))
        if len(page) < 1000:
            break
        offset += 1000

    out, todo = [], sorted(ids)
    for i in range(0, len(todo), 60):
        chunk = todo[i:i + 60]
        out.extend(sb_get(url, key, "cards", {
            "select": "id,name,name_en,category,wikidata_qid,transfermarkt_id,market_value_eur",
            "id": "in.(%s)" % ",".join(chunk),
            "category": "eq.player", "active": "is.true", "limit": 1000}))
    return out


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="сколько игроков (0 — все)")
    ap.add_argument("--sql-out", default=None, help="куда выписать UPDATE")
    ap.add_argument("--refresh", action="store_true",
                    help="перезапросить и тех, у кого стоимость уже стоит")
    args = ap.parse_args()
    apply = os.environ.get("APPLY") == "1"

    url = env("VITE_SUPABASE_URL") or env("SUPABASE_URL")
    read_key = env("VITE_SUPABASE_ANON_KEY") or env("SUPABASE_KEY")
    write_key = env("SUPABASE_KEY")
    if not (url and read_key):
        raise SystemExit("нет VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY")
    if apply and not write_key:
        raise SystemExit("APPLY=1, но SUPABASE_KEY не задан — писать нечем")

    players = squad_players(url, read_key)
    if not args.refresh:
        players = [p for p in players if p.get("market_value_eur") is None]
    players.sort(key=lambda p: (p.get("name") or ""))
    if args.limit:
        players = players[:args.limit]
    print("Игроков составов без стоимости: %d  (APPLY=%s)"
          % (len(players), "да" if apply else "нет — сухой прогон"), flush=True)
    if not players:
        return

    cfg = json.load(io.open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))
    pv = cfg["pageviews"]
    cache = FileCache(os.path.join(SCRAPER, cfg["cache"]["dir"]), cfg["cache"]["enabled"])
    budget = WikimediaBudget(
        cfg.get("photos", {}).get("daily_request_budget", 5000),
        os.path.join(SCRAPER, cfg["cache"]["dir"], "photos_budget.json"))
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget)

    # --- шаг 1: карточка → QID ------------------------------------------
    qid_of, no_qid = {}, 0
    for i, card in enumerate(players, 1):
        have = card.get("wikidata_qid")
        if have:
            qid_of[card["id"]] = have
            continue
        titles = run.cards_photos_candidates(card)
        validate = run.make_card_qid_validator(card, wikidata, cache, budget)
        qid, _title, _via = run.resolve_card_qid(resolver, card, titles, validate)
        if qid:
            qid_of[card["id"]] = qid
        else:
            no_qid += 1
        if i % 50 == 0:
            print("  шаг 1: %d/%d, QID найден у %d" % (i, len(players), len(qid_of)),
                  flush=True)
    print("Шаг 1 — QID: найдено %d, не найдено %d" % (len(qid_of), no_qid), flush=True)

    # --- шаг 2: QID → transfermarkt id ----------------------------------
    tm_of_qid = wikidata.external_ids_for_qids(list(qid_of.values()), "P2446")
    print("Шаг 2 — P2446: id есть у %d из %d QID" % (len(tm_of_qid), len(qid_of)),
          flush=True)

    # --- шаг 3: id → стоимость ------------------------------------------
    found, no_value, no_id = [], 0, 0
    for i, card in enumerate(players, 1):
        qid = qid_of.get(card["id"])
        tm_id = tm_of_qid.get(qid) if qid else None
        if not tm_id:
            no_id += 1
            continue
        euros, at = parse_market_value(fetch_profile(tm_id))
        if euros:
            found.append({"id": card["id"], "name": card.get("name"),
                          "qid": qid, "tm_id": tm_id, "eur": euros, "at": at})
        else:
            no_value += 1
        time.sleep(TM_PAUSE)
        if len(found) and len(found) % 25 == 0 and i % 5 == 0:
            print("  шаг 3: %d/%d, со стоимостью %d" % (i, len(players), len(found)),
                  flush=True)

    print("-" * 78)
    print("Стоимость найдена : %d" % len(found))
    print("id есть, суммы нет: %d   (на TM стоит «-» — поле остаётся пустым)" % no_value)
    print("нет id на TM      : %d" % no_id)
    print("-" * 78)
    for f in sorted(found, key=lambda x: -x["eur"])[:25]:
        print("  %-26s %11s €  %s  %s"
              % ((f["name"] or "")[:26], "{:,}".format(f["eur"]), f["at"] or "—", f["tm_id"]))

    if args.sql_out and found:
        def q(v):
            return "'" + str(v).replace("'", "''") + "'"
        out = ["-- Рыночная стоимость игроков. Источник: transfermarkt.com,",
               "-- через P2446 в Викиданных. Сгенерировано",
               "-- docs/players_market_value_transfermarkt.py. Строк: %d." % len(found)]
        for f in found:
            out.append(
                "update cards set market_value_eur = %d, market_value_at = %s, "
                "wikidata_qid = coalesce(wikidata_qid, %s), "
                "transfermarkt_id = coalesce(transfermarkt_id, %s) where id = %s;"
                % (f["eur"], q(f["at"]) if f["at"] else "null",
                   q(f["qid"]), q(f["tm_id"]), q(f["id"])))
        io.open(args.sql_out, "w", encoding="utf-8").write("\n".join(out) + "\n")
        print("SQL выписан в %s" % args.sql_out)

    if apply and found:
        # ⚠️ ПАЧКОЙ, А НЕ ПО СТРОКЕ. Здесь стоял PATCH на каждого игрока: это
        # четыреста HTTP-запросов, каждый — своя транзакция, и обрыв посреди
        # оставляет половину состава оценённой, а половину нет. Владелец
        # просил прямо: пачка применяется одной транзакцией или идемпотентна
        # целиком. apply_card_market_values — один оператор на пачку, и он
        # отбрасывает оценку СТАРШЕ уже лежащей, иначе повтор со старым кешем
        # откатил бы цену назад и выглядел бы как «источник переоценил».
        rows = [{"card_id": f["id"], "value_eur": f["eur"], "valued_at": f["at"]}
                for f in found]
        written = 0
        for i in range(0, len(rows), MV_BATCH):
            res = sb_rpc(url, write_key, "apply_card_market_values",
                         {"p_rows": rows[i:i + MV_BATCH]})
            r0 = res[0] if isinstance(res, list) else res
            written += r0["written"]
            print("  стоимость: записано %d из %d" % (r0["written"], r0["seen"]),
                  flush=True)
        # QID и id на TM — отдельной пачкой той же формы: они не «стоимость»,
        # и переписывать уже стоящее значение им нельзя (coalesce внутри RPC).
        ids = [{"card_id": f["id"], "qid": f["qid"], "transfermarkt_id": f["tm_id"]}
               for f in found]
        for i in range(0, len(ids), MV_BATCH):
            sb_rpc(url, write_key, "apply_card_wikidata_ids",
                   {"p_rows": ids[i:i + MV_BATCH]})
        print("Записано: %d" % written)
    elif found:
        print("\nСУХОЙ ПРОГОН — ничего не записано. Повторить с APPLY=1.")


if __name__ == "__main__":
    main()
