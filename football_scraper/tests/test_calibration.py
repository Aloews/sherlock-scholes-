"""Калибровка уверенности — БЕЗ СЕТИ И БЕЗ БАЗЫ.

Проверяется не «код запускается», а четыре свойства, ради которых калибровка
и заводится:

  1. на выдуманных данных с известным ответом она этот ответ находит;
  2. она НЕ МЕНЯЕТ ПОРЯДОК матчей по уверенности — иначе это была бы уже
     другая модель, а не честный пересчёт числа;
  3. на заведомо лживом входе («уверен на 90 %», попадает в 45 %) выигрыш
     обязан быть положительным — отрицательный контроль калибровки;
  4. разрез по времени влияет на ответ, то есть он не декорация.

    python3 football_scraper/tests/test_calibration.py
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from calibration import (  # noqa: E402
    apply_platt, brier, evaluate, fit_platt, logit, sigmoid, split_by_order,
)

FAILS = []


def check(name, ok):
    print(("  ✓ " if ok else "  ✗ ") + name)
    if not ok:
        FAILS.append(name)


print("\nЛогит и сигмоида")
check("logit ↔ sigmoid обратны друг другу",
      all(abs(sigmoid(logit(p)) - p) < 1e-9 for p in (0.01, 0.2, 0.5, 0.77, 0.99)))
check("края не взрываются: logit(0) и logit(1) конечны",
      math.isfinite(logit(0.0)) and math.isfinite(logit(1.0)))
check("sigmoid не переполняется на больших числах",
      sigmoid(1000.0) == 1.0 or abs(sigmoid(1000.0) - 1.0) < 1e-12)
check("sigmoid не переполняется на больших отрицательных",
      abs(sigmoid(-1000.0)) < 1e-12)

print("\nПодгонка находит известный ответ")
# Строим выборку, где истинная вероятность = sigmoid(0.5·logit(p) − 0.3).
rng = random.Random(7)
TRUE_A, TRUE_B = 0.5, -0.3
sample = []
for _ in range(20000):
    p = rng.uniform(0.05, 0.95)
    q = sigmoid(TRUE_A * logit(p) + TRUE_B)
    sample.append((p, 1.0 if rng.random() < q else 0.0))
a, b = fit_platt(sample)
check(f"наклон найден: {a:.3f} против {TRUE_A} (±0.1)", abs(a - TRUE_A) < 0.1)
check(f"сдвиг найден: {b:.3f} против {TRUE_B} (±0.1)", abs(b - TRUE_B) < 0.1)

print("\nПорядок не меняется — это НЕ новая модель")
ps = [0.05, 0.11, 0.3, 0.42, 0.5, 0.63, 0.79, 0.9, 0.97]
for aa, bb in ((0.5, -0.3), (0.06, -0.42), (2.0, 1.0), (0.01, 0.0)):
    out = [apply_platt(aa, bb, p) for p in ps]
    check(f"a={aa}, b={bb}: монотонно возрастает",
          all(x <= y + 1e-12 for x, y in zip(out, out[1:])))
check("самый уверенный прогноз остаётся самым уверенным",
      max(range(len(ps)), key=lambda i: apply_platt(0.06, -0.42, ps[i])) == len(ps) - 1)

print("\nОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: на лживом входе выигрыш обязан быть")
# «Уверен на 0.90», попадает в 0.45 — ровно болезнь этого проекта.
liar = []
for i in range(4000):
    p = 0.90
    liar.append((p, 1.0 if rng.random() < 0.45 else 0.0))
res = evaluate(liar)
check(f"калибровка лучше сырого: {res['brier_cal']:.4f} < {res['brier_raw']:.4f}",
      res["brier_cal"] < res["brier_raw"])
check("на одном значении уверенности калибровка сходится к доле попаданий",
      abs(apply_platt(res["a"], res["b"], 0.90) - 0.45) < 0.05)

print("\nОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: на честном входе портить нельзя")
honest = [(p, 1.0 if rng.random() < p else 0.0)
          for p in (rng.uniform(0.05, 0.95) for _ in range(6000))]
res_h = evaluate(honest)
check(f"уже честное не ухудшено больше чем на 0.005: "
      f"{res_h['brier_cal']:.4f} против {res_h['brier_raw']:.4f}",
      res_h["brier_cal"] <= res_h["brier_raw"] + 0.005)
check("на честном входе калибровка обгоняет константу",
      res_h["brier_cal"] < res_h["brier_const"])

print("\nРазрез по времени — не декорация")
tr, te = split_by_order(list(range(100)), 0.7)
check("70/30 и ничего не потеряно", len(tr) == 70 and len(te) == 30 and tr[-1] == 69)
check("проверочная часть идёт ПОСЛЕ учебной", min(te) > max(tr))
tr2, te2 = split_by_order([1, 2], 0.7)
check("на двух точках обе части непусты", len(tr2) >= 1 and len(te2) >= 1)

print("\nОтказы вместо тихой чепухи")
for name, fn in (("brier на пустом", lambda: brier([])),
                 ("fit_platt на пустом", lambda: fit_platt([])),
                 ("evaluate на коротком", lambda: evaluate([(0.5, 1.0)] * 10))):
    try:
        fn()
        check(f"{name} обязан ругаться", False)
    except ValueError:
        check(f"{name} обязан ругаться", True)

print()
if FAILS:
    print(f"ПРОВАЛ: {len(FAILS)}")
    for f in FAILS:
        print(f"  {f}")
    sys.exit(1)
print("OK — калибровка проверена")
