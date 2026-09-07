# -*- coding: utf-8 -*-
"""История трансферов игрока — с transfermarkt.com, по id.

ИСТОЧНИК НАЗВАН ПРЯМО: transfermarkt.com, служебный адрес
`ceapi/transferHistory/list/<id>`. Он отдаёт JSON — дату в ISO, клубы с их
идентификаторами, сумму и сезон, — то есть разбирать HTML не нужно вовсе.
Один запрос на игрока.

ЗАЧЕМ. Проверка по просьбе владельца («проверь статистику и историю
трансферов у Классена и игроков его ценовой категории и выше») показала, что
истории трансферов в проекте НЕ БЫЛО ВООБЩЕ: таблиц со словом transfer — ноль.
Замер по категории €600 тыс.+ (8986 игроков): дата рождения есть у 8923, а
карьера — всего у 1147, статистика матчей у 1007.

⚠️ СУММА — НЕ ВСЕГДА ЧИСЛО, И НОЛЬ ЗДЕСЬ ВРЁТ. Бывает «loan transfer», «End of
loan», «free transfer», «?». Ноль означал бы «перешёл бесплатно», а «?»
означает «неизвестно». Поэтому строка сохраняется целиком, а число остаётся
пустым.

⚠️ ПОРЯДОК ОБХОДА — ПО СТОИМОСТИ, ОТ ДОРОГИХ. Владелец просил именно эту
категорию и выше; при обрыве прогона сделанным окажется то, что важнее.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет):
    python docs/players_transfers_transfermarkt.py --min-value 600000 --limit 20
    APPLY=1 python docs/players_transfers_transfermarkt.py --min-value 600000
"""
import argparse
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from _sb import all_rows, sb  # общий транспорт: с повторами на обрыве

