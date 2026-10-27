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
    2. QID → id на TM     P2446, пачками по 50
    3. id → стоимость     публичный JSON /players/{id}/market_value:
                           точная сумма и дата последнего изменения

HTML-профили больше не являются рабочим источником для GitHub Actions: они
могут вернуть маленькую interstitial-страницу с HTTP 200. Такой ответ не считается
отсутствующей стоимостью и не обновляет market_value_checked_at.

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
import gzip
from datetime import date
import urllib.error
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
TM_VALUE_URL = "https://www.transfermarkt.com/ceapi/marketValueDevelopment/graph/%s"
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


API_VALUE_RE = re.compile(r"^\s*€?\s*([\d.,]+)\s*(bn|m|k)?\s*$", re.I)


def normalize_source_date(value):
    if not value:
        return None
    raw = str(value).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}", raw):
        return raw[:10]
    match = re.match(r"^(\d{2})[./](\d{2})[./](\d{4})$", raw)
    if match:
        day, month, year = match.groups()
        return f"{year}-{month}-{day}"
    return None


def parse_ceapi_market_value(payload):
    """Parse Transfermarkt's native market-value chart response.

    The chart endpoint returns {"list": [{"datum_mw": "...", "mw": "..."}]}.
    An empty list is a valid profile without a published valuation; a malformed
    top-level response is not evidence that the player has no market value.
    """
    if not isinstance(payload, dict) or not isinstance(payload.get("list"), list):
        return None, None, False

    dated_values = []
    for row in payload["list"]:
        if not isinstance(row, dict):
            continue
        valued_at = normalize_source_date(
            row.get("datum_mw") or row.get("date") or row.get("updatedAt")
        )
        raw_value = row.get("mw", row.get("marketValue", row.get("value")))
        if isinstance(raw_value, dict):
            raw_value = raw_value.get("value") or raw_value.get("amount")
        euros = None
        if isinstance(raw_value, (int, float)) and not isinstance(raw_value, bool):
            euros = int(round(raw_value))
        elif isinstance(raw_value, str):
            match = API_VALUE_RE.match(raw_value)
            if match:
                euros = int(round(
                    float(match.group(1).replace(",", "")) *
                    UNITS.get((match.group(2) or "").lower(), 1)
                ))
        if valued_at and euros and euros > 0:
            dated_values.append((valued_at, euros))

    if not dated_values:
        return None, None, True
    valued_at, euros = max(dated_values, key=lambda item: item[0])
    return euros, valued_at, True


def fetch_api_market_value(tm_id, tries=3):
    """Fetch a player valuation from the same public JSON API used for season stats.

    Transfermarkt's HTML pages can return a small HTTP-200 interstitial from
    GitHub-hosted runners. That is not an empty valuation; it is an unusable
    response and must not advance market_value_checked_at.
    """
    url = TM_VALUE_URL % urllib.parse.quote(str(tm_id))
    diagnostics = os.environ.get("TMAPI_DIAGNOSTICS") == "1"
    # Diagnostic probes should fail quickly and make one request per priority
    # player. The public service maps upstream blocks to 503; retries only add
    # load and delay without repairing that condition.
    if diagnostics:
        tries = 1
    timeout = 15 if diagnostics else 60
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": TM_UA,
                "Accept": "application/json",
                "Accept-Encoding": "gzip",
            })
            with urllib.request.urlopen(req, timeout=timeout) as fh:
                raw = fh.read()
                if fh.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
            payload = json.loads(raw)
            data = unwrap_api_market_value_payload(payload, tm_id)
            if data is None:
                if os.environ.get("TMAPI_DIAGNOSTICS") == "1":
                    top_keys = sorted(payload.keys())[:16] if isinstance(payload, dict) else []
                    nested = payload.get("data") if isinstance(payload, dict) else None
                    nested_keys = sorted(nested.keys())[:16] if isinstance(nested, dict) else []
                    returned_id = (
                        (nested if isinstance(nested, dict) else payload).get("id")
                        if isinstance(nested, dict) or isinstance(payload, dict) else None
                    )
                    print(
                        "TMAPI market-value response rejected: "
                        f"requested_id={tm_id} top_keys={top_keys} "
                        f"data_keys={nested_keys} returned_id={returned_id!r}",
                        flush=True,
                    )
                return None, None, False
            value, at, valid_profile = parse_ceapi_market_value(payload)
            if not valid_profile and os.environ.get("TMAPI_DIAGNOSTICS") == "1":
                top_keys = sorted(payload.keys())[:16] if isinstance(payload, dict) else []
                print(f"Transfermarkt CEAPI response shape rejected: top_keys={top_keys}", flush=True)
            return value, at, valid_profile
        except urllib.error.HTTPError as error:
            if os.environ.get("TMAPI_DIAGNOSTICS") == "1":
                print(f"Transfermarkt CEAPI market-value HTTP {error.code} for id={tm_id}", flush=True)
            if error.code == 404:
                return None, None, False
            if not should_retry_market_value_status(error.code):
                return None, None, False
        except Exception as error:  # noqa: BLE001
            if os.environ.get("TMAPI_DIAGNOSTICS") == "1":
                print(
                    f"Transfermarkt CEAPI market-value request failed for id={tm_id}: "
                    f"{type(error).__name__}",
                    flush=True,
                )
        if attempt < tries:
            time.sleep(TM_PAUSE * 3 * attempt)
    return None, None, False


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


