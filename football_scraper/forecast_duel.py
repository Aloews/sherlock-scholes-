#!/usr/bin/env python3
"""Три прогнозиста на ОДНИХ признаках и ОДНИХ матчах: ЛЛМ, дрозофила, свой.

Владелец: «дашборд нужен с удачными исходами матчей внутри pro версии Шерлок
Скоулс и сравнением двух моделей „прогнозистов“: а) ллм б) мозг дрозофилы
в) свой вариант, улучшенный».

ЧТО ЗДЕСЬ ЧЕМ ЯВЛЯЕТСЯ, БЕЗ ПРИУКРАШИВАНИЯ:

  а) «ЛЛМ» — обученная ЛИНЕЙНАЯ ГОЛОВА над девятью признаками матча. Это и
     есть то, чем оказывается «обучить модель на прогнозы», когда признаков
     девять, а не миллиард токенов: ридж-регрессия. Называть это языковой
     моделью было бы враньём, и на экране написано то же самое.

  б) «Мозг дрозофилы» — РЕЗЕРВУАР: неизменяемая разрежённая случайная
     проекция, за ней обучается только считыватель. Так устроено чтение
     коннектома мухи (FlyWire, 139 255 нейронов, Nature, октябрь 2024):
     связи фиксированы, учится выход. Это архитектурная аналогия, а НЕ
     симуляция мухи, и экран говорит это прямо.

  в) «Свой вариант» — смесь двух предыдущих, которая МОЛЧИТ, когда не
     уверена. Зовёт матч только если обе модели сошлись в сторону порога И
     обе отошли от него не меньше чем на `margin`. Смесь, стягивание и
     margin подбираются на ОТЛОЖЕННОЙ ЧАСТИ ОБУЧАЮЩЕЙ ВЫБОРКИ, а не на
     проверочной: подбор по проверочной — это подглядывание в ответ, и
     именно так первый замер этого проекта «выиграл» у медианы.

⚠️ МОЛЧАНИЕ — ЕДИНСТВЕННОЕ, ЧТО ЗДЕСЬ ДЕЙСТВИТЕЛЬНО РАБОТАЕТ, и это замер, а
не идея. На всех матчах ни одна из моделей не бьёт «всегда говори больше 2.5»
(58.2 %). Две вещи были проверены и ОТВЕРГНУТЫ: подбор границы решения (на
отложенной лучшей была 2.45, а на новых матчах она сделала ЛИНЕЙНУЮ ГОЛОВУ
хуже — 0.5831 → 0.5707) и стягивание само по себе. А отказ от части матчей
переносится: отложенная и проверочная части двигаются вместе.

    запас   зовёт  угадано (отложенная) │ зовёт  угадано (новые)
     0.0    94.7%        57.3 %         │ 92.5%       58.3 %
     0.2    57.2%        59.1 %         │ 57.3%       63.3 %
     0.3    38.6%        63.8 %         │ 39.6%       66.1 %
     0.5    14.8%        64.1 %         │ 13.1%       72.8 %

⚠️ ПОЭТОМУ У «СВОЕГО» ДВА ЧИСЛА, А НЕ ОДНО. Доля угаданных считается ТОЛЬКО
по названным матчам, и рядом обязано стоять, какую долю матчей он назвал.
Показать первое без второго значит сравнивать модель, отвечающую на лёгкие
вопросы, с моделями, отвечающими на все.

⚠️ РАЗРЕЗ ПО ВРЕМЕНИ, А НЕ СЛУЧАЙНЫЙ. Случайный разрез кладёт в обучение
матчи из будущего относительно проверочных, и тогда любая модель выглядит
умнее, чем она есть.

⚠️ ТОЧКА ОТСЧЁТА — МЕДИАНА, А НЕ СРЕДНЕЕ. Средняя ошибка (MAE) минимизируется
медианой; сравнение со средним завышает любую модель. Первый прогон этого
проекта против среднего дал «выигрыш» 0.0175 при t=3.3, а против медианы тот
же прогон дал ПРОИГРЫШ −0.0040 при t=−0.66.
"""
from __future__ import annotations

import numpy as np

# Признаки матча. Порядок фиксирован: по нему же читаются веса.
FEATURES = ("h_gf", "h_ga", "a_gf", "a_ga", "h_sd", "a_sd")

# Порог «много голов / мало голов». Тоталы целые, поэтому 2.5 не бывает
# ничьей по порогу: исход всегда определён.
LINE = 2.5


