"""Составы клубов из Викиданных — единственный источник, который их отдаёт.

ЗАЧЕМ ЭТО ВООБЩЕ. Составов у нас почти нет, и это замерено: 1255 игроков на
1521 клуб, в среднем 4.2 на клуб, одиннадцать набирается у 43. «Показать
состав» поэтому почти негде, а владелец просит сорок человек в заявке.

Вывести их из того, что уже лежит, больше нечем. `card_current_club` строится
по открытому диапазону лет в википедии, матчевая статистика даёт только тех,
кто сыграл, а страница клуба на sports.ru отдаёт состав ТОЛЬКО у российских
клубов (у «Челси» блок `b-tag-team-__content` буквально пуст) — это записано в
docs/MAP.md §7а.

Викиданные отдают. `P54` (member of sports team) со сроком: заявление без даты
окончания и с датой начала — это «играет сейчас». Замер на «Реале» (Q8682):
17 действующих игроков против 4.2 в среднем по базе.

⚠️ ФИЛЬТР ПО ДАТЕ НАЧАЛА — НЕ ПРИДИРКА, А УСЛОВИЕ. Без него «нет даты
окончания» ловит всех, у кого её просто не проставили: тот же запрос по «Реалу»
без фильтра вернул 60 человек, среди которых José Antonio Ríos Reina и другие
из юношеских составов прошлых лет. То есть отсутствие даты означает и «играет»,
и «никто не дописал», и различить их можно только по дате начала.

⚠️ ЧЕГО ЗДЕСЬ НЕТ. Викиданные — краудсорс, и они отстают от трансферов на дни
и недели. Это НЕ живая заявка, и экран обязан говорить «на дату», а не
«сейчас», — то же правило, по которому мы отказались брать из вики счета.

⚠️ КАРТОЧКИ НЕ ЗАВОДЯТСЯ БЕЗ --create-cards. Найденный игрок без карточки —
обычное дело, и молча создавать тысячи голых карточек значит развалить колоду:
`cards_matching` начнёт раздавать людей без фотографии, без описания и без
страны. Флаг существует, чтобы это было решением человека, а не побочным
эффектом сбора.

⚠️ ЧТО ПРОВЕРЕНО, А ЧТО НЕТ — ЧИТАТЬ ДО ЗАПУСКА.

ПРОВЕРЕНО: сам источник. Запрос P54 по «Реалу» (Q8682) отдал 17 действующих
игроков — Беллингем, Мбаппе, Гюлер, Эндрик, Хёйсен, Александер-Арнольд,
Мастантуоно. Механизм работает и данные настоящие.

ПРОВЕРЕНО: резолв по ярлыку НЕ ГОДИТСЯ. Замер в docstring
resolve_club_qids_by_label — «FC Barcelona» уезжал в Q5424838, «Зенит» в
Q29108. Поэтому боевой путь идёт через статью и конвейерный run.resolve_card_qid.

НЕ ПРОВЕРЕНО: прогон целиком. 30.08.2026 Wikimedia начала отвечать 429 на весь
этот адрес — сначала WDQS («Aggressively rate-limiting to 1 req / min - this
rule was created during active wdqs outage»), затем и ru.wikipedia.org. При
1 запросе в минуту полторы тысячи клубов — это больше суток, так что ни
сквозного прогона, ни проверки резолва через статью сделано не было.

Значит: ПЕРВЫЙ ЗАПУСК — ТОЛЬКО СУХОЙ, и глазами посмотреть, в какие клубы
попали игроки. Не «сколько процентов сопоставилось», а именно глазами: чужой
состав приезжает молча и на экране выглядит нормально.

Запуск:
    python docs/clubs_squads_wikidata.py --limit 20            # сухой прогон
    python docs/clubs_squads_wikidata.py --limit 20 --apply
    python docs/clubs_squads_wikidata.py --apply --create-cards
"""
import argparse
import importlib.util
import json
import os
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

SCRAPER = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "football_scraper")
sys.path.insert(0, SCRAPER)

# run.py грузится модулем — тот же приём, что во всех docs/cards_*.py, — чтобы
# резолв «карточка → статья» был КОНВЕЙЕРНЫМ, а не второй реализацией.
_spec = importlib.util.spec_from_file_location("run", os.path.join(SCRAPER, "run.py"))
run = importlib.util.module_from_spec(_spec)
sys.modules["run"] = run
_spec.loader.exec_module(run)

