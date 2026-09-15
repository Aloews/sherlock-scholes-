#!/usr/bin/env python3
"""Проверки мозга мухи: не кода, а УТВЕРЖДЕНИЙ о нём.

⚠️ ЭТОТ ФАЙЛ ПОЯВИЛСЯ ПОТОМУ, ЧТО ПРЕДЫДУЩАЯ «МУХА» БЫЛА ПОДДЕЛКОЙ. Под этим
именем стояла случайная матрица плюс гребневая регрессия — ни одной настоящей
связи, ни одного дофаминового нейрона. Проверки ниже написаны так, чтобы
подделка их НЕ ПРОШЛА: каждая опирается на свойство, которого у случайной
матрицы нет.

Запуск: python3 tests/test_fly_brain.py   (код возврата 0 — всё сошлось)
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fly_brain import (  # noqa: E402
    FLOOR, KC_SPARSITY, ODOUR, FlyBrain, OUTCOMES, encode_odour,
    outcome_compartments, row_to_odour,
)

fails: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("✓ " if ok else "✗ ") + name + (f"  — {detail}" if detail else ""))
    if not ok:
        fails.append(name)


ROW = {
    "h_gf": 1.6, "h_ga": 1.1, "a_gf": 1.2, "a_ga": 1.4,
    "h_wr": 0.5, "a_wr": 0.3, "h_dr": 0.25, "a_dr": 0.3,
    "h_home_gf": 2.0, "h_home_ga": 0.9, "h_home_wr": 0.6,
    "a_away_gf": 1.0, "a_away_ga": 1.7, "a_away_wr": 0.2,
}

fly = FlyBrain.load()

# ── связи настоящие ──────────────────────────────────────────────────────────
# ⚠️ ЧИСЛА ИЗ ОПУБЛИКОВАННОЙ АНАТОМИИ hemibrain, а не из нашего кода. Случайная
# матрица такой формы не имеет: у неё нет ни клеток Кеньона, ни MBON.
check("клеток Кеньона около двух тысяч", 1800 <= fly.kc_mbon.shape[0] <= 2000,
      f"{fly.kc_mbon.shape[0]}")
check("выходных нейронов несколько десятков", 60 <= fly.kc_mbon.shape[1] <= 80,
      f"{fly.kc_mbon.shape[1]}")
check("проекционных нейронов больше сотни", 120 <= fly.pn_kc.shape[0] <= 150,
      f"{fly.pn_kc.shape[0]}")

# ⚠️ ГЛАВНАЯ ПРОВЕРКА ПОДЛИННОСТИ: у клетки Кеньона 5–8 входов от PN («когти»).
# Это измеренная биология. У случайной разрежённой матрицы это число — что
# угодно, потому что его задаёт параметр density.
claws = np.median((fly.pn_kc > 0).sum(axis=0))
check("у клетки Кеньона 5–8 входов, как у мухи", 5 <= claws <= 8, f"медиана {claws:.0f}")

# ⚠️ ВЕСА — ЦЕЛЫЕ ЧИСЛА СИНАПСОВ, а не выборка из нормального распределения.
w = fly.kc_mbon0[fly.kc_mbon0 > 0]
check("веса — счётчики синапсов, а не гауссов шум",
      bool(np.all(w == np.round(w))) and w.min() >= 1,
      f"минимум {w.min():.0f}, целых {bool(np.all(w == np.round(w)))}")

# ── разрежённый код ──────────────────────────────────────────────────────────
kc = fly.kenyon(encode_odour(row_to_odour(ROW), fly.pn_kc.shape[0]))
share = (kc > 0).mean()
check("горит около 5 % клеток Кеньона", abs(share - KC_SPARSITY) < 0.02,
      f"{share * 100:.1f} %")

# Разные матчи — разные коды, иначе мозг ничего не различает.
other = dict(ROW, h_gf=0.6, h_home_gf=0.7, h_home_wr=0.1, a_away_wr=0.6)
kc2 = fly.kenyon(encode_odour(row_to_odour(other), fly.pn_kc.shape[0]))
inter = float(((kc > 0) & (kc2 > 0)).sum())
union = float(((kc > 0) | (kc2 > 0)).sum())
check("разные матчи дают разные коды", 0.05 < inter / union < 0.95,
      f"перекрытие {inter / union:.2f}")

# ── дофамин ослабляет, а не усиливает ────────────────────────────────────────
before = fly.kc_mbon.copy()
fly.learn(row_to_odour(ROW), actual="H")
delta = fly.kc_mbon - before
check("подкрепление только ОСЛАБЛЯЕТ синапсы", float(delta.max()) <= 0.0,
      f"максимальное изменение {delta.max():+.4f}")
check("подкрепление что-то изменило", float(delta.min()) < 0.0,
      f"минимальное изменение {delta.min():+.4f}")

# ⚠️ МЕНЯЮТСЯ ТОЛЬКО СИНАПСЫ ГОРЕВШИХ КЛЕТОК. Это и есть совпадение «KC активна
# + дофамин»: правило, которое трогает всё подряд, — это уже не муха.
touched_rows = set(np.nonzero(delta)[0].tolist())
active_rows = set(np.nonzero(kc > 0)[0].tolist())
check("тронуты только горевшие клетки", touched_rows <= active_rows,
      f"{len(touched_rows)} строк из {len(active_rows)} горевших")

# ⚠️ И ТОЛЬКО КОМПАРТМЕНТЫ НАЗВАННОГО ИСХОДА. Дофамин приходит в свой
# компартмент, а не во все сразу.
touched_cols = set(np.nonzero(delta)[1].tolist())
check("тронуты только компартменты сбывшегося исхода",
      touched_cols <= set(fly.groups["H"]["push"]),
      f"{sorted(touched_cols)[:5]}…")

# ── пол синапса ──────────────────────────────────────────────────────────────
hot = FlyBrain.load()
for _ in range(400):
    hot.learn(row_to_odour(ROW), actual="A")
idx = hot.kc_mbon0 > 0
ratio = (hot.kc_mbon[idx] / hot.kc_mbon0[idx]).min()
check("синапс не умирает до нуля", ratio >= FLOOR - 1e-9, f"минимум {ratio:.3f} от исходного")

# ── обучение действительно меняет ответ ──────────────────────────────────────
fresh = FlyBrain.load()
first = fresh.predict(row_to_odour(ROW))
target = next(o for o in OUTCOMES if o != first)
for _ in range(60):
    fresh.learn(row_to_odour(ROW), actual=target)
check("подкрепление переучивает ответ", fresh.predict(row_to_odour(ROW)) == target,
      f"{first} → {fresh.predict(row_to_odour(ROW))}, учили на {target}")

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: без подкрепления ответ НЕ меняется. Проверка выше
# без этой строки прошла бы и у мозга, который просто шумит.
idle = FlyBrain.load()
check("без подкрепления ответ не меняется",
      idle.predict(row_to_odour(ROW)) == FlyBrain.load().predict(row_to_odour(ROW)),
      "два чистых мозга отвечают одинаково")

# ── раздача компартментов ────────────────────────────────────────────────────
groups = outcome_compartments(fly.meta)
used = [i for g in groups.values() for side in g.values() for i in side]
check("каждый выходной нейрон отдан не больше чем одному исходу",
      len(used) == len(set(used)), f"{len(used)} назначений")
check("задействована заметная часть выходных нейронов",
      len(used) >= fly.kc_mbon.shape[1] // 2, f"{len(used)} из {fly.kc_mbon.shape[1]}")
for o, g in groups.items():
    check(f"у исхода {o} есть обе стороны", bool(g["push"]) and bool(g["pull"]),
          f"прочь {len(g['push'])}, к {len(g['pull'])}")

# ── сохранение памяти ────────────────────────────────────────────────────────
saved = FlyBrain.load()
for _ in range(30):
    saved.learn(row_to_odour(ROW), actual="D")
i2 = saved.nonzero_index()
vec = saved.kc_mbon[i2].copy()
restored = FlyBrain.load()
restored.kc_mbon[restored.nonzero_index()] = vec
check("память переносится вектором без потерь",
      bool(np.allclose(restored.kc_mbon, saved.kc_mbon)),
      f"{vec.size} синапсов")
check("сохраняются только существующие связи",
      vec.size == int((saved.kc_mbon0 > 0).sum()), f"{vec.size}")

# ── пол: полка, а не остановка ───────────────────────────────────────────────
# ⚠️ ЭТОТ БЛОК СТОИТ ПРОТИВ СОБЛАЗНА, А НЕ ПРОТИВ ОШИБКИ. Депрессия
# односторонняя, доля синапсов на полу растёт, и отсюда напрашивается возврат
# весов к коннектому — «мухи же забывают». Его пробовали, и он стирает память
# начисто; разбор с числами лежит у `FLOOR` в fly_brain.py. Замер показывает
# полку, и проверка держит ИМЕННО замедление: равные порции учений дают всё
# меньшую прибавку пола.
shelf = FlyBrain.load()
shelf.depression = 0.02
check("чистый мозг — на полу никого", shelf.floored_fraction() == 0.0,
      f"{shelf.floored_fraction()}")

_rng = np.random.default_rng(20260915)


def _teach_random(brain, n):
    """Учить на случайных, но РАЗНЫХ матчах — как в бою, по одному разу.

    Разные нарочно: повтор одной выборки — это переобучение, другая болезнь,
    и пол при нём ведёт себя иначе (разбор у `FLOOR`).
    """
    for _ in range(n):
        row = {k: float(_rng.random()) * ceiling for k, ceiling in ODOUR}
        brain.learn(row_to_odour(row),
                    actual=OUTCOMES[int(_rng.integers(len(OUTCOMES)))])


_marks = []
for _ in range(4):
    _teach_random(shelf, 400)
    _marks.append(shelf.floored_fraction())
_steps = [_marks[i + 1] - _marks[i] for i in range(len(_marks) - 1)]

check("пол появляется", _marks[0] > 0.0, f"{_marks[0]:.1%} после 400 учений")
check("пол растёт", _marks[-1] > _marks[0],
      " → ".join(f"{m:.1%}" for m in _marks))
check("прибавка убывает — это полка, а не разгон", _steps[-1] < _steps[0],
      " → ".join(f"{d:+.1%}" for d in _steps))
check("пол не съедает всё", _marks[-1] < 1.0, f"{_marks[-1]:.1%}")

# ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: замер обязан ВИДЕТЬ исчерпание, когда оно есть.
# Мозг, у которого одно совпадение сразу кладёт синапс на пол, обязан дать
# долю 100 % — иначе проверки выше смотрят в пустоту.
_hard = FlyBrain.load()
_hard.depression = 1.0
_teach_random(_hard, 400)
check("контроль: мгновенная депрессия даёт полный пол",
      _hard.floored_fraction() == 1.0, f"{_hard.floored_fraction():.1%}")


print()
if fails:
    print(f"ПРОВАЛ: {len(fails)}")
    for f in fails:
        print(f"  {f}")
    # ⚠️ ВЫХОД ТОЛЬКО ПРИ ПАДЕНИИ, И ЭТО НЕ СТИЛЬ, А УСЛОВИЕ РАБОТЫ CI.
    # `pytest -q` СОБИРАЕТ все файлы `test_*.py`, то есть ИМПОРТИРУЕТ их. При
    # импорте тело модуля исполняется целиком, и `sys.exit(0)` на успехе рвёт
    # сбор с `INTERNALERROR> SystemExit: 0` — прогон падает именно тогда, когда
    # все проверки прошли. Так и вышло: локально «все прошли», в CI красное.
    # Соседние самостоятельные тесты выходят тем же способом — только при
    # падении; pytest проходит мимо них, ничего не собрав.
    sys.exit(1)
print("все прошли")
