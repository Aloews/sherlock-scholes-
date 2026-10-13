#!/usr/bin/env python3
"""Walk-forward evaluation for the LLM and interpretable outcome models."""
from __future__ import annotations

import collections
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from forecast_duel import _fetch, split_by_time  # noqa: E402

OUTCOMES = ("H", "D", "A")

# Признаки линейной модели и свободный коэффициент.
#
# ⚠️ ФОРМА ДОМА И ФОРМА В ГОСТЯХ ЗДЕСЬ ОТДЕЛЬНО, И ЭТО НЕ ИЗБЫТОЧНОСТЬ.
# `h_gf` — среднее по ВСЕМ матчам команды, домашним и выездным вместе; команда,
# которая дома громит, а на выезде не забивает, выглядит в нём «средней». Дома
# и в гостях играют по-разному, и соперника надо мерить его выездной формой, а
# не общей.
LIN_FEATURES = ("h_gf", "h_ga", "a_gf", "a_ga", "h_wr", "a_wr", "h_dr", "a_dr",
                "h_home_gf", "h_home_ga", "h_home_wr",
                "a_away_gf", "a_away_ga", "a_away_wr")

# Пороги «свой вариант» перебираются на ПРОВЕРОЧНОЙ части.
TAU_GRID = tuple(round(0.05 * k, 2) for k in range(0, 21))       # 0.00 … 1.00
LAMBDAS = (0.01, 0.1, 1.0, 10.0, 100.0)

# Во сколько голов обходится разница в долю побед. Перебирается на проверочной.
K_FORM_GRID = (0.0, 0.5, 1.0, 1.5, 2.0, 3.0)

# ─────────────────────────────────────────────────────────── данные ──────────
def design(rows) -> np.ndarray:
    out = []
    for r in rows:
        v = [1.0] + [float(r[f] or 0.0) for f in LIN_FEATURES]
        # Разница ожидаемых голов — та же величина, что читает «свой вариант».
        v.append(expected_diff(r))
        out.append(v)
    return np.asarray(out, dtype=float)


def labels(rows) -> np.ndarray:
    return np.asarray([OUTCOMES.index(r["outcome"]) for r in rows], dtype=int)


def expected_diff(r) -> float:
    """Ожидаемая разница мячей по ОБЩЕЙ форме: атака одних против обороны других.

    ⚠️ ЭТО НЕ «РЕЙТИНГ КОМАНДЫ», А РАЗНИЦА ДВУХ ОЖИДАНИЙ, и считается она
    крест-накрест: сколько хозяева обычно забивают И сколько гости обычно
    пропускают — против того же для гостей. Одна сторона без другой врёт:
    команда, много забивающая слабым, и команда, мало пропускающая от сильных,
    выглядят одинаково, пока не сведёшь их вместе.
    """
    h = (float(r["h_gf"] or 0) + float(r["a_ga"] or 0)) / 2.0
    a = (float(r["a_gf"] or 0) + float(r["h_ga"] or 0)) / 2.0
    return h - a


def venue_diff(r) -> float:
    """То же самое, но по форме ИМЕННО НА ЭТОМ ПОЛЕ.

    Хозяева считаются по своим домашним матчам, гости — по своим выездным.
    Это главное, чем «свой вариант» отличается от двух остальных.
    """
    h = (float(r["h_home_gf"] or 0) + float(r["a_away_ga"] or 0)) / 2.0
    a = (float(r["a_away_gf"] or 0) + float(r["h_home_ga"] or 0)) / 2.0
    return h - a


def venue_form(r) -> float:
    """Разница долей побед: дома у хозяев против выезда у гостей."""
    return float(r["h_home_wr"] or 0) - float(r["a_away_wr"] or 0)


# ─────────────────────────────────────────────────── линейная модель ─────────
def fit_linear(X: np.ndarray, y: np.ndarray, lam: float) -> np.ndarray:
    """Гребневая регрессия «один против всех», три столбца коэффициентов.

    ⚠️ СВОБОДНЫЙ ЧЛЕН НЕ ШТРАФУЕТСЯ. Штраф на него тянет ВСЕ три оценки к
    нулю одинаково и делает модель тем ближе к «бросаю монету», чем больше
    лямбда, — а выглядит это как «регуляризация работает».
    """
    n_f = X.shape[1]
    eye = np.eye(n_f)
    eye[0, 0] = 0.0
    W = np.zeros((n_f, len(OUTCOMES)))
    for k in range(len(OUTCOMES)):
        t = (y == k).astype(float)
        W[:, k] = np.linalg.solve(X.T @ X + lam * eye, X.T @ t)
    return W


def linear_call(W: np.ndarray, X: np.ndarray) -> list[str]:
    return [OUTCOMES[i] for i in np.argmax(X @ W, axis=1)]


