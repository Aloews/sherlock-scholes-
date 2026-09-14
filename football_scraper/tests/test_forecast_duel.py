#!/usr/bin/env python3
"""Проверки обучения трёх прогнозистов.

⚠️ ЭТИ ТЕСТЫ СТЕРЕГУТ НЕ КОД, А ВЫВОДЫ. Замер обучения ломается не падением, а
красивым числом: разрез, подсмотревший будущее, подбор по проверочной части,
точка отсчёта, выбранная в свою пользу, — всё это даёт ЗЕЛЁНЫЙ прогон и
неверный ответ. Каждый случай ниже соответствует ошибке, которая в этом
проекте УЖЕ БЫЛА сделана.

Запускается сам: python3 tests/test_forecast_duel.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import forecast_duel as F  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    if cond:
        print(f"  ok   {name}")
    else:
        print(f"  ПРОВАЛ {name}  {detail}")
        FAILS.append(name)


def synth(n=600, seed=1, noise=0.6):
    """Матчи с ИЗВЕСТНЫМ законом: тотал линейно зависит от признаков.

    Нужны затем, чтобы отличить «модель не выучила» от «в данных нечего
    учить». На боевых данных этой разницы не видно — там обе картины
    выглядят одинаково.
    """
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        h_gf, h_ga = rng.uniform(0.5, 2.5), rng.uniform(0.5, 2.5)
        a_gf, a_ga = rng.uniform(0.5, 2.5), rng.uniform(0.5, 2.5)
        total = 0.5 * (h_gf + a_ga) + 0.5 * (a_gf + h_ga) + rng.normal(0, noise)
        rows.append({"h_gf": h_gf, "h_ga": h_ga, "a_gf": a_gf, "a_ga": a_ga,
                     "h_sd": rng.uniform(0.8, 1.6), "a_sd": rng.uniform(0.8, 1.6),
                     "total": round(max(total, 0.0), 3),
                     "match_date": f"2026-01-{(_ % 28) + 1:02d}",
                     "home_key": "h", "away_key": "a"})
    return rows


# ── Признаки ───────────────────────────────────────────────────────────────
rows = synth()
X = F.design(rows)
print("признаки")
check("матрица той же высоты, что список матчей", X.shape[0] == len(rows))
check("девять столбцов: единица, шесть чисел, два сложения", X.shape[1] == 9,
      f"вышло {X.shape[1]}")
check("первый столбец — свободный член, ровно единицы", np.all(X[:, 0] == 1.0))
check("столбец 5 — атака хозяев плюс оборона гостей",
      abs(X[0, 5] - (rows[0]["h_gf"] + rows[0]["a_ga"])) < 1e-9)
check("столбец 6 — атака гостей плюс оборона хозяев",
      abs(X[0, 6] - (rows[0]["a_gf"] + rows[0]["h_ga"])) < 1e-9)
check("порядок матчей сохраняется — иначе разрез по времени теряет смысл",
      abs(X[7, 1] - rows[7]["h_gf"]) < 1e-9)

# ── Разрез по времени ──────────────────────────────────────────────────────
print("\nразрез по времени")
tr, va, te = F.split_by_time(1000)
check("три части покрывают всё без дыр",
      tr.start == 0 and tr.stop == va.start and va.stop == te.start and te.stop == 1000,
      f"{tr} {va} {te}")
check("части не пересекаются — иначе обучение видит проверочный матч",
      tr.stop <= va.start and va.stop <= te.start)
check("ОБУЧЕНИЕ РАНЬШЕ ПРОВЕРКИ, а не наоборот", tr.start < te.start)
check("каждая часть непуста", tr.stop > tr.start and va.stop > va.start and te.stop > te.start)
check("на трёх матчах всё ещё режется", F.split_by_time(3)[2].stop == 3)
try:
    F.split_by_time(2)
    check("на двух матчах отказывается резать", False, "не отказался")
except ValueError:
    check("на двух матчах отказывается резать", True)

# ── Ридж ───────────────────────────────────────────────────────────────────
print("\nридж-регрессия")
A = np.array([[1.0, 0.0], [1.0, 1.0], [1.0, 2.0], [1.0, 3.0]])
b = np.array([1.0, 3.0, 5.0, 7.0])          # ровно 1 + 2x
w0 = F.ridge(A, b, 1e-9)
check("без штрафа находит точный ответ", np.allclose(w0, [1.0, 2.0], atol=1e-4),
      str(w0))
w_big = F.ridge(A, b, 1e6)
check("большой штраф прижимает НАКЛОН к нулю", abs(w_big[1]) < 0.01, str(w_big))
check("большой штраф НЕ прижимает свободный член к нулю", abs(w_big[0]) > 1.0,
      f"свободный член {w_big[0]:.3f} — штраф на нём тянул бы прогноз к нулю голов")
check("штраф не меняет размер ответа", F.ridge(A, b, 10.0).shape == (2,))

# ── Средняя ошибка и попадания ─────────────────────────────────────────────
print("\nмеры")
check("ошибка нуля при точном совпадении", F.mae([1, 2, 3], [1, 2, 3]) == 0.0)
check("ошибка считается по модулю", F.mae([0, 4], [2, 2]) == 2.0)
check("МЕДИАНА, А НЕ СРЕДНЕЕ, минимизирует среднюю ошибку",
      F.mae(np.full(5, np.median([1, 1, 1, 1, 20])), [1, 1, 1, 1, 20])
      < F.mae(np.full(5, np.mean([1, 1, 1, 1, 20])), [1, 1, 1, 1, 20]),
      "на этом замер проекта однажды «выиграл» у точки отсчёта")
check("попадание — это СТОРОНА порога, а не близость числа",
      F.hit_rate([10.0], [3.0]) == 1.0,
      "прогноз 10 при тотале 3 ошибается на семь голов, но сторону угадал")
check("промах стороны — ноль", F.hit_rate([2.0], [3.0]) == 0.0)
check("доля считается по всем", F.hit_rate([3.0, 2.0], [3.0, 3.0]) == 0.5)
check("маска названных сужает счёт",
      F.hit_rate([3.0, 2.0], [3.0, 3.0], called=[True, False]) == 1.0)
check("никого не назвал — ноль, а не деление на ноль",
      F.hit_rate([3.0], [3.0], called=[False]) == 0.0)

# ── Линейная голова ────────────────────────────────────────────────────────
print("\nлинейная голова («ЛЛМ»)")
y = F.targets(rows)
tr, va, te = F.split_by_time(len(y))
w_lin, lam = F.fit_linear(X[tr], y[tr], X[va], y[va])
m_lin = F.mae(X[te] @ w_lin, y[te])
m_med = F.mae(np.full(te.stop - te.start, np.median(y[tr])), y[te])
check("НА ДАННЫХ С ЗАКОНОМ обучение бьёт медиану", m_lin < m_med,
      f"{m_lin:.4f} против {m_med:.4f} — если нет, обучения не происходит вовсе")
check("λ выбран из списка", lam in F.LAMBDAS, str(lam))
check("веса той же длины, что признаки", w_lin.shape == (9,))

noise_rows = synth(n=600, seed=5, noise=8.0)
Xn, yn = F.design(noise_rows), F.targets(noise_rows)
tn, vn, en = F.split_by_time(len(yn))
w_n, lam_n = F.fit_linear(Xn[tn], yn[tn], Xn[vn], yn[vn])
check("НА ШУМЕ выбирается БОЛЬШИЙ штраф, чем на законе", lam_n >= lam,
      f"шум {lam_n}, закон {lam} — иначе подбор λ ничего не делает")

# ── Резервуар ──────────────────────────────────────────────────────────────
print("\nрезервуар («мозг дрозофилы»)")
W1 = F.reservoir_projection(9, 50, seed=3)
W2 = F.reservoir_projection(9, 50, seed=3)
W3 = F.reservoir_projection(9, 50, seed=4)
check("одно зерно — одна и та же проекция", np.array_equal(W1, W2))
check("разные зёрна — разные проекции", not np.array_equal(W1, W3))
check("проекция РАЗРЕЖЕНА, а не плотна", (W1 == 0).mean() > 0.4,
      f"нулей {(W1 == 0).mean():.2f} — плотная проекция это уже не резервуар")
S = F.reservoir_state(X[:10], W1)
check("состояние ограничено tanh", np.all(np.abs(S[:, 1:]) <= 1.0))
check("у состояния есть свободный член", np.all(S[:, 0] == 1.0))
check("ширина состояния — измерения плюс один", S.shape[1] == 51)

Wr, w_res, lam_res = F.fit_reservoir(X[tr], y[tr], X[va], y[va], units=60)
check("резервуар тоже бьёт медиану на данных с законом",
      F.mae(F.reservoir_state(X[te], Wr) @ w_res, y[te]) < m_med)

# ⚠️ Случай, ради которого написан весь файл: запоминание.
Wb, w_b, _ = F.fit_reservoir(X[tr], y[tr], X[va], y[va], units=2000)
tr_err = F.mae(F.reservoir_state(X[tr], Wb) @ w_b, y[tr])
te_err = F.mae(F.reservoir_state(X[te], Wb) @ w_b, y[te])
check("ИЗМЕРЕНИЙ БОЛЬШЕ, ЧЕМ ПРИМЕРОВ — на обученных лучше, чем на новых",
      tr_err < te_err,
      f"обученные {tr_err:.4f}, новые {te_err:.4f}: запомнить не значит понять")

# ── Смесь и молчание ───────────────────────────────────────────────────────
print("\nсвой вариант: смесь и молчание")
med = float(np.median(y[tr]))
pl = X[va] @ w_lin
pr = F.reservoir_state(X[va], Wr) @ w_res
mw, mk = F.fit_blend(pl, pr, y[va], med)
check("доля смеси в пределах от нуля до единицы", 0.0 <= mw <= 1.0, str(mw))
check("сила стягивания в пределах от нуля до единицы", 0.0 <= mk <= 1.0, str(mk))
check("при доле 1 смесь — это ровно линейная голова",
      np.allclose(F.blend_predict(pl, pr, 1.0, 1.0, med), pl))
check("при доле 0 смесь — это ровно резервуар",
      np.allclose(F.blend_predict(pl, pr, 0.0, 1.0, med), pr))
check("стягивание в ноль даёт ровно медиану",
      np.allclose(F.blend_predict(pl, pr, 0.5, 0.0, med), med))
check("смесь не хуже худшего из двух на отложенной части",
      F.mae(F.blend_predict(pl, pr, mw, mk, med), y[va])
      <= max(F.mae(pl, y[va]), F.mae(pr, y[va])) + 1e-9)

sel0 = F.gate([3.0, 2.0], [3.0, 2.0], 0.0)
check("запас ноль — названы все, где модели сошлись", bool(sel0[0] and sel0[1]))
check("модели разошлись — матч не называется",
      not F.gate([3.0], [2.0], 0.0)[0])
check("обе близко к порогу — матч не называется при запасе",
      not F.gate([2.6], [2.6], 0.3)[0])
check("обе далеко и сошлись — называется",
      bool(F.gate([3.5], [3.4], 0.3)[0]))
check("ОДНА далеко, другая впритык — НЕ называется: берётся ближайшая",
      not F.gate([4.0], [2.51], 0.3)[0])

# ⚠️ Защита от «оракула на трёх матчах».
few = F.fit_gate([3.0, 3.0, 2.0, 2.0], [3.0, 3.0, 2.0, 2.0], [9.0, 9.0, 0.0, 0.0],
                 margins=(0.0, 9.9), min_coverage=0.25)
check("запас, который заткнул бы почти всех, не выбирается", few == 0.0,
      f"выбран {few} — молчащая модель показывает красивый процент ни о чём")

# ── Весь опыт целиком ──────────────────────────────────────────────────────
print("\nопыт целиком")
preds, summary = F.run_duel(rows, units=60)
check("есть все пять участников",
      set(summary) == {"llm", "fly", "own", "median", "current"}, str(set(summary)))
n_te = te.stop - te.start
for k in ("llm", "fly", "own", "median", "current"):
    check(f"{k}: прогноз на каждый проверочный матч", len(preds[k]) == n_te)
check("настоящие тоталы той же длины", len(preds["true"]) == n_te)
check("матчи проверочной части той же длины", len(preds["rows"]) == n_te)
check("ПЕРВЫЙ проверочный матч — тот же, что в исходном списке",
      preds["rows"][0] is rows[te.start],
      "иначе прогноз в дашборде будет подписан чужим матчем")
check("покрытие своего варианта не больше единицы",
      0.0 <= summary["own"]["coverage"] <= 1.0)
check("у остальных покрытие ровно единица",
      all(summary[k]["coverage"] == 1.0 for k in ("llm", "fly", "median", "current")))
check("доля угаданных у каждого в пределах от нуля до единицы",
      all(0.0 <= v["hit"] <= 1.0 for v in summary.values()))
check("число матчей одно на всех",
      len({v["n"] for v in summary.values()}) == 1)
check("медиана предсказывает одно и то же число всем",
      len(set(np.round(preds["median"], 6))) == 1)

# Повторяемость: тот же вход и то же зерно — тот же ответ.
p2, s2 = F.run_duel(rows, units=60)
check("ОПЫТ ПОВТОРЯЕМ: тот же вход даёт тот же ответ",
      np.allclose(preds["fly"], p2["fly"]) and s2["own"]["hit"] == summary["own"]["hit"])
p3, s3 = F.run_duel(rows, units=60, seed=99)
check("другое зерно — другой резервуар (значит зерно вообще используется)",
      not np.allclose(preds["fly"], p3["fly"]))

# ⚠️ УТЕЧКА: если в обучение подложить будущее, ошибка ОБЯЗАНА упасть. Тест
# проверяет не код, а то, что разрез вообще на что-то влияет.
shuffled = list(rows)
np.random.default_rng(0).shuffle(shuffled)
_, s_leak = F.run_duel(shuffled, units=60)
check("перемешанные матчи дают ДРУГОЙ ответ — разрез по времени не декорация",
      abs(s_leak["llm"]["mae"] - summary["llm"]["mae"]) > 1e-6)

print()
if FAILS:
    print(f"ПРОВАЛ: {len(FAILS)}")
    for f in FAILS:
        print(f"  {f}")
    sys.exit(1)
print("OK — все проверки обучения прошли")
