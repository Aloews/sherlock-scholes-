"""Один игрок — один текущий клуб (offline, без сети и без базы).

Покрывает keep_latest_club из docs/clubs_squads_wikidata.py: разбор случая,
когда Викиданные держат ДВЕ открытые строки P54, потому что прошлую после
перехода не закрыли.

⚠️ Проверяется НАСТОЯЩАЯ функция, а не её копия. Копия в тесте проверяет
копию: в test_title_match.py я уже один раз переписал логику рядом, забыл в
переписи гард — и тест был зелёным на поломке.

    python3 tests/test_squad_latest_club.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.dirname(HERE)
ROOT = os.path.dirname(SCRAPER)
sys.path.insert(0, SCRAPER)

import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "clubs_squads_wikidata",
    os.path.join(ROOT, "docs", "clubs_squads_wikidata.py"))
csw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(csw)

FAILURES = []


def check(label, got, want):
    if got != want:
        FAILURES.append("{}\n    ожидалось: {!r}\n    получено : {!r}".format(
            label, want, got))


def member(qid, start):
    return {"qid": qid, "start": start, "name_ru": qid, "name_en": qid,
            "number": None, "position": None}


def keys(squads):
    return {club: sorted(m["qid"] for m in members)
            for club, members in squads.items()}


# --- 1. Замер, ради которого функция и появилась. -------------------------
# У Гарначо (Q106521372) «Челси» с 30.08.2025 и «Астон Вилла» с 23.07.2026,
# обе БЕЗ даты конца. Прогон 01.09.2026 поставил его в оба состава сразу.
squads, moved, ambiguous = csw.keep_latest_club({
    "Q19571": [member("garnacho", "2025-08-30"), member("mudryk", "2023-01-15")],
    "Q19392": [member("garnacho", "2026-07-23"), member("torres", "2023-07-01")],
})
check("переход: игрок остаётся в клубе с ПОЗДНЕЙ датой",
      keys(squads), {"Q19571": ["mudryk"], "Q19392": ["garnacho", "torres"]})
check("переход посчитан", moved, 1)
check("неразличимых нет", ambiguous, 0)

# --- 2. Ничья: выбрать наугад значит поставить чужого. ---------------------
squads, moved, ambiguous = csw.keep_latest_club({
    "Q1": [member("twin", "2026-07-01"), member("kept", "2024-01-01")],
    "Q2": [member("twin", "2026-07-01")],
})
check("ничья по дате — игрок выброшен ИЗ ОБОИХ клубов",
      keys(squads), {"Q1": ["kept"]})
check("ничья посчитана", ambiguous, 1)
check("ничья не считается переходом", moved, 0)

# --- 3. Дат нет вовсе — тот же случай: различить нечем. --------------------
squads, moved, ambiguous = csw.keep_latest_club({
    "Q1": [member("nodate", None)],
    "Q2": [member("nodate", None)],
})
check("без дат — выброшен, а не угадан", keys(squads), {})
check("без дат посчитан неразличимым", ambiguous, 1)

# --- 4. Один клуб у игрока — ничего не трогаем даже без даты. -------------
squads, moved, ambiguous = csw.keep_latest_club({
    "Q1": [member("solo", None), member("other", "2025-01-01")],
})
check("один клуб проходит как есть", keys(squads), {"Q1": ["other", "solo"]})
check("одиночка не переход", (moved, ambiguous), (0, 0))

# --- 5. Три клуба подряд: остаётся ровно последний. ------------------------
squads, moved, ambiguous = csw.keep_latest_club({
    "Q1": [member("journey", "2022-01-01")],
    "Q2": [member("journey", "2024-06-30")],
    "Q3": [member("journey", "2026-08-01")],
})
check("из трёх открытых строк остаётся самая поздняя",
      keys(squads), {"Q3": ["journey"]})
check("три строки — один переход", moved, 1)

# --- 6. Клуб, опустевший после чистки, не остаётся пустым ключом. ---------
squads, _m, _a = csw.keep_latest_club({
    "Q1": [member("only", "2022-01-01")],
    "Q2": [member("only", "2026-01-01")],
})
check("опустевший клуб исчезает, а не висит пустым списком",
      "Q1" in squads, False)


# --- 7. Тёзки в ОДНОЙ карточке: выбрасываются целиком. -------------------
# «Матеус Кунья» — форвард МЮ и вратарь «Крузейро», два человека и одна
# карточка. Выбрать наугад значит поставить чужого; сравнивать их даты
# бессмысленно — даты принадлежат разным людям.
def row(card_id, club_key):
    return {"card_id": card_id, "club_key": club_key}


rows, shared = csw.drop_shared_cards([
    row("cunha", "manchester united"),
    row("cunha", "cruzeiro"),
    row("garnacho", "aston villa"),
])
check("карточка на два клуба выброшена целиком",
      sorted((r["card_id"], r["club_key"]) for r in rows),
      [("garnacho", "aston villa")])
check("выброшенная посчитана", shared, 1)

rows, shared = csw.drop_shared_cards([
    row("solo", "arsenal"), row("solo", "arsenal"), row("other", "chelsea"),
])
check("одна карточка ДВАЖДЫ в ОДНОМ клубе — не тёзки, остаётся",
      len(rows), 3)
check("повтор в одном клубе не считается общим", shared, 0)

check("пустой список не падает", csw.drop_shared_cards([]), ([], 0))


# --------------------------------------------------------------------------
# dedup_rows: повтор пары (клуб, карточка) внутри ОДНОЙ вставки. Не тёзки —
# падение: `on conflict do update` на повторе отвечает «cannot affect row a
# second time» и валит всю пачку, а не строку.
# --------------------------------------------------------------------------
rows, repeats = csw.dedup_rows([
    {"club_key": "arsenal", "card_id": "solo", "position": "первая"},
    {"club_key": "arsenal", "card_id": "solo", "position": "вторая"},
    {"club_key": "chelsea", "card_id": "solo"},
    {"club_key": "arsenal", "card_id": "other"},
])
check("повтор пары снят", len(rows), 3)
check("снятое посчитано", repeats, 1)
check("оставлена ПЕРВАЯ, а не последняя", rows[0].get("position"), "первая")
check("тот же card_id в другом клубе — не повтор",
      sorted((r["club_key"], r["card_id"]) for r in rows),
      [("arsenal", "other"), ("arsenal", "solo"), ("chelsea", "solo")])
check("пустой список не падает", csw.dedup_rows([]), ([], 0))


# --------------------------------------------------------------------------
# mint_cards: кому заводится карточка, а кому — нет.
# --------------------------------------------------------------------------
def miss(club, qid, name_ru, name_en=None, start="2025-07-01", number=None):
    return (club, {"qid": qid, "name_ru": name_ru, "name_en": name_en or name_ru,
                   "start": start, "number": number, "position": "нападающий"})


cards, rows = csw.mint_cards([miss("arsenal", "Q1", "Смит, Джон")], {})
check("карточка заведена", len(cards), 1)
check("имя приведено к формату колоды", cards[0]["name"], "Джон Смит")
check("QID сохранён рядом", cards[0]["qid"], "Q1")
check("строка состава ссылается на новую карточку",
      [(r["club_key"], r["card_id"]) for r in rows],
      [("arsenal", cards[0]["id"])])
check("id — валидный UUID", len(cards[0]["id"]), 36)
check("позиция и дата перенесены",
      (rows[0]["position"], rows[0]["joined_at"]), ("нападающий", "2025-07-01"))

cards, rows = csw.mint_cards(
    [miss("arsenal", "Q1", "Джон Смит")], {csw.canon("Смит Джон"): "уже-есть"})
check("у кого карточка есть — не заводится", (cards, rows), ([], []))

# ⚠️ Ради этого гарда всё и написано: две карточки «Маркиньос» на двух разных
# людей — то, на что жаловался владелец. Одно имя, два QID — не заводим НИ ОДНУ.
cards, rows = csw.mint_cards(
    [miss("psg", "Q1", "Маркиньос"), miss("palmeiras", "Q2", "Маркиньос")], {})
check("тёзкам карточка не заводится вовсе", (cards, rows), ([], []))

cards, rows = csw.mint_cards(
    [miss("psg", "Q1", "Маркиньос"), miss("palmeiras", "Q2", "Маркиньос"),
     miss("arsenal", "Q3", "Букайо Сака")], {})
check("сосед по списку от тёзок не страдает",
      [c["name"] for c in cards], ["Букайо Сака"])

# Один человек в двух клубах после keep_latest_club невозможен, но если такое
# всё-таки придёт — это ОДНА карточка, и её потом выбросит drop_shared_cards.
cards, rows = csw.mint_cards(
    [miss("psg", "Q1", "Мбаппе"), miss("real madrid", "Q1", "Мбаппе")], {})
check("один QID под одним именем — одна карточка", len(cards), 1)
check("а строки — обе, разбираться им у drop_shared_cards", len(rows), 2)

cards, rows = csw.mint_cards([miss("arsenal", "Q1", None, None)], {})
check("без имени карточки нет", (cards, rows), ([], []))

check("пустой список не падает", csw.mint_cards([], {}), ([], []))

# --------------------------------------------------------------------------
# fetch_squads: кеш ответов WDQS. Гард не от расхода, а от РАЗНЫХ неполных
# ответов: пачка, потерявшая пять попыток, возвращается пустой, и повтор
# обязан переспросить ИМЕННО ЕЁ, а не всё заново.
# --------------------------------------------------------------------------
class FakeCache(object):
    def __init__(self):
        self.data = {}
        self.reads = 0

    def get(self, ns, key):
        self.reads += 1
        return self.data.get((ns, key))

    def set(self, ns, key, value):
        # Пустое не сохраняем — так же, как настоящий FileCache
        # (_carries_nothing): иначе потерянная пачка закешируется как «клубов
        # нет» и повтор её уже не переспросит.
        if value:
            self.data[(ns, key)] = value


ASKED = []


def fake_sparql(answers):
    def _sparql(query, retries=5):
        ASKED.append(query)
        return answers.pop(0) if answers else []
    return _sparql


def binding(club, qid):
    return {"club": {"value": "http://www.wikidata.org/entity/" + club},
            "p": {"value": "http://www.wikidata.org/entity/" + qid},
            "ru": {"value": qid}, "en": {"value": qid},
            "start": {"value": "2025-07-01T00:00:00Z"}}


real_sparql, real_batch = csw.sparql, csw.CLUB_BATCH
try:
    csw.CLUB_BATCH = 1
    cache = FakeCache()

    # Первый прогон: первая пачка отвечает, вторая теряется (пустой список).
    del ASKED[:]
    csw.sparql = fake_sparql([[binding("Q1", "Q100")], []])
    got = csw.fetch_squads(["Q1", "Q2"], 2022, cache, today="2026-09-03")
    check("ответившая пачка разобрана", sorted(got), ["Q1"])
    check("спрошены обе пачки", len(ASKED), 2)
    check("в кеше только ответившая", len(cache.data), 1)

    # Повтор в тот же день: первая — из кеша, вторая спрашивается снова и
    # теперь отвечает. Итог ПОЛНЫЙ, хотя ни один прогон полным не был.
    del ASKED[:]
    csw.sparql = fake_sparql([[binding("Q2", "Q200")]])
    got = csw.fetch_squads(["Q1", "Q2"], 2022, cache, today="2026-09-03")
    check("повтор добрал потерянное", sorted(got), ["Q1", "Q2"])
    check("переспрошена ТОЛЬКО потерянная пачка", len(ASKED), 1)
    check("состав из кеша не потерялся",
          [m["qid"] for m in got.get("Q1", [])], ["Q100"])

    # ⚠️ Дата в ключе: назавтра состав спрашивается заново. Вечный кеш
    # заморозил бы заявку на день сбора.
    del ASKED[:]
    csw.sparql = fake_sparql([[binding("Q1", "Q100")], [binding("Q2", "Q200")]])
    csw.fetch_squads(["Q1", "Q2"], 2022, cache, today="2026-09-04")
    check("назавтра кеш не отвечает — трансферы", len(ASKED), 2)

    # Без кеша функция работает как раньше.
    del ASKED[:]
    csw.sparql = fake_sparql([[binding("Q1", "Q100")]])
    got = csw.fetch_squads(["Q1"], 2022, None, today="2026-09-03")
    check("без кеша ничего не падает", sorted(got), ["Q1"])
finally:
    csw.sparql, csw.CLUB_BATCH = real_sparql, real_batch


# --------------------------------------------------------------------------
# cards_insert_sql: выписка новых карточек. Проверяется НЕ глазами, а тем же
# разбором, которым её читает docs/cards_pageviews_by_qid.py, — то есть
# круговым рейсом: что выписали, то и прочиталось.
#
# ⚠️ Ради этого гарда всё и вынесено в функцию. Первая версия склеивалась
# через ",\n".join(...), и запятая-разделитель оказывалась ПОСЛЕ «-- Q12345»,
# то есть внутри комментария. В файле на восемьсот строк это не видно ничем,
# кроме синтаксической ошибки при применении.
# --------------------------------------------------------------------------
_pv_spec = importlib.util.spec_from_file_location(
    "cards_pageviews_by_qid",
    os.path.join(ROOT, "docs", "cards_pageviews_by_qid.py"))
pvq = importlib.util.module_from_spec(_pv_spec)
_pv_spec.loader.exec_module(pvq)

new_cards = [
    {"id": "11111111-2222-3333-4444-555555555555",
     "name": "Килиан Мбаппе", "name_en": "Kylian Mbappe", "qid": "Q21621995"},
    {"id": "66666666-7777-8888-9999-000000000000",
     "name": "Шеймус О'Брайен", "name_en": None, "qid": "Q1"},
    {"id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
     "name": "Лионель Месси", "name_en": "Lionel Messi", "qid": "Q615"},
]
sql = "\n".join(csw.cards_insert_sql(new_cards))
import tempfile
_fh = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False,
                                  encoding="utf-8")
_fh.write(sql)
_fh.close()
parsed = pvq.cards_from_sql(_fh.name)
os.unlink(_fh.name)

check("прочитаны ВСЕ выписанные карточки, а не первая",
      [(c[0], c[2]) for c in parsed],
      [(c["id"], c["qid"]) for c in new_cards])
check("апостроф в имени пережил и выписку, и разбор",
      [c[1] for c in parsed[1:2]], ["Шеймус О'Брайен"])
check("name_en = null не ломает строку",
      [c[2] for c in parsed[1:2]], ["Q1"])
check("запятая-разделитель стоит ДО комментария",
      sql.count("'игроки'),  --"), len(new_cards) - 1)
check("у последней строки разделителя нет",
      sql.count("'игроки')  --"), 1)
check("вставка идёт с on conflict do nothing",
      "on conflict (id) do nothing;" in sql, True)


if FAILURES:
    print("ПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("test_squad_latest_club: OK")