def design(rows) -> np.ndarray:
    """Матрица признаков: единица, шесть чисел команд и два их сложения.

    Сложения (атака хозяев + оборона гостей и наоборот) — не украшение: это
    ровно та величина, которой пользуется нынешняя формула приложения, и без
    неё сравнение было бы нечестным к ней.
    """
    out = []
    for r in rows:
        h_gf, h_ga = float(r["h_gf"]), float(r["h_ga"])
        a_gf, a_ga = float(r["a_gf"]), float(r["a_ga"])
        out.append([1.0, h_gf, h_ga, a_gf, a_ga,
                    h_gf + a_ga, a_gf + h_ga,
                    float(r["h_sd"]), float(r["a_sd"])])
    return np.asarray(out, dtype=float)


def targets(rows) -> np.ndarray:
    return np.asarray([float(r["total"]) for r in rows], dtype=float)


def split_by_time(n: int, train=0.6, valid=0.2):
    """Три отрезка ПОДРЯД: учим, подбираем, проверяем.

    ⚠️ ОТДЕЛЬНЫЙ ОТРЕЗОК ДЛЯ ПОДБОРА ОБЯЗАТЕЛЕН. Подбирать λ или вес смеси по
    проверочной части — то же самое, что учиться на ней: число получается
    красивое, а на новых матчах его нет.
    """
    if n < 3:
        raise ValueError("нужно хотя бы три матча, чтобы разрезать на три части")
    i = max(1, int(n * train))
    j = max(i + 1, int(n * (train + valid)))
    j = min(j, n - 1)
    return slice(0, i), slice(i, j), slice(j, n)


def mae(pred, true) -> float:
    return float(np.mean(np.abs(np.asarray(pred, float) - np.asarray(true, float))))


def hit_rate(pred, true, line: float = LINE, called=None) -> float:
    """Доля матчей, где модель угадала СТОРОНУ порога — «удачный исход».

    Средняя ошибка — про точность числа, а угадан исход или нет — про то, что
    видит игрок. Это разные вещи, и на экране они стоят порознь.

    `called` — маска названных матчей. Молчание не считается ни попаданием,
    ни промахом: оно считается НЕ НАЗВАННЫМ, и рядом печатается покрытие.
    """
    p = np.asarray(pred, float) > line
    t = np.asarray(true, float) > line
    ok = p == t
    if called is not None:
        called = np.asarray(called, bool)
        if not called.any():
            return 0.0
        ok = ok[called]
    return float(np.mean(ok))


# Запасы, среди которых ищется молчание. Ноль тоже в списке: если замер
# скажет, что молчать не надо, подбор честно вернёт ноль.
MARGINS = (0.0, 0.1, 0.2, 0.3, 0.4, 0.5)

# Ниже этой доли названных матчей «свой вариант» превращается в оракула на
# трёх матчах: красивый процент, никому не нужный. Порог — не вкус, а защита
# от подбора на шуме: на четверти матчей отложенная и проверочная части ещё
# двигаются вместе, на десятой уже нет.
MIN_COVERAGE = 0.25


def gate(p_lin, p_res, margin: float, line: float = LINE):
    """Названные матчи: обе модели сошлись И обе отошли от порога."""
    pl, pr = np.asarray(p_lin, float), np.asarray(p_res, float)
    agree = (pl > line) == (pr > line)
    far = np.minimum(np.abs(pl - line), np.abs(pr - line)) >= margin
    return agree & far


def fit_gate(p_lin_va, p_res_va, yva, margins=MARGINS, min_coverage=MIN_COVERAGE,
             line: float = LINE):
    """Запас — по ОТЛОЖЕННОЙ части, и только пока названных матчей хватает."""
    best = None
    for m in margins:
        sel = gate(p_lin_va, p_res_va, m, line)
        if sel.mean() < min_coverage:
            continue
        h = hit_rate(p_lin_va, yva, line, called=sel)
        if best is None or h > best[0]:
            best = (h, m)
    # Ни один запас не дал нужного покрытия — значит молчать нечем: зовём всё.
    return best[1] if best else 0.0


def ridge(A: np.ndarray, b: np.ndarray, lam: float) -> np.ndarray:
    """Обычная ридж-регрессия. Свободный член НЕ штрафуется.

    Штрафовать его значит тянуть прогноз к нулю голов, а не к среднему уровню
    результативности, — ошибка, которая выглядит как «модель осторожничает».
    """
    n = A.shape[1]
    R = lam * np.eye(n)
    R[0, 0] = 0.0
    return np.linalg.solve(A.T @ A + R, A.T @ b)


LAMBDAS = (0.01, 0.1, 1.0, 10.0, 100.0, 1000.0)


def fit_linear(Xtr, ytr, Xva, yva, lambdas=LAMBDAS):
    """Линейная голова: λ выбирается по ОТЛОЖЕННОЙ части обучения."""
    best = None
    for lam in lambdas:
        w = ridge(Xtr, ytr, lam)
        m = mae(Xva @ w, yva)
        if best is None or m < best[0]:
            best = (m, lam, w)
    return best[2], best[1]