from scraper.cache import FileCache                                  # noqa: E402
from scraper.pageviews import WikimediaBudget, WikiPagePropsClient   # noqa: E402
from scraper.wikidata import WikidataEnricher                        # noqa: E402

SPARQL = "https://query.wikidata.org/sparql"
UA = "SherlockScholesBot/1.0 (https://github.com/Aloews/sherlock-scholes-)"

# Футбольный клуб и всё, что под ним: Q476028 (association football club).
CLUB_CLASS = "wd:Q476028"
# Профессия «футболист» — гард от однофамильцев-нефутболистов.
FOOTBALLER = "wd:Q937857"

# Сколько клубов уходит в один запрос. Больше — быстрее, но запрос к WDQS
# ограничен минутой, и на пятидесяти клубах он в неё уже не всегда влезает.
CLUB_BATCH = 12
# Пауза между запросами. WDQS просит не молотить его без передышки, и 429
# оттуда приходит на весь адрес, а не на один запрос.
SLEEP = 1.0


def sparql(query, retries=3):
    """Ответ WDQS в виде списка словарей. 429 — ждать и повторить."""
    url = SPARQL + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "application/sparql-results+json"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=90) as fh:
                data = json.load(fh)
            return data["results"]["bindings"]
        except Exception as exc:                      # noqa: BLE001
            code = getattr(exc, "code", None)
            if attempt == retries - 1:
                print("  WDQS не ответил: %s" % exc, file=sys.stderr)
                return []
            # 429 и 5xx — подождать подольше; остальное повторить разок.
            time.sleep(SLEEP * (4 if code in (429, 500, 502, 503) else 1)
                       * (attempt + 1))
    return []


def canon(name):
    """Ключ для сравнения имён: диакритика свёрнута ВЫВОДОМ (NFKD), не
    таблицей, слова отсортированы.

    ⚠️ И то и другое — исправленные ошибки, а не вкус. Рукописная таблица на
    31 символ молча ела буквы, которых в ней нет («Modrić» → `modri`), а без
    сортировки «Фамилия, Имя» из вики не сходилось с «Имя Фамилия» карточки.
    Тот же приём, что в football_scraper/scraper/dedup.py.
    """
    if not name:
        return ""
    folded = unicodedata.normalize("NFKD", name.lower())
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    parts = sorted(p for p in "".join(
        c if c.isalnum() else " " for c in folded).split() if p)
    return "".join(parts)


def resolve_club_qids_by_label(names):
    """{имя → QID} по точному ярлыку. ⚠️ НЕНАДЁЖНО — оставлено как замер.

    Первая версия сборщика резолвила клубы так, и это НЕ РАБОТАЕТ, хотя
    выглядит работающим. Замер 30.08.2026:

        «FC Barcelona» → Q5424838   (сама «Барселона» — Q7156)
        «Зенит»        → Q29108     (питерский «Зенит» — Q131371)
        «Arsenal F.C.» → Q9617      верно
        «Liverpool F.C.» → Q1130849 верно

    Сортировка по числу языковых версий (`wikibase:sitelinks`) улучшила
    картину, но не вылечила: у клуба в Викиданных нередко ДВЕ сущности —
    многоспортивный клуб и футбольная команда внутри него, — и у обеих ярлык
    один. Состав при этом приедет, просто не тот и не весь, а на экране это
    будет выглядеть совершенно нормально.

    Поэтому боевой путь — resolve_club_qids_by_article() ниже.
    """
    out = {}
    for i in range(0, len(names), CLUB_BATCH):
        chunk = [n for n in names[i:i + CLUB_BATCH] if n]
        if not chunk:
            continue
        values = " ".join('"%s"@ru "%s"@en' % (n.replace('"', ''), n.replace('"', ''))
                          for n in chunk)
        rows = sparql("""
SELECT ?club ?label ?links WHERE {
  VALUES ?label { %s }
  ?club rdfs:label ?label .
  ?club wdt:P31/wdt:P279* %s .
  ?club wikibase:sitelinks ?links .
}
ORDER BY DESC(?links)""" % (values, CLUB_CLASS))
        for r in rows:
            out.setdefault(r["label"]["value"], r["club"]["value"].rsplit("/", 1)[-1])
        time.sleep(SLEEP)
    return out