MV_BATCH = 25         # сохранять проверки и цены небольшими идемпотентными пачками


def invalid_profile_threshold(total):
    return max(5, int(total * 0.1))


def sb_rpc(url, key, name, body):
    """Вызов серверной функции. Пачка — одна транзакция, повтор — no-op."""
    req = urllib.request.Request(
        url.rstrip("/") + "/rest/v1/rpc/" + name,
        data=json.dumps(body).encode(),
        headers={"apikey": key, "Authorization": "Bearer " + key,
                 "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as fh:
        return json.load(fh)


def write_batch(url, key, rows):
    """Пачка карточек — ОДНА транзакция, и записывается она ПО ХОДУ цикла.

    ⚠️ Два требования, и оба обязательны. Писать надо по ходу: прогон по всем
    составам идёт часами, и «собрать в массив, записать в конце» уже стоило
    этому проекту всех 23 турниров разом (см. docs/MAP.md, football-fixtures),
    а обрыв сессии 04.09.2026 убил три прогона, не записавших ни строки. И
    писать надо пачкой: PATCH на каждого игрока — это четыреста транзакций,
    а владелец просил прямо — пачка применяется одной транзакцией или
    идемпотентна целиком.

    ⚠️ ДВЕ РАЗНЫЕ ФУНКЦИИ, А НЕ ОДНА. Стоимость ПЕРЕЗАПИСЫВАЕТСЯ (она
    меняется, и защита у неё — дата оценки), а QID и id на TM пишутся только
    в пустое: `coalesce` внутри apply_card_wikidata_ids. Прямой PATCH обоими
    сразу ещё и падал бы 409 на дублях колоды — уникальный индекс по
    wikidata_qid ловит два QID у одного человека, и это НЕ повод ронять
    прогон (см. conflicts в той же функции).

    Возвращает, сколько строк со стоимостью реально изменилось.
    """
    if not rows:
        return 0
    res = sb_rpc(url, key, "apply_card_market_values",
                 {"p_rows": [{"card_id": r["id"], "value_eur": r["eur"],
                              "valued_at": r["at"]} for r in rows]})
    r0 = res[0] if isinstance(res, list) else res
    try:
        seen = int(r0.get("seen", -1))
    except (AttributeError, TypeError, ValueError):
        seen = -1
    if seen != len(rows):
        raise RuntimeError(
            "Market-value write mismatch: expected %d production cards, "
            "RPC matched %d; refusing to mark the refresh successful"
            % (len(rows), seen)
        )
    ids = sb_rpc(url, key, "apply_card_wikidata_ids",
                 {"p_rows": [{"card_id": r["id"], "qid": r["qid"],
                              "transfermarkt_id": r["tm_id"]} for r in rows]})
    i0 = ids[0] if isinstance(ids, list) else ids
    if (i0.get("conflicts") or 0):
        # Находка, а не помеха: один QID у двух карточек — дубль в колоде.
        print("    ⚠️ один QID у двух карточек: %d — см. card_qid_conflicts()"
              % i0["conflicts"], flush=True)
    return r0["written"]


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
            "select": "id,name,name_en,category,wikidata_qid,transfermarkt_id,market_value_eur,market_value_at,market_value_checked_at",
            "id": "in.(%s)" % ",".join(chunk),
            "category": "in.(player,woman)", "active": "is.true", "limit": 1000}))
    return out