# ──────────────────────────────────────────────────── свой вариант ──────────
def own_call(r, tau_home: float, tau_away: float, k_form: float) -> str:
    """Три названные величины, один пересчёт и два порога — и ничего больше.

    ⚠️ ЭТО НАРОЧНО ЧИТАЕМАЯ МОДЕЛЬ. Её решение можно пересказать словами, и
    ровно поэтому её есть смысл держать рядом с мухой и линейной суммой: когда
    она ошибается, видно, на чём.

      1. ПЕРЕВЕС НА ЭТОМ ПОЛЕ `d` (`venue_diff`) — сколько мячей перевеса у
         хозяев, если считать хозяев по их ДОМАШНИМ матчам, а гостей по их
         ВЫЕЗДНЫМ. Ни муха, ни линейная сумма в прошлой версии этого не
         различали: у обеих «форма» была средним по двум разным играм.

      2. ПЕРЕВЕС ПО ПОБЕДАМ `f` (`venue_form`) — разница долей побед там же.
         Голы и победы — разные вещи: команда может возить соперников 3:0 и
         сыпаться в равных матчах. `k_form` переводит долю побед в голы, и это
         единственный подбираемый коэффициент; его величина сама по себе
         читается как «сколько голов перевеса стоит разница в долю побед».

      3. СКЛОННОСТЬ К НИЧЬЕЙ — средняя доля ничьих двух команд. Она СДВИГАЕТ
         ПОРОГИ, а не добавляется к счёту: две команды, которые вечно играют
         вничью, требуют большего перевеса, чтобы поверить в победу.

    Решение:

        s = d + k_form * f
        s >  tau_home * (1 + ничейность)   → хозяева
        s < -tau_away * (1 + ничейность)   → гости
        иначе                              → ничья

    ⚠️ ПОРОГИ РАЗНЫЕ ДЛЯ ДОМА И ГОСТЕЙ, И ЭТО НЕ АСИММЕТРИЯ РАДИ АСИММЕТРИИ.
    Дома выигрывают заметно чаще (1979 из 4523), поэтому порог «поверить в
    гостей» обязан быть выше: одинаковые пороги называли бы гостей слишком
    часто.
    """
    s = venue_diff(r) + k_form * venue_form(r)
    drawish = (float(r["h_dr"] or 0) + float(r["a_dr"] or 0)) / 2.0
    if s > tau_home * (1.0 + drawish):
        return "H"
    if s < -tau_away * (1.0 + drawish):
        return "A"
    return "D"


def fit_own(rows) -> tuple[float, float, float]:
    best, arg = -1.0, (0.2, 0.2, 0.0)
    for k in K_FORM_GRID:
        for th in TAU_GRID:
            for ta in TAU_GRID:
                hit = sum(1 for r in rows if own_call(r, th, ta, k) == r["outcome"])
                if hit > best:
                    best, arg = hit, (th, ta, k)
    return arg


# ────────────────────────────────────────────────────────── замер ───────────
def accuracy(pred: list[str], rows) -> float:
    return sum(1 for p, r in zip(pred, rows) if p == r["outcome"]) / max(1, len(rows))


def paired_se(a: list[str], b: list[str], rows) -> float:
    """Стандартная ошибка РАЗНИЦЫ двух моделей на одних и тех же матчах.

    ⚠️ ПАРНАЯ, А НЕ ДВЕ НЕЗАВИСИМЫЕ. Модели видят одни и те же матчи, и
    несвязанная формула завышает ошибку — то есть прячет настоящую разницу.
    """
    d = np.array([(x == r["outcome"]) - (y == r["outcome"])
                  for x, y, r in zip(a, b, rows)], dtype=float)
    return float(d.std(ddof=1) / math.sqrt(len(d))) if len(d) > 1 else float("inf")


# Зеркальная пара признаков: хозяева <-> гости.
MIRROR_PAIRS = (("h_gf", "a_gf"), ("h_ga", "a_ga"), ("h_wr", "a_wr"),
                ("h_dr", "a_dr"), ("h_home_gf", "a_away_gf"),
                ("h_home_ga", "a_away_ga"), ("h_home_wr", "a_away_wr"))
MIRROR_OUTCOME = {"H": "A", "A": "H", "D": "D"}


def mirrored(r) -> dict:
    """Тот же матч, где команды поменялись местами, и исход тоже."""
    d = dict(r)
    for a, b in MIRROR_PAIRS:
        d[a], d[b] = r.get(b), r.get(a)
    d["outcome"] = MIRROR_OUTCOME[r["outcome"]]
    return d


def run(rows) -> dict:
    rows = sorted(rows, key=lambda r: (r["match_date"], r["home_key"], r["away_key"]))
    tr, va, te = split_by_time(len(rows))
    train, valid, test = rows[tr], rows[va], rows[te]

    Xtr, ytr = design(train), labels(train)
    Xva, Xte = design(valid), design(test)
    best = (-1.0, LAMBDAS[0], None)
    for lam in LAMBDAS:
        W = fit_linear(Xtr, ytr, lam)
        score = accuracy(linear_call(W, Xva), valid)
        if score > best[0]:
            best = (score, lam, W)
    _, lam, W = best
    llm = linear_call(W, Xte)

    th, ta, kf = fit_own(valid)
    own = [own_call(r, th, ta, kf) for r in test]
    top = collections.Counter(r["outcome"] for r in train).most_common(1)[0][0]
    baseline = [top] * len(test)

    return {
        "matches": {"train": len(train), "valid": len(valid), "test": len(test)},
        "baseline_outcome": top,
        "lambda": lam,
        "own_tau": {"home": th, "away": ta, "k_form": kf},
        "accuracy": {
            "llm": round(accuracy(llm, test), 4),
            "own": round(accuracy(own, test), 4),
            "baseline": round(accuracy(baseline, test), 4),
        },
        "vs_baseline_se": {
            "llm": round(paired_se(llm, baseline, test), 4),
            "own": round(paired_se(own, baseline, test), 4),
        },
        "calls": {
            "llm": dict(collections.Counter(llm)),
            "own": dict(collections.Counter(own)),
        },
    }


def main() -> int:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        print("нет SUPABASE_URL / SUPABASE_KEY")
        return 1
    rows = _fetch(url, key, "duel_features?select=*&order=match_date.asc")
    rows = [r for r in rows if r.get("outcome")]
    print(json.dumps(run(rows), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