def resolve_club_qids_by_article(cards_by_key, resolver, wikidata_validate=None):
    """{club_key → QID} через СТАТЬЮ, а не через ярлык.

    Статья ру-вики соответствует ровно одной сущности Викиданных
    (`pageprops.wikibase_item`), поэтому «Барселона (футбольный клуб)» не
    может разойтись надвое так, как расходится голый ярлык «FC Barcelona».

    Резолв статьи делает НЕ ЭТОТ ФАЙЛ, а run.resolve_card_qid — тот самый,
    которым в проекте уже достаются фотографии и описания. Он перебирает
    варианты названия, пропускает страницы неоднозначности и держит P31-гард
    «это футбольный клуб». Заводить рядом второй такой же резолвер значило бы
    завести место, где они разойдутся, — а он и так однажды разошёлся
    (docs/MAP.md §7а про «Зенит» и «Факел»).
    """
    out = {}
    for club_key, card in cards_by_key.items():
        titles = run.cards_photos_candidates(card)
        if not titles:
            continue
        qid, _title, _via = run.resolve_card_qid(
            resolver, card, titles, wikidata_validate)
        if qid:
            out[club_key] = qid
    return out


def fetch_squads(qids, since_year):
    """{QID → [{qid,name_ru,name_en,start,number,position}]}."""
    out = {}
    for i in range(0, len(qids), CLUB_BATCH):
        chunk = qids[i:i + CLUB_BATCH]
        values = " ".join("wd:" + q for q in chunk)
        rows = sparql("""
SELECT ?club ?p ?ru ?en ?start ?num ?pos WHERE {
  VALUES ?club { %s }
  ?p p:P54 ?st .
  ?st ps:P54 ?club .
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?st pq:P1618 ?num }
  ?p wdt:P106 %s .
  OPTIONAL { ?p wdt:P413 ?position . ?position rdfs:label ?pos FILTER(lang(?pos)="ru") }
  OPTIONAL { ?p rdfs:label ?ru FILTER(lang(?ru)="ru") }
  OPTIONAL { ?p rdfs:label ?en FILTER(lang(?en)="en") }
  FILTER(BOUND(?start) && ?start >= "%d-01-01T00:00:00Z"^^xsd:dateTime)
}""" % (values, FOOTBALLER, since_year))
        for r in rows:
            club = r["club"]["value"].rsplit("/", 1)[-1]
            out.setdefault(club, []).append({
                "qid":      r["p"]["value"].rsplit("/", 1)[-1],
                "name_ru":  r.get("ru", {}).get("value"),
                "name_en":  r.get("en", {}).get("value"),
                "start":    r.get("start", {}).get("value", "")[:10] or None,
                "number":   r.get("num", {}).get("value"),
                "position": r.get("pos", {}).get("value"),
            })
        time.sleep(SLEEP)
    return out