def read_all_cards(url, key):
    """Карточки игроков с id на Transfermarkt — постранично.

    ⚠️ СТРАНИЦАМИ: PostgREST режет ответ по `db-max-rows` = 1000, а карточек
    25 509. Без страниц хвост теряется молча.
    """
    out, offset = [], 0
    while True:
        page = sb_get(url, key, "cards", {
            "select": "id,name,name_en,category,wikidata_qid,transfermarkt_id,market_value_eur,market_value_at,market_value_checked_at",
            "category": "in.(player,woman)", "active": "is.true",
            "transfermarkt_id": "not.is.null",
            "order": "id", "limit": 1000, "offset": offset})
        out.extend(page)
        if len(page) < 1000:
            return out
        offset += 1000


def should_write_market_value(euros, valued_at):
    if not euros or not valued_at:
        return False
    try:
        return date.fromisoformat(str(valued_at)[:10]) <= date.today()
    except ValueError:
        return False


def market_value_refresh_key(card):
    """Least recently attempted first; source valuation date breaks ties."""
    checked_at = str(card.get("market_value_checked_at") or "")[:19]
    valued_at = str(card.get("market_value_at") or "")[:10]
    try:
        value = int(card.get("market_value_eur") or 0)
    except (TypeError, ValueError):
        value = 0
    return (
        checked_at or "0000-00-00T00:00:00",
        valued_at or "0000-00-00",
        -value,
        str(card.get("name") or "").casefold(),
    )


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="сколько игроков (0 — все)")
    ap.add_argument("--sql-out", default=None, help="куда выписать UPDATE")
    ap.add_argument("--refresh", action="store_true",
                    help="перезапросить и тех, у кого стоимость уже стоит")
    ap.add_argument("--from-cards", action="store_true",
                    help="брать карточки с готовым transfermarkt_id, минуя Викиданные")
    ap.add_argument("--only", default="", help="один Transfermarkt ID")
    args = ap.parse_args()
    if args.only and not args.only.isdigit():
        ap.error("--only must be a numeric Transfermarkt ID")
    apply = os.environ.get("APPLY") == "1"

    url = env("VITE_SUPABASE_URL") or env("SUPABASE_URL")
    read_key = env("VITE_SUPABASE_ANON_KEY") or env("SUPABASE_KEY")
    write_key = env("SUPABASE_KEY")
    if not (url and read_key):
        raise SystemExit("нет VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY")
    if apply and not write_key:
        raise SystemExit("APPLY=1, но SUPABASE_KEY не задан — писать нечем")

    if args.from_cards:
        # ⚠️ КОРОТКИЙ ПУТЬ, И ОН ЖЕ ЕДИНСТВЕННЫЙ РАБОЧИЙ ДЛЯ БОЛЬШИНСТВА.
        # Прежний ход «карточка → QID → P2446 → id» упирается в Викиданные, а
        # их у большинства футболистов мира нет: замер 06.09.2026 — на 3000
        # проверенных QID нашёлся у 50. Но id на Transfermarkt у карточки уже
        # СТОИТ: он приехал вместе с заявкой клуба. Замер: 3142 карточки без
        # стоимости, у которых id есть. Тогда шаги 1 и 2 не нужны вовсе.
        players = read_all_cards(url, read_key)
    else:
        players = squad_players(url, read_key)
    if args.only:
        players = [p for p in players if str(p.get("transfermarkt_id") or "") == args.only]
        if not players:
            raise SystemExit("No active player card found for Transfermarkt ID " + args.only)
    if not args.refresh:
        players = [p for p in players if p.get("market_value_eur") is None]
        players.sort(key=lambda p: (p.get("name") or "").casefold())
    else:
        # Refresh all values, not only NULLs. Sort by the last attempt so
        # missing prices or old source dates cannot monopolize the daily batch.
        players.sort(key=market_value_refresh_key)
    if args.limit:
        players = players[:args.limit]
    print("Игроков для обновления стоимости: %d  (refresh=%s, APPLY=%s)"
          % (len(players), args.refresh, "да" if apply else "нет — сухой прогон"), flush=True)
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
    direct_tm = {}
    if args.from_cards:
        # ⚠️ ШАГИ 1 И 2 ПРОПУСКАЮТСЯ ЦЕЛИКОМ: id уже на карточке.
        direct_tm = {c["id"]: c["transfermarkt_id"] for c in players
                     if c.get("transfermarkt_id")}
        print("Короткий путь: id на карточке у %d игроков, Викиданные не "
              "запрашиваются" % len(direct_tm), flush=True)
    qid_of, no_qid = {}, 0
    for i, card in enumerate(players, 1):
        if args.from_cards:
            break
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
    tm_of_qid = ({} if args.from_cards
                 else wikidata.external_ids_for_qids(list(qid_of.values()), "P2446"))
    print("Шаг 2 — P2446: id есть у %d из %d QID" % (len(tm_of_qid), len(qid_of)),
          flush=True)
    lost = sum(len(b) for b in getattr(wikidata, "extid_lost", []))
    if lost:
        # ⚠️ «Ни у кого нет id» и «источник не ответил» выглядят одинаково —
        # нулём. Замер 04.09.2026: при параллельной нагрузке шаг напечатал
        # «id есть у 0 из 7», хотя тот же QID через минуту отдал 574671.
        print("⚠️ ОТВЕТОВ ПОТЕРЯНО: %d QID — их пустота здесь НИЧЕГО не "
              "значит, повторить прогон" % lost, flush=True)

    # --- шаг 3: id → стоимость ------------------------------------------
    found, no_value, no_id, invalid_profiles = [], 0, 0, 0
    pending, written = [], 0
    for i, card in enumerate(players, 1):
        qid = qid_of.get(card["id"])
        tm_id = direct_tm.get(card["id"]) or (tm_of_qid.get(qid) if qid else None)
        if not tm_id:
            no_id += 1
            continue
        euros, at, valid_profile = fetch_api_market_value(tm_id)
        if not valid_profile:
            # Do not update checked_at on blocked, missing or malformed API
            # responses; the card must remain eligible for the next retry.
            invalid_profiles += 1
            print("  ⚠️ no usable TMAPI market-value response for %s (%s)"
                  % (card.get("name") or card["id"], tm_id), flush=True)
            if invalid_profiles >= invalid_profile_threshold(len(players)):
                flushed = 0
                if apply and pending:
                    flushed = len(pending)
                    written += write_batch(url, write_key, pending)
                    pending = []
                raise SystemExit(
                    "TMAPI returned unusable market-value responses for %d/%d profiles; "
                    "aborting early after flushing %d valid source rows"
                    % (invalid_profiles, len(players), flushed)
                )
            time.sleep(TM_PAUSE)
            continue
        has_source_value = should_write_market_value(euros, at)
        row = {
            "id": card["id"], "name": card.get("name"),
            "qid": qid, "tm_id": tm_id,
            "eur": euros if has_source_value else None,
            "at": at if has_source_value else None,
        }
        # A valid source response without a published value is different from
        # a failed/interstitial response. Only the former advances checked_at.
        pending.append(row)
        if has_source_value:
            found.append(row)
        else:
            no_value += 1
        if apply and len(pending) >= MV_BATCH:
            written += write_batch(url, write_key, pending)
            print("    checked %d (value changes so far %d)" % (len(pending), written),
                  flush=True)
            pending = []
        time.sleep(TM_PAUSE)
        if len(found) and len(found) % 25 == 0 and i % 5 == 0:
            print("  шаг 3: %d/%d, со стоимостью %d" % (i, len(players), len(found)),
                  flush=True)

    print("-" * 78)
    print("Стоимость найдена : %d" % len(found))
    print("id есть, суммы нет: %d   (на TM стоит «-» — поле остаётся пустым)" % no_value)
    print("нет id на TM      : %d" % no_id)
    print("ответ источника непригоден: %d" % invalid_profiles)
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

    if apply:
        written += write_batch(url, write_key, pending)
        pending = []
        # «Прогон прошёл» без числа ничего не значит.
        print("Изменено оценок: %d; получено оценок с датой источника: %d"
              % (written, len(found)))
    elif found:
        print("\nСУХОЙ ПРОГОН — ничего не записано. Повторить с APPLY=1.")

    if args.only and not found:
        raise SystemExit(
            "No source-dated market valuation returned for Transfermarkt ID " + args.only
        )


if __name__ == "__main__":
    main()
