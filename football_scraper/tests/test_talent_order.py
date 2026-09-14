#!/usr/bin/env python3
"""Порядок чтения страниц игроков: сначала таланты, и НЕ только связанные.

⚠️ ЭТОТ ФАЙЛ ПРО ЗАМКНУТУЮ ПЕТЛЮ, КОТОРАЯ МОЛЧАЛА МЕСЯЦАМИ. Сборщик страниц
стоял с отбором `card_id=not.is.null` — читал только тех, кто уже связан с
колодой. У несвязанного игрока никогда не появлялась дата рождения, а без даты
его нечем связать: по имени не выходит, там однофамильцы. Замер 14.09.2026:
57 650 строк, страницы прочитаны у 2 613, и из 42 840 НЕСВЯЗАННЫХ дата была
ровно у двух.

Снаружи это выглядело как «всё работает»: шаг отрабатывал каждую ночь, что-то
читал, ничего не падало.

⚠️ И ПОРЯДОК «ПО УБЫВАНИЮ РЕЙТИНГА» БЫЛ НЕ ТЕМ. Рейтинг растёт с возрастом
(66.2 у тех, кому ≤19, против 76.5 у тех, кому 29+), поэтому такой порядок
читает ветеранов первыми, а молодых — последними.

Запуск: python3 tests/test_talent_order.py
"""
from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "docs"))

from soccerwiki_players import order_todo  # noqa: E402

SRC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "docs", "soccerwiki_players.py")

fails: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("✓ " if ok else "✗ ") + name + (f"  — {detail}" if detail else ""))
    if not ok:
        fails.append(name)


# ── порядок ──────────────────────────────────────────────────────────────────
talents = [{"pid": 3, "name": "юный"}, {"pid": 7, "name": "яркий"}]
linked = [{"pid": 100, "name": "ветеран"}, {"pid": 7, "name": "яркий"}]
out = order_todo(talents, linked)

check("таланты идут первыми",
      [r["pid"] for r in out][:2] == [3, 7],
      str([r["pid"] for r in out]))

check("повтор выброшен по первому вхождению",
      [r["pid"] for r in out] == [3, 7, 100],
      str([r["pid"] for r in out]))

check("ни один не потерян",
      {r["pid"] for r in out} == {3, 7, 100},
      f"{len(out)} строк")

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: порядок действительно зависит от первого списка.
# Функция, возвращающая просто `linked + talents` или отсортированное, прошла бы
# проверки выше на других данных.
swapped = order_todo(linked, talents)
check("контроль: порядок зависит от того, кто первый",
      [r["pid"] for r in swapped] != [r["pid"] for r in out],
      f"{[r['pid'] for r in swapped]} против {[r['pid'] for r in out]}")

check("пустая очередь талантов не ломает слияние",
      [r["pid"] for r in order_todo([], linked)] == [100, 7],
      str([r["pid"] for r in order_todo([], linked)]))

# ── сам отбор ────────────────────────────────────────────────────────────────
src = open(SRC, encoding="utf-8").read()

# ⚠️ ГЛАВНАЯ ПРОВЕРКА ФАЙЛА. Отбор `card_id=not.is.null` не должен быть
# ЕДИНСТВЕННЫМ источником: именно он и замыкал петлю.
check("очередь талантов участвует в отборе",
      "player_talent_queue" in src,
      "иначе читаются только связанные, и петля замкнута снова")

# Связанные с колодой по-прежнему читаются — это не регресс, а вторая группа.
check("связанные с колодой тоже читаются",
      re.search(r'"card_id":\s*"not\.is\.null"', src) is not None,
      "у Салаха рост и дата нужны не меньше")

check("порядок талантов берётся из очереди, а не из рейтинга",
      re.search(r'"order":\s*"place\.asc"', src) is not None,
      "рейтинг растёт с возрастом и ставит ветеранов первыми")

print()
if fails:
    print(f"ПРОВАЛ: {len(fails)}")
    for f in fails:
        print(f"  {f}")
    # Выход ТОЛЬКО при падении: `pytest -q` импортирует этот файл при сборе, и
    # `sys.exit(0)` на успехе порвал бы прогон (см. test_fly_brain.py).
    sys.exit(1)
print("все прошли")