def reservoir_projection(n_in: int, n_units: int, seed: int = 7, density: float = 0.35):
    """Неизменяемая разрежённая проекция — «связи», которые не учатся.

    Разрежённость здесь — свойство схемы, а не подгонка: в коннектоме мухи
    нейрон соединён с малой долей остальных, и именно фиксированная случайная
    разрежённая проекция даёт резервуару его богатство.
    """
    rng = np.random.default_rng(seed)
    W = rng.normal(0.0, 1.0, size=(n_in, n_units))
    W *= rng.random((n_in, n_units)) < density
    return W


def reservoir_state(X: np.ndarray, W: np.ndarray) -> np.ndarray:
    """Состояние «нейронов» плюс свободный член для считывателя."""
    S = np.tanh(X @ W)
    return np.hstack([np.ones((len(S), 1)), S])


def fit_reservoir(Xtr, ytr, Xva, yva, units=200, seed=7, lambdas=LAMBDAS):
    """Учится ТОЛЬКО считыватель; проекция остаётся как была.

    ⚠️ ЧИСЛО ИЗМЕРЕНИЙ ОГРАНИЧЕНО НЕ ВКУСОМ. Когда измерений больше, чем
    примеров, считыватель запоминает обучающую выборку целиком: замерено —
    на обучающих 1.2923, на новых 1.3189. Запомнить не значит понять.
    """
    W = reservoir_projection(Xtr.shape[1], units, seed)
    Str, Sva = reservoir_state(Xtr, W), reservoir_state(Xva, W)
    best = None
    for lam in lambdas:
        w = ridge(Str, ytr, lam)
        m = mae(Sva @ w, yva)
        if best is None or m < best[0]:
            best = (m, lam, w)
    return W, best[2], best[1]


BLEND_GRID = tuple(round(x, 2) for x in np.linspace(0.0, 1.0, 11))
SHRINK_GRID = tuple(round(x, 2) for x in np.linspace(0.0, 1.0, 11))


def fit_blend(p_lin_va, p_res_va, yva, median):
    """Свой вариант: доля смеси и сила стягивания — обе по отложенной части.

    ⚠️ СТЯГИВАНИЕ К МЕДИАНЕ — НЕ ТРЮК, А ВЫВОД ИЗ ЗАМЕРА. Ни одна из двух
    моделей не бьёт медиану уверенно; в такой обстановке лучшее, что можно
    сделать, — не отходить от неё дальше, чем оправдано. Если замер скажет,
    что стягивать не нужно, подбор вернёт 1.0 и стягивания не будет.
    """
    best = None
    for w in BLEND_GRID:
        mix = w * np.asarray(p_lin_va, float) + (1.0 - w) * np.asarray(p_res_va, float)
        for k in SHRINK_GRID:
            m = mae(median + k * (mix - median), yva)
            if best is None or m < best[0]:
                best = (m, w, k)
    return best[1], best[2]


def blend_predict(p_lin, p_res, w: float, k: float, median: float) -> np.ndarray:
    mix = w * np.asarray(p_lin, float) + (1.0 - w) * np.asarray(p_res, float)
    return median + k * (mix - median)


def run_duel(rows, units: int = 200, seed: int = 7):
    """Весь опыт целиком: вернуть прогнозы на ПРОВЕРОЧНОЙ части и сводку.

    Возвращает (predictions, summary):
      predictions — словарь «модель → массив прогнозов на проверочной части»,
                    плюс ключ 'true' с настоящими тоталами и 'rows' с самими
                    матчами этой части;
      summary     — словарь «модель → {mae, hit, n}».
    """
    X, y = design(rows), targets(rows)
    tr, va, te = split_by_time(len(y))
    Xtr, Xva, Xte = X[tr], X[va], X[te]
    ytr, yva, yte = y[tr], y[va], y[te]

    med = float(np.median(ytr))

    w_lin, lam_lin = fit_linear(Xtr, ytr, Xva, yva)
    W, w_res, lam_res = fit_reservoir(Xtr, ytr, Xva, yva, units=units, seed=seed)

    p_lin_va = Xva @ w_lin
    p_res_va = reservoir_state(Xva, W) @ w_res
    mix_w, mix_k = fit_blend(p_lin_va, p_res_va, yva, med)
    margin = fit_gate(p_lin_va, p_res_va, yva)

    p_lin = Xte @ w_lin
    p_res = reservoir_state(Xte, W) @ w_res
    p_own = blend_predict(p_lin, p_res, mix_w, mix_k, med)
    called = gate(p_lin, p_res, margin)
    p_med = np.full_like(yte, med)
    # Нынешняя формула приложения — она не учится вовсе и стоит здесь как
    # вторая точка отсчёта: «стало ли лучше того, что уже показывается».
    p_cur = (Xte[:, 5] + Xte[:, 6]) / 2.0

    preds = {"llm": p_lin, "fly": p_res, "own": p_own,
             "median": p_med, "current": p_cur}
    summary = {k: {"mae": mae(v, yte), "hit": hit_rate(v, yte), "n": int(len(yte)),
                   "coverage": 1.0}
               for k, v in preds.items()}
    # ⚠️ У «своего» ошибка считается по ВСЕМ матчам (он всё равно называет
    # число), а доля угаданных — только по названным. Смешать их значило бы
    # сравнивать несравнимое.
    summary["own"]["hit"] = hit_rate(p_own, yte, called=called)
    summary["own"]["coverage"] = float(called.mean())
    summary["own"]["margin"] = margin
    summary["llm"]["lambda"] = lam_lin
    summary["fly"]["lambda"] = lam_res
    summary["fly"]["units"] = units
    summary["own"]["blend"] = mix_w
    summary["own"]["shrink"] = mix_k
    summary["median"]["value"] = med
    preds["true"] = yte
    preds["called"] = called
    preds["rows"] = list(rows)[te]
    return preds, summary


