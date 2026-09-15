#!/usr/bin/env python3
"""Признак чужой привязки у карточек-легенд."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from legend_guard import legend_link_is_suspect  # noqa: E402

fails: list[str] = []


def check(name: str, got, want) -> None:
    ok = got == want
    print(("✓ " if ok else "✗ ") + name + (f"  — получено {got!r}" if not ok else ""))
    if not ok:
        fails.append(name)


def card(fame, born=None, roster=0, stats=0):
    return {"fame": fame, "born_on": born, "roster_rows": roster, "stat_rows": stats}


def link(rating, born=None):
    return {"rating": rating, "born_on": born}


# ── ЧЕТЫРЕ СЛУЧАЯ С БОЕВОЙ БАЗЫ, РАДИ КОТОРЫХ ПРАВИЛО И ЗАВЕДЕНО ─────────────
# Клуб этих карточек игрок видел на экране, и он был чужой.
for name, fame, rating in (("Тьерри Анри", 100, 65), ("Фернандо Торрес", 97, 70),
                           ("Патрик Виейра", 96, 75), ("Серхио Агуэро", 96, 76)):
    check(f"{name}: привязка подозрительна",
          legend_link_is_suspect(card(fame), link(rating)), True)

# ── ОТРИЦАТЕЛЬНЫЕ КОНТРОЛИ: ПРАВИЛО ОБЯЗАНО МОЛЧАТЬ ──────────────────────────
# ⚠️ БЕЗ НИХ ПРАВИЛО МОЖНО «УЛУЧШИТЬ» ДО «ПОДОЗРИТЕЛЬНЫ ВСЕ», и оно снимет
# привязки у живых игроков — а это та же ошибка, только наоборот.

# Знамениты и юны, но следы настоящей игры есть.
check("Ламин Ямаль: не подозрителен (рейтинг высокий)",
      legend_link_is_suspect(card(99, roster=2, stats=73), link(95)), False)
check("Эндрик: не подозрителен (есть заявка и статистика)",
      legend_link_is_suspect(card(94, roster=1, stats=12), link(88)), False)

# Немолоды и невысоко оценены, но играют по-настоящему: у обоих правило
# молчит из-за следов игры. Оба найдены формальным отбором и оставлены глазами.
check("Ёитиро Какитани: играет — заявка на месте",
      legend_link_is_suspect(card(96, roster=1), link(78)), False)
check("Энди Кэрролл: играет — статистика на месте",
      legend_link_is_suspect(card(95, stats=4), link(77)), False)

# Каждый признак поодиночке обязан снимать подозрение.
check("дата у строки снимает подозрение",
      legend_link_is_suspect(card(100), link(65, born="2007-01-01")), False)
check("дата у карточки снимает подозрение",
      legend_link_is_suspect(card(100, born="1977-08-17"), link(65)), False)
check("высокий рейтинг снимает подозрение",
      legend_link_is_suspect(card(100), link(88)), False)
check("невысокая известность снимает подозрение",
      legend_link_is_suspect(card(60), link(65)), False)
check("рейтинга нет — не подозреваем",
      legend_link_is_suspect(card(100), link(None)), False)

# ⚠️ КОНТРОЛЬ САМОГО НАБОРА: правило обязано УМЕТЬ отвечать обоими ответами.
# Проверка, у которой все случаи дают False, зеленела бы и на `return False`.
check("правило различает случаи, а не всегда молчит",
      legend_link_is_suspect(card(100), link(65)), True)

print()
if fails:
    print(f"ПРОВАЛ: {len(fails)}")
    for f in fails:
        print(f"  {f}")
    # Выход только при падении: `pytest -q` импортирует файл целиком, и
    # `sys.exit(0)` на успехе рвёт сбор с INTERNALERROR.
    sys.exit(1)
print("все прошли")
