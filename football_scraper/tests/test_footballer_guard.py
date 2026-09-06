"""Гард «человек И футболист» (offline, без сети и базы).

Покрывает is_footballer() из docs/cards_from_roster.py — единственное, что
стоит между составом клуба и карточкой в колоде.

⚠️ Проверяется НАСТОЯЩАЯ функция, а не её копия.

Формы утверждений сняты с боевых ответов Викиданных 05.09.2026, а не
придуманы: придуманная разметка проверяет фантазию автора.

    python3 tests/test_footballer_guard.py
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_spec = importlib.util.spec_from_file_location(
    "cards_from_roster", os.path.join(ROOT, "docs", "cards_from_roster.py"))
cfr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cfr)

FAILURES = []


def check(name, got, want):
    if got != want:
        FAILURES.append("%s\n    ожидалось: %r\n    получено : %r" % (name, want, got))


def claim(qid):
    return {"mainsnak": {"datavalue": {"value": {"id": qid}}}}


HUMAN, FOOTBALLER = "Q5", "Q937857"

PLAYER = {"P31": [claim(HUMAN)], "P106": [claim(FOOTBALLER)]}
# Тренер: человек, но не футболист. На странице клуба у Transfermarkt он есть.
COACH = {"P31": [claim(HUMAN)], "P106": [claim("Q628099")]}
# Q188760 — Халк, персонаж Marvel. Стоял у карточки «Халк» со славой 90.
MARVEL = {"P31": [claim("Q1114461")], "P106": [claim("Q937857")]}
# Q16479897 — «Bellingham (surname)». Отсюда у Беллингема была слава 7.
SURNAME = {"P31": [claim("Q101352")]}
CLUB = {"P31": [claim("Q476028")]}
EMPTY = {}

check("человек и футболист — берём", cfr.is_footballer(PLAYER), True)
check("тренер — человек, но НЕ футболист", cfr.is_footballer(COACH), False)
check("персонаж Marvel с P106 футболиста — НЕ человек", cfr.is_footballer(MARVEL), False)
check("страница фамилии — отвергнута", cfr.is_footballer(SURNAME), False)
check("клуб — не человек", cfr.is_footballer(CLUB), False)
check("пустые утверждения — не футболист", cfr.is_footballer(EMPTY), False)

# ⚠️ Игрок, у которого несколько занятий (футболист и, скажем, актёр), —
# по-прежнему футболист: гард требует НАЛИЧИЯ, а не единственности.
MULTI = {"P31": [claim(HUMAN)], "P106": [claim("Q33999"), claim(FOOTBALLER)]}
check("несколько занятий не мешают", cfr.is_footballer(MULTI), True)

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: снять требование «человек» — и персонаж Marvel
# немедленно проходит. Если проверка этого не заметит, она пустая.
_real = cfr.is_footballer
try:
    cfr.is_footballer = lambda claims: cfr.claim_has(claims, "P106", FOOTBALLER)
    check("контроль: без P31=Q5 персонаж Marvel ПРОХОДИТ",
          cfr.is_footballer(MARVEL), True)
finally:
    cfr.is_footballer = _real

check("после контроля гард снова отвергает персонажа",
      cfr.is_footballer(MARVEL), False)

if FAILURES:
    print("ПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("test_footballer_guard: OK")
