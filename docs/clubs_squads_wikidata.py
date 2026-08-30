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

Запуск:
    python docs/clubs_squads_wikidata.py --limit 20            # сухой прогон
    python docs/clubs_squads_wikidata.py --limit 20 --apply
    python docs/clubs_squads_wikidata.py --apply --create-cards
"""
import argparse
import json
import os
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

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


def resolve_club_qids(names):
    """{имя → QID} по точному ярлыку, из одноимённых — самый известный.

    Точное совпадение, а не поиск: поиск по названию клуба выдаёт город, реку
    и одноимённую команду из другого вида спорта, и отличить их по
    релевантности нельзя. P31-гард отсекает всё, что не футбольный клуб.

    ⚠️ НО ОДНОГО ГАРДА МАЛО, И ЭТО ЗАМЕРЕНО. Футбольных клубов с ярлыком
    «Зенит» в Викиданных десятки — от питерского до любительских, — и первый
    попавшийся оказывался не тем: первая версия этой функции вернула
    Q115254557 вместо Q131371 для «Зенита» и Q5424838 вместо Q7156 для
    «FC Barcelona». Обе подстановки выглядели бы совершенно нормально: состав
    бы приехал, просто чужой.

    Различает их `wikibase:sitelinks` — на скольких языковых вики о клубе
    написана статья. У питерского «Зенита» их под сотню, у одноимённого
    любительского — одна. Это та же мысль, что и `fame` в колоде: известность
    как способ выбрать из тёзок, — и здесь она работает даже лучше, потому что
    речь о клубах, а не о людях.
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
        # ORDER BY уже поставил известнейшего первым, setdefault оставляет его.
        for r in rows:
            label = r["label"]["value"]
            qid = r["club"]["value"].rsplit("/", 1)[-1]
            out.setdefault(label, qid)
        time.sleep(SLEEP)
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

    qid_by_name = resolve_club_qids(names)
    club_qid = {}
    for n, q in qid_by_name.items():
        c = by_name.get(n)
        if c:
            club_qid.setdefault(c["club_key"], q)
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
