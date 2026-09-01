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

if FAILURES:
    print("ПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("test_squad_latest_club: OK")
