# -*- coding: utf-8 -*-
"""Рыночная стоимость игрока с Transfermarkt — по идентификатору, не по имени.

ЦЕПОЧКА, ЗАМЕРЕННАЯ ЦЕЛИКОМ:

    QID → wdt:P2446 (id Transfermarkt) → профиль по id → текущая стоимость

Идентификатор кладёт в `cards.transfermarkt_id` скрипт
docs/cards_wikidata_ids.py. Здесь по нему открывается профиль и снимается
число. Проверено 04.09.2026: Павлович (574671) → €40.00m, Торриани (939745) →
€800k — совпало с замером владельца до цента.

⚠️ ИСКАТЬ ПО ИМЕНИ ЗДЕСЬ НЕЛЬЗЯ И НЕ НУЖНО. Поиск по имени на таком сайте
ошибается молча и приносит однофамильца — этот проект уже держал в одной
карточке «Матеуса Кунью» из МЮ и вратаря «Крузейро». Идентификатор приходит
из Викиданных, где его проставил человек.

⚠️ ИСТОЧНИК НАЗЫВАЕТСЯ. Данные принадлежат Transfermarkt, их ToS
переиспользование ограничивают, и владелец принял это решение сознательно.
Значит, происхождение не маскируется: оно записано в COMMENT колонки
`cards.market_value_eur`, стоит в интерфейсе рядом с числом и здесь.
robots.txt сайта на 04.09.2026: `User-agent: * / Allow: /` — путь открыт,
и ходим мы по нему своим UA с контактом, а не под чужим именем.

⚠️ ДАТА ОЦЕНКИ БЕРЁТСЯ ВМЕСТЕ С ЧИСЛОМ. Сайт печатает «Last update:
29/05/2026», и без этой даты стоимость читается как «сейчас». Это то же
правило, по которому составы из Викиданных подписаны «на дату»: источник
отстаёт, и молчать об этом нельзя.

⚠️ ПИШЕТСЯ ПО ХОДУ, А НЕ В КОНЦЕ. Профиль стоит полторы секунды, восемьсот
профилей — двадцать минут, и «собрать всё в массив, записать после цикла»
означает, что обрыв теряет ВСЁ, а не последнюю пачку. Так этот проект уже
записал ноль строк на 23 турнирах. Каждая пачка — одна транзакция и
идемпотентна, поэтому повтор после обрыва добирает недостающее, а свежие
оценки пропускает (см. --stale-days).

⚠️ ПРОЧЕРК У ИСТОЧНИКА — ЭТО NULL, А НЕ НОЛЬ. У молодых и у завершивших
карьеру оценки может не быть вовсе, и ноль читался бы как «ничего не стоит».

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет через RPC одной пачкой):
    python docs/cards_market_value_tm.py --limit 10
    APPLY=1 python docs/cards_market_value_tm.py --limit 400
"""
import argparse
import io
import json
import os
import re
import sys
import time
import urllib.request