# ───────────────────────── боевой прогон ──────────────────────────────────
# Ниже — только чтение/запись. Всё, что можно проверить тестом, живёт выше и
# не зависит ни от сети, ни от переменных окружения.

def _fetch(url: str, key: str, path: str, page: int = 1000):
    """Постранично, потому что PostgREST режет ответ по db-max-rows.

    В `duel_features` пять с половиной тысяч строк, а отдаётся тысяча. Молча.
    Этот проект уже спотыкался об это на карточках.
    """
    import json
    import urllib.request
    rows, offset = [], 0
    while True:
        req = urllib.request.Request(
            f"{url.rstrip('/')}/rest/v1/{path}",
            headers={"apikey": key, "Authorization": "Bearer " + key,
                     "Range-Unit": "items", "Range": f"{offset}-{offset + page - 1}"})
        with urllib.request.urlopen(req, timeout=180) as r:
            part = json.loads(r.read())
        if not part:
            break
        rows += part
        offset += len(part)
        if len(part) < page:
            break
    return rows


def _write(url: str, key: str, path: str, body, method: str = "POST"):
    import json
    import urllib.request
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"apikey": key, "Authorization": "Bearer " + key,
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.status


def main() -> int:
    import os
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        print("нет SUPABASE_URL / SUPABASE_KEY")
        return 2

    rows = _fetch(url, key, "duel_features?select=*&order=match_date.asc")
    print(f"матчей с признаками без утечки: {len(rows)}")
    if len(rows) < 300:
        print("ПРОВАЛ: матчей слишком мало, чтобы разрезать на три части честно")
        return 1

    preds, summary = run_duel(rows)
    test_rows = preds["rows"]
    print(f"проверочная часть: {len(test_rows)} матчей, "
          f"{test_rows[0]['match_date']} … {test_rows[-1]['match_date']}")
    print()
    print(f"{'модель':<26}{'ошибка':>10}{'угадано':>10}{'назвал':>10}")
    print("-" * 56)
    for k in ("median", "current", "llm", "fly", "own"):
        s = summary[k]
        print(f"{k:<26}{s['mae']:>10.4f}{s['hit'] * 100:>9.1f}%"
              f"{s['coverage'] * 100:>9.1f}%")

    _write(url, key, "forecast_duel_match?ord=gte.0", None, method="DELETE")
    _write(url, key, "forecast_duel_model?model=neq.___", None, method="DELETE")

    _write(url, key, "forecast_duel_model", [
        {"model": k, "mae": round(v["mae"], 4), "hit_rate": round(v["hit"], 4),
         "matches": v["n"], "coverage": round(v["coverage"], 4),
         "params": {p: v[p] for p in ("lambda", "units", "blend", "shrink",
                                      "value", "margin") if p in v}}
        for k, v in summary.items()])

    batch = [
        {"ord": i, "match_date": r["match_date"],
         "home_key": r["home_key"], "away_key": r["away_key"],
         "total": int(preds["true"][i]),
         "p_llm": round(float(preds["llm"][i]), 3),
         "p_fly": round(float(preds["fly"][i]), 3),
         "p_own": round(float(preds["own"][i]), 3),
         "p_median": round(float(preds["median"][i]), 3),
         "own_called": bool(preds["called"][i])}
        for i, r in enumerate(test_rows)]
    for i in range(0, len(batch), 500):
        _write(url, key, "forecast_duel_match", batch[i:i + 500])
    print(f"\nзаписано: {len(batch)} матчей, {len(summary)} моделей")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