# --------------------------------------------------------------------------
# Supabase (PostgREST). Тот же способ, что у остальных скриптов рядом.
# --------------------------------------------------------------------------
def rest(url, key, path, method="GET", params=None, body=None, prefer=None):
    full = url.rstrip("/") + "/rest/v1/" + path
    if params:
        full += "?" + urllib.parse.urlencode(params)
    headers = {
        "apikey": key, "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(full, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as fh:
        raw = fh.read()
    return json.loads(raw) if raw else []


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="сколько клубов (0 — все)")
    ap.add_argument("--since", type=int, default=2022,
                    help="нижняя граница даты начала (год)")
    ap.add_argument("--apply", action="store_true", help="писать, а не показывать")
    ap.add_argument("--create-cards", action="store_true",
                    help="заводить карточки найденным игрокам без карточки")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE") or os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY не заданы")

    # Клубы, у которых есть что показывать, — сверху. Клуб без матчей и без
    # состава подождёт: бюджет запросов не бесконечный.
    clubs = rest(url, key, "football_club", params={
        "select": "club_key,name,name_en",
        "kind": "eq.club",
        "order": "name",
    })
    if args.limit:
        clubs = clubs[:args.limit]
    print("Клубов в обработке : %d" % len(clubs))

    names = []
    by_name = {}
    for c in clubs:
        for n in (c.get("name_en"), c.get("name")):
            if n and n not in by_name:
                by_name[n] = c
                names.append(n)

    # Клубы резолвятся ЧЕРЕЗ СТАТЬЮ (см. resolve_club_qids_by_article): ярлык
    # для этого не годится, замер в docstring той функции. Собирается всё тем
    # же способом, что в docs/cards_descriptions_build.py, — один кэш, один
    # дневной бюджет Wikimedia на все скрипты.
    cfg = json.load(open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))
    pv = cfg["pageviews"]
    cache = FileCache(os.path.join(SCRAPER, cfg["cache"]["dir"]),
                      cfg["cache"]["enabled"])
    budget = WikimediaBudget(
        cfg.get("photos", {}).get("daily_request_budget", 5000),
        os.path.join(SCRAPER, cfg["cache"]["dir"], "photos_budget.json"))
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget)

    def is_club(qid):
        return bool(set(wikidata.instance_of_qids(qid)) & run.CLUB_P31_ALLOW)

    cards_by_key = {
        c["club_key"]: {"name": c.get("name"), "name_en": c.get("name_en"),
                        "category": "club"}
        for c in clubs
    }
    club_qid = resolve_club_qids_by_article(cards_by_key, resolver, is_club)
    print("Клубов найдено в Викиданных : %d из %d" % (len(club_qid), len(clubs)))

    qid_to_key = {q: k for k, q in club_qid.items()}
    squads = fetch_squads(sorted(qid_to_key), args.since)
    total = sum(len(v) for v in squads.values())
    print("Игроков в составах         : %d" % total)

    # Карточки игроков — для сопоставления по имени.
    cards = rest(url, key, "cards", params={
        "select": "id,name,name_en",
        "category": "eq.player",
        "active": "is.true",
        "limit": "5000",
    })
    by_key = {}
    for c in cards:
        for n in (c.get("name"), c.get("name_en")):
            k = canon(n)
            if k:
                by_key.setdefault(k, c["id"])
    print("Карточек игроков           : %d" % len(cards))

    rows, missing = [], []
    for qid, members in squads.items():
        club_key = qid_to_key[qid]
        for m in members:
            card_id = by_key.get(canon(m["name_ru"])) or by_key.get(canon(m["name_en"]))
            if not card_id:
                missing.append((club_key, m))
                continue
            rows.append({
                "club_key": club_key,
                "card_id": card_id,
                "shirt_number": int(m["number"]) if (m["number"] or "").isdigit() else None,
                "position": m["position"],
                "joined_at": m["start"],
                "left_at": None,
                "source": "wikidata",
            })

    print("-" * 70)
    print("Сопоставлено с карточкой   : %d" % len(rows))
    print("Без карточки               : %d" % len(missing))
    if not args.apply:
        for r in rows[:25]:
            print("  %-28s %s" % (r["club_key"], r["card_id"]))
        print("\nСУХОЙ ПРОГОН — ничего не записано. Повторить с --apply.")
        return

    # ⚠️ Игрок может числиться в ОДНОМ текущем составе: на club_squad стоит
    # частичный уникальный индекс по card_id where left_at is null. Поэтому
    # прошлые «текущие» строки этого игрока закрываются ДО вставки, иначе
    # вставка упрётся в индекс и упадёт вся пачка.
    ids = sorted({r["card_id"] for r in rows})
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        rest(url, key, "club_squad", method="PATCH",
             params={"card_id": "in.(%s)" % ",".join(chunk), "left_at": "is.null"},
             body={"left_at": time.strftime("%Y-%m-%d")})

    written = 0
    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        # on_conflict назван ЯВНО: без него resolution=merge-duplicates целится
        # в первичный ключ по-своему и настоящий конфликт приходит 409 на всю
        # пачку — эта грабля в docs/MAP.md §9 уже описана.
        rest(url, key, "club_squad", method="POST",
             params={"on_conflict": "club_key,card_id"},
             body=chunk, prefer="resolution=merge-duplicates")
        written += len(chunk)
    print("Записано строк состава     : %d" % written)

    if missing and not args.create_cards:
        print("\n%d игроков без карточки НЕ заведены — нужен --create-cards."
              % len(missing))
        for club_key, m in missing[:15]:
            print("  %-28s %s" % (club_key, m["name_ru"] or m["name_en"]))
    elif missing:
        new = []
        seen = set()
        for _club_key, m in missing:
            name = m["name_ru"] or m["name_en"]
            k = canon(name)
            if not name or k in seen or k in by_key:
                continue
            seen.add(k)
            new.append({"name": name, "name_en": m["name_en"],
                        "category": "player", "category_ru": "игроки"})
        for i in range(0, len(new), 200):
            rest(url, key, "cards", method="POST", body=new[i:i + 200],
                 prefer="return=minimal")
        print("Заведено карточек          : %d" % len(new))
        print("⚠️ Они ГОЛЫЕ: без фото, страны и описания. Ночное обогащение "
              "(daily-enrich.yml) их подхватит, но до тех пор они будут "
              "выпадать в колоде — проверьте это до того, как раздавать.")


if __name__ == "__main__":
    main()