UA = ("SherlockScholesBot/1.0 "
      "(+https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
API = "https://www.transfermarkt.com/ceapi/transferHistory/list/%s"
PAUSE = 1.2
RETRIES = 3
PAGE = 1000

# «€100k», «€18.50m», «€1.20bn» → евро. ЧИСТАЯ ФУНКЦИЯ, её проверяет тест.
MONEY = re.compile(r'^€\s*([\d.,]+)\s*(k|m|bn)?$', re.I)
MULT = {"k": 1_000, "m": 1_000_000, "bn": 1_000_000_000}


def parse_fee(text):
    """Сумма в евро или None.

    ⚠️ NONE, А НЕ НОЛЬ, для «loan transfer», «free transfer», «?» и «End of
    loan». Ноль означал бы «перешёл бесплатно» — это другое утверждение, и по
    нему потом считали бы средние.
    """
    raw = (text or "").strip()
    m = MONEY.match(raw)
    if not m:
        return None
    number = m.group(1).replace(",", "")
    try:
        value = float(number)
    except ValueError:
        return None
    return int(round(value * MULT.get((m.group(2) or "").lower(), 1)))


# «/darmstadt-98/transfers/verein/105/saison_id/2026» → «105»
VEREIN = re.compile(r'/verein/(\d+)')


def club_tm_id(href):
    """id клуба из ссылки. ЧИСТАЯ ФУНКЦИЯ."""
    m = VEREIN.search(href or "")
    return m.group(1) if m else None


DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def parse_date(text):
    """Дата перехода или пустая строка. ЧИСТАЯ ФУНКЦИЯ, её проверяет тест.

    ⚠️ «0000-00-00» — НЕ ДАТА, А ЗАГЛУШКА ИСТОЧНИКА, и она уронила прогон.
    Transfermarkt ставит её, когда день перехода неизвестен; Postgres на ней
    отвечает «date/time field value out of range», запись пачки падает, и
    сборщик, шедший час, умирает на одном игроке. Пустая строка здесь значит
    «дата неизвестна» — это правда, а выдуманный год был бы ложью.

    Заодно отсекается любой другой мусор в этом поле: нулевой месяц, нулевой
    день, тринадцатый месяц. Проверяем ЗНАЧЕНИЯ, а не только форму записи.
    """
    m = DATE.match((text or "").strip())
    if not m:
        return ""
    year, month, day = (int(g) for g in m.groups())
    if not (1850 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31):
        return ""
    return m.group(0)


def parse_transfers(payload):
    """Записи истории из ответа API. ЧИСТАЯ ФУНКЦИЯ — её проверяет тест.

    Пустой список — законный ответ: у игрока может не быть ни одного перехода.
    Отличать «нет переходов» от «не дозвонились» — забота вызывающего.
    """
    out = []
    for t in (payload or {}).get("transfers") or []:
        tid = (t.get("url") or "")
        m = re.search(r'transfer_id/(\d+)', tid)
        if not m:
            continue
        src = t.get("from") or {}
        dst = t.get("to") or {}
        out.append({
            "transfer_id": m.group(1),
            "moved_on": parse_date(t.get("dateUnformatted")),
            "season": t.get("season") or "",
            "from_club": src.get("clubName") or "",
            "from_tm_id": club_tm_id(src.get("href")) or "",
            "to_club": dst.get("clubName") or "",
            "to_tm_id": club_tm_id(dst.get("href")) or "",
            "fee_eur": parse_fee(t.get("fee")) or "",
            "fee_text": (t.get("fee") or "").strip(),
            "market_value_eur": parse_fee(t.get("marketValue")) or "",
        })
    return out


def get_json(url):
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept": "application/json", "Accept-Language": "en"})
            with urllib.request.urlopen(req, timeout=60) as fh:
                return json.loads(fh.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {}
            if attempt + 1 == RETRIES:
                return None
        except Exception:                                        # noqa: BLE001
            if attempt + 1 == RETRIES:
                return None
        time.sleep(PAUSE * 3 * (attempt + 1))
    return None




def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--min-value", type=int, default=600000,
                    help="от какой стоимости брать (по умолчанию 600000)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--refresh", action="store_true",
                    help="перезапросить и тех, у кого история уже собрана")
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY")):
        raise SystemExit("нужны SUPABASE_URL и SUPABASE_KEY")

    # ⚠️ ЧИТАЕМ ЧЕРЕЗ all_rows: он валится, если страница не пришла. Молча
    # укоротить список игроков значит объявить обход законченным на обрезке.
    rows = all_rows("cards", {
        "select": "id,name_en,transfermarkt_id,market_value_eur",
        "category": "eq.player", "active": "is.true",
        "transfermarkt_id": "not.is.null",
        "market_value_eur": "gte.%d" % args.min_value,
        "order": "market_value_eur.desc"})

    if not args.refresh:
        done = {r["tm_player_id"] for r in all_rows(
            "player_transfer", {"select": "tm_player_id", "order": "tm_player_id"})}
        rows = [r for r in rows if r["transfermarkt_id"] not in done]

    if args.limit:
        rows = rows[:args.limit]
    print("Игроков к обходу: %d (от %d €)  (APPLY=%s)"
          % (len(rows), args.min_value, "да" if apply_ else "нет — сухой прогон"),
          flush=True)

    written = empty = lost = refused = 0
    for i, card in enumerate(rows, 1):
        payload = get_json(API % urllib.parse.quote(card["transfermarkt_id"]))
        if payload is None:
            lost += 1
        else:
            moves = parse_transfers(payload)
            if not moves:
                empty += 1
            elif apply_:
                res = sb("rpc/apply_player_transfers", method="POST",
                         body={"p_tm_id": card["transfermarkt_id"], "p_rows": moves})
                # ⚠️ ОТКАЗ ЗАПИСИ СЧИТАЕТСЯ ОТДЕЛЬНО. Молча прибавить ноль
                # значило бы выдать несохранённого игрока за игрока без
                # переходов — и повторный прогон его бы уже не тронул.
                if res is None:
                    refused += 1
                else:
                    written += (res[0].get("written", 0) if res else 0)
        if i % 25 == 0:
            print("  %d/%d, записей %d, пусто %d, потеряно %d, отказов %d"
                  % (i, len(rows), written, empty, lost, refused), flush=True)
        time.sleep(PAUSE)

    print("-" * 70)
    print("Записей истории : %d" % written)
    print("Без переходов   : %d" % empty)
    if lost:
        print("⚠️ ИГРОКОВ ПОТЕРЯНО: %d — их пустота НИЧЕГО не значит, повторить" % lost)
    if refused:
        print("⚠️ ЗАПИСЬ ОТКЛОНЕНА У %d — причина напечатана выше, повторить" % refused)
    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")


if __name__ == "__main__":
    main()