PROFILE = "https://www.transfermarkt.com/x/profil/spieler/%s"
UA = ("SherlockScholesBot/1.0 "
      "(+https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
PAUSE = 1.5          # секунда с половиной между профилями
RETRIES = 3
PAGE = 1000          # PostgREST режет по db-max-rows — читать страницами
RPC_BATCH = 100          # пачка поменьше: обрыв теряет не больше сотни оценок

UNITS = {"k": 10 ** 3, "m": 10 ** 6, "bn": 10 ** 9, "th.": 10 ** 3}

# Блок в шапке профиля: <a class="data-header__market-value-wrapper">
#   <span class="waehrung">€</span>40.00<span class="waehrung">m</span>
_BLOCK = re.compile(
    r'data-header__market-value-wrapper"[^>]*>(.*?)</a>', re.S)
_NUM = re.compile(
    r'<span class="waehrung">(€|£|\$)</span>\s*([\d.,]+)\s*'
    r'<span class="waehrung">([a-z.]+)</span>', re.I)
_UPDATED = re.compile(r'Last update:\s*(\d{2})/(\d{2})/(\d{4})')
# Запасной путь: то же число в meta-описании страницы.
_META = re.compile(
    r'<meta name="description" content="[^"]*?Market value:\s*'
    r'(€|£|\$)([\d.,]+)([a-z.]+)', re.I)


def parse_value(html):
    """(евро:int|None, дата оценки:str|None, валюта:str|None) из профиля.

    Возвращает NULL-подобное, а не ноль: «оценки нет» и «стоит ноль» — разные
    ответы, и ноль в колоде читался бы как «ничего не стоит».
    """
    cur = num = unit = None
    block = _BLOCK.search(html or "")
    if block:
        m = _NUM.search(block.group(1))
        if m:
            cur, num, unit = m.group(1), m.group(2), m.group(3).lower()
    if num is None:
        m = _META.search(html or "")
        if m:
            cur, num, unit = m.group(1), m.group(2), m.group(3).lower()
    value = None
    if num is not None:
        mult = UNITS.get(unit)
        if mult:
            try:
                value = int(round(float(num.replace(",", "")) * mult))
            except ValueError:
                value = None
    if value is not None and value <= 0:
        value = None

    day = None
    d = _UPDATED.search(block.group(1) if block else (html or ""))
    if d:
        day = "%s-%s-%s" % (d.group(3), d.group(2), d.group(1))
    return value, day, cur


def get(url):
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as fh:
                return fh.read().decode("utf-8", "replace")
        except Exception as exc:                                # noqa: BLE001
            if attempt + 1 == RETRIES:
                return None
            time.sleep(PAUSE * 3 * (attempt + 1))
    return None


def sb(path, params):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path
    q = "&".join("%s=%s" % (k, v) for k, v in params.items())
    key = os.environ["SUPABASE_KEY"]
    req = urllib.request.Request(url + "?" + q, headers={
        "apikey": key, "Authorization": "Bearer " + key})
    with urllib.request.urlopen(req, timeout=60) as fh:
        return json.load(fh)


def cards_with_tm(limit, stale_days):
    """Карточки с id Transfermarkt, у которых цены нет или она устарела.

    Порядок — по славе вниз: бюджет вежливости тратится на тех, кого игрок
    в колоде реально увидит. `order` обязателен — без него смещение
    страницы отдаёт другую выборку.
    """
    out, offset = [], 0
    while True:
        page = sb("cards", {
            "select": "id,name,transfermarkt_id,market_value_at,fame",
            "transfermarkt_id": "not.is.null",
            "order": "fame.desc.nullslast,id",
            "limit": str(PAGE), "offset": str(offset)})
        out.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    fresh = time.strftime("%Y-%m-%d",
                          time.gmtime(time.time() - stale_days * 86400))
    out = [c for c in out
           if not c.get("market_value_at") or c["market_value_at"] < fresh]
    return out[:limit] if limit else out


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--stale-days", type=int, default=30,
                    help="сколько дней оценка считается свежей (Transfermarkt "
                         "переоценивает раз в несколько месяцев)")
    ap.add_argument("--sql-out", default=None)
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"

    cards = cards_with_tm(args.limit, args.stale_days)
    print("Карточек с id Transfermarkt к сбору: %d" % len(cards))
    if not cards:
        print("Все оценки свежие — собирать нечего.")
        return

    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_KEY", "")
    rows, no_value, lost, other_cur = [], 0, 0, set()
    written, pending = 0, []

    def flush():
        """Записать накопленное. Одна пачка — одна транзакция, повтор — no-op."""
        nonlocal written, pending
        if not (apply_ and pending):
            pending = []
            return
        body = json.dumps({"p_rows": pending}).encode()
        req = urllib.request.Request(
            url + "/rest/v1/rpc/apply_card_market_values", data=body,
            headers={"apikey": key, "Authorization": "Bearer " + key,
                     "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=180) as fh:
            res = json.load(fh)
        r0 = res[0] if isinstance(res, list) else res
        written += r0["written"]
        print("    записано %d из %d (всего %d)"
              % (r0["written"], r0["seen"], written), flush=True)
        pending = []

    for n, c in enumerate(cards, 1):
        html = get(PROFILE % c["transfermarkt_id"])
        if html is None:
            lost += 1
            time.sleep(PAUSE)
            continue
        value, day, cur = parse_value(html)
        if cur and cur != "€":
            # Цена в фунтах, записанная в колонку евро, — тихая ошибка в 15 %,
            # и выглядит она совершенно правдоподобно. Строка выбрасывается.
            other_cur.add(cur)
            value = None
        if value is None:
            no_value += 1
        else:
            row = {"card_id": c["id"], "value_eur": value, "valued_at": day}
            rows.append(row)
            pending.append(row)
            if len(pending) >= RPC_BATCH:
                flush()
        if n <= 8 or n % 50 == 0 or n == len(cards):
            print("  %-28s %-9s %s  %s"
                  % ((c.get("name") or "")[:27], c["transfermarkt_id"],
                     ("%12d" % value) if value else "  оценки нет", day or ""),
                  flush=True)
        time.sleep(PAUSE)
    flush()

    print("-" * 70)
    print("Оценок снято      : %d" % len(rows))
    print("У источника прочерк: %d" % no_value)
    if lost:
        print("⚠️ ОТВЕТОВ ПОТЕРЯНО: %d — их отсутствие здесь ничего не значит, "
              "повторить прогон." % lost)
    if other_cur:
        # Не «мелочь»: цена в фунтах, записанная как евро, — это тихая ошибка
        # в 15 %, и выглядит она совершенно правдоподобно.
        print("⚠️ ЧУЖАЯ ВАЛЮТА В ОТВЕТЕ: %s — эти строки НЕ записаны."
              % ", ".join(sorted(other_cur)))
    if rows:
        top = sorted(rows, key=lambda r: -r["value_eur"])[:5]
        print("Самые дорогие:")
        for r in top:
            nm = next(c["name"] for c in cards if c["id"] == r["card_id"])
            print("  %-28s %s €" % (nm[:27], "{:,}".format(r["value_eur"])))

    if args.sql_out:
        out = ["-- Стоимость игроков, ИСТОЧНИК TRANSFERMARKT.",
               "-- Сгенерировано docs/cards_market_value_tm.py. Строк: %d." % len(rows),
               "begin;"]
        for r in rows:
            out.append("update cards set market_value_eur = %d, "
                       "market_value_at = %s where id = '%s';"
                       % (r["value_eur"],
                          "'%s'" % r["valued_at"] if r["valued_at"] else "null",
                          r["card_id"]))
        out.append("commit;")
        io.open(args.sql_out, "w", encoding="utf-8").write("\n".join(out) + "\n")
        print("SQL выписан в %s" % args.sql_out)

    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")
        return
    print("ИТОГО записано: %d" % written)


if __name__ == "__main__":
    main()
