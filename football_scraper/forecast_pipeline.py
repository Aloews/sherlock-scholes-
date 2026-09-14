#!/usr/bin/env python3
"""Ночной круг трёх прогнозистов: назвать — сверить — получить дофамин.

⚠️ ЧЕТЫРЕ ШАГА, И ПОРЯДОК ВАЖЕН.

    train      подогнать линейную модель и пороги «своего варианта»,
               поднять память мухи из базы
    pick       назвать исход КАЖДОГО предстоящего матча всеми тремя —
               и записать это ДО матча
    grade      сверить записанное с тем, чем матч кончился
    dopamine   отдать исход мухе: PAM в компартменты сбывшегося исхода,
               депрессия синапсов KC→MBON у горевших клеток; память — обратно
               в базу

⚠️ ПРОГНОЗ ПИШЕТСЯ ДО МАТЧА И БОЛЬШЕ НЕ ПРАВИТСЯ. Без этого «история
прогнозов» превращается в историю объяснений задним числом: строку допишут
после результата, и она всегда будет выглядеть разумной.

⚠️ ДОФАМИН ПРИХОДИТ НА КАЖДЫЙ ИСХОД, А НЕ ТОЛЬКО НА УГАДАННЫЙ. У мухи
дофаминовый нейрон отвечает на ПОДКРЕПЛЕНИЕ (сахар, удар), а не на правоту
предсказания. Поэтому шаг `dopamine` идёт по всем сыгранным матчам, а
`correct` — это отдельная колонка для человека, а не вход в обучение.

    python3 forecast_pipeline.py [train|pick|grade|dopamine|all]
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fly_brain import FlyBrain, row_to_odour  # noqa: E402
from forecast_duel import _fetch, _write  # noqa: E402
from forecast_winner import (  # noqa: E402
    K_FORM_GRID, LAMBDAS, LIN_FEATURES, OUTCOMES, TAU_GRID,
    accuracy, design, expected_diff, fit_linear, fit_own, labels, own_call,
    venue_diff, venue_form,
)
from forecast_duel import split_by_time  # noqa: E402

MODELS = ("llm", "fly", "own")


# ─────────────────────────────────────────────────────────────── ввод ────────
def env() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("нет SUPABASE_URL / SUPABASE_KEY")
    return url, key


def now_iso() -> str:
    """Время в форме, годной И для тела запроса, И для адресной строки.

    ⚠️ `isoformat()` ЗДЕСЬ НЕ ГОДИТСЯ. Он даёт смещение `+00:00`, а плюс в
    адресе — это пробел: PostgREST отвечает 400 «invalid input syntax for type
    timestamp with time zone: 2026-09-14T19:43:18 00:00». Буква Z значит ровно
    то же самое и проходит и там, и там.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ────────────────────────────────────────────────────────────── обучение ─────
def fit_all(rows) -> dict:
    """Подогнать линейную модель и пороги; выбор — на ПРОВЕРОЧНОЙ части."""
    rows = sorted(rows, key=lambda r: (r["match_date"], r["home_key"], r["away_key"]))
    tr, va, _te = split_by_time(len(rows))
    train, valid = rows[tr], rows[va]

    Xtr, ytr, Xva = design(train), labels(train), design(valid)
    best = (-1.0, LAMBDAS[0], None)
    for lam in LAMBDAS:
        W = fit_linear(Xtr, ytr, lam)
        a = accuracy([OUTCOMES[i] for i in np.argmax(Xva @ W, axis=1)], valid)
        if a > best[0]:
            best = (a, lam, W)
    _, lam, W = best
    th, ta, kf = fit_own(valid)
    return {
        "llm": {"lambda": lam, "W": W.tolist(), "features": list(LIN_FEATURES)},
        "own": {"tau_home": th, "tau_away": ta, "k_form": kf},
        "fitted_at": now_iso(),
        "trained_on": len(train),
    }


# ─────────────────────────────────────────────────────────── предсказание ────
def llm_call(params: dict, r) -> tuple[str, float, float]:
    # ⚠️ ПОРЯДОК И СОСТАВ СТОЛБЦОВ ОБЯЗАН СОВПАДАТЬ С `design()` ДО ЗАПЯТОЙ.
    # Там вектор — это единица, признаки в порядке `LIN_FEATURES` и последним
    # `expected_diff`. Разойдись они, и коэффициент атаки лёг бы на оборону: ни
    # одна проверка типов такого не увидит, а прогноз станет шумом.
    W = np.asarray(params["W"], dtype=float)
    x = [1.0] + [float(r[f] or 0.0) for f in params["features"]]
    x.append(expected_diff(r))
    s = np.asarray(x, dtype=float) @ W
    order = np.argsort(s)[::-1]
    margin = float(s[order[0]] - s[order[1]])
    exp_total = float((r["h_gf"] or 0) + (r["a_ga"] or 0) + (r["a_gf"] or 0) + (r["h_ga"] or 0)) / 2.0
    return OUTCOMES[int(order[0])], _conf(margin, 0.25), exp_total


def own_call_conf(params: dict, r) -> tuple[str, float, float]:
    th, ta, kf = params["tau_home"], params["tau_away"], params["k_form"]
    pick = own_call(r, th, ta, kf)
    s = venue_diff(r) + kf * venue_form(r)
    drawish = (float(r["h_dr"] or 0) + float(r["a_dr"] or 0)) / 2.0
    edge = abs(s) - (th if s > 0 else ta) * (1.0 + drawish)
    exp_total = float((r["h_home_gf"] or 0) + (r["a_away_ga"] or 0)
                      + (r["a_away_gf"] or 0) + (r["h_home_ga"] or 0)) / 2.0
    return pick, _conf(abs(edge), 0.6), exp_total


def fly_call(fly: FlyBrain, r) -> tuple[str, float, float]:
    sc = fly.scores(row_to_odour(r))
    order = sorted(OUTCOMES, key=lambda o: sc[o])
    margin = sc[order[1]] - sc[order[0]]
    exp_total = float((r["h_gf"] or 0) + (r["a_ga"] or 0)
                      + (r["a_gf"] or 0) + (r["h_ga"] or 0)) / 2.0
    return order[0], _conf(margin, 0.05), exp_total


def _conf(margin: float, full: float) -> float:
    """Отрыв первого от второго, сжатый в 0..1.

    ⚠️ ЭТО НЕ ВЕРОЯТНОСТЬ, И НАЗЫВАТЬ ЕЁ ТАК НЕЛЬЗЯ. Ни одна из трёх моделей не
    откалибрована: «0.8» здесь значит «первый вариант заметно оторвался от
    второго», а не «сбудется в 80 % случаев». Показывать её человеку как
    вероятность значило бы врать цифрой.
    """
    return round(float(min(1.0, max(0.0, margin / full))), 4)


# ──────────────────────────────────────────────────────── память мухи ────────
def fly_load(url: str, key: str) -> FlyBrain:
    fly = FlyBrain.load()
    rows = _fetch(url, key, "fly_state?select=*&id=eq.mb")
    if rows:
        w = np.asarray(rows[0]["weights"], dtype=float)
        idx = fly.nonzero_index()
        if w.size == idx[0].size:
            fly.kc_mbon[idx] = w
            fly.taught = int(rows[0].get("taught") or 0)
            fly.depression = float(rows[0].get("depression") or fly.depression)
        else:
            print(f"⚠ память мухи не подошла по размеру ({w.size} против "
                  f"{idx[0].size}) — начинаем с коннектома")
    return fly


def fly_save(url: str, key: str, fly: FlyBrain, dopamine: int) -> None:
    idx = fly.nonzero_index()
    _write(url, key, "fly_state?on_conflict=id", [{
        "id": "mb",
        "weights": [round(float(v), 6) for v in fly.kc_mbon[idx]],
        "taught": fly.taught,
        "dopamine": dopamine,
        "depression": fly.depression,
        "updated_at": now_iso(),
    }], method="POST")


# ────────────────────────────────────────────────────────────── шаги ─────────
def step_train(url: str, key: str) -> dict:
    rows = _fetch(url, key, "duel_features?select=*&order=match_date.asc")
    params = fit_all(rows)
    _write(url, key, "forecast_model?on_conflict=id", [{
        "id": "current", "params": params, "fitted_at": params["fitted_at"],
    }], method="POST")
    print(f"обучено на {params['trained_on']} матчах, "
          f"lambda={params['llm']['lambda']}, own={params['own']}")
    return params


def load_params(url: str, key: str) -> dict:
    rows = _fetch(url, key, "forecast_model?select=params&id=eq.current")
    if not rows:
        raise SystemExit("нет подогнанной модели — сначала `train`")
    return rows[0]["params"]


def step_pick(url: str, key: str, limit: int = 400) -> int:
    params = load_params(url, key)
    fly = fly_load(url, key)
    rows = _fetch(url, key,
                  "forecast_inputs?select=*&commence_at=gt." + now_iso()
                  + "&order=commence_at.asc")
    have = {(p["fixture_id"], p["model"])
            for p in _fetch(url, key, "forecast_pick?select=fixture_id,model")}
    body = []
    for r in rows[:limit]:
        for model, call in (("llm", lambda x: llm_call(params["llm"], x)),
                            ("own", lambda x: own_call_conf(params["own"], x)),
                            ("fly", lambda x: fly_call(fly, x))):
            if (r["fixture_id"], model) in have:
                continue
            pick, conf, total = call(r)
            body.append({
                "fixture_id": r["fixture_id"], "model": model, "pick": pick,
                "confidence": conf, "exp_total": round(total, 2),
                "commence_at": r["commence_at"],
                "home_team": r["home_team"], "away_team": r["away_team"],
            })
    if body:
        _write(url, key, "forecast_pick?on_conflict=fixture_id,model", body, method="POST")
    print(f"названо {len(body)} прогнозов на {len(rows)} матчей")
    return len(body)


def step_grade(url: str, key: str) -> int:
    open_picks = _fetch(url, key,
                        "forecast_pick?select=fixture_id,model,pick&correct=is.null")
    if not open_picks:
        print("нечего сверять")
        return 0
    ids = sorted({p["fixture_id"] for p in open_picks})
    done: dict[str, dict] = {}
    for i in range(0, len(ids), 100):
        chunk = ",".join(ids[i:i + 100])
        for f in _fetch(url, key,
                        f"fixtures?select=id,home_score,away_score,completed"
                        f"&id=in.({chunk})&completed=is.true"):
            if f["home_score"] is not None and f["away_score"] is not None:
                done[f["id"]] = f
    body = []
    for p in open_picks:
        f = done.get(p["fixture_id"])
        if not f:
            continue
        hs, as_ = int(f["home_score"]), int(f["away_score"])
        actual = "H" if hs > as_ else "A" if hs < as_ else "D"
        body.append({
            "fixture_id": p["fixture_id"], "model": p["model"],
            "actual": actual, "actual_total": hs + as_,
            "correct": p["pick"] == actual, "graded_at": now_iso(),
        })
    if body:
        _write(url, key, "forecast_pick?on_conflict=fixture_id,model", body,
               method="POST")
    print(f"сверено {len(body)} прогнозов")
    return len(body)


def step_dopamine(url: str, key: str) -> int:
    """Отдать мухе сыгранные матчи: подкрепление на КАЖДЫЙ исход.

    ⚠️ ПО ОДНОМУ МАТЧУ РОВНО ОДИН РАЗ. Строка мухи помечается `dopamine_at`, и
    второй проход её не возьмёт: иначе один и тот же матч подкреплялся бы каждую
    ночь, и мозг съезжал бы в пол на нескольких старых играх.
    """
    hungry = _fetch(url, key,
                    "forecast_pick?select=fixture_id,actual,commence_at"
                    "&model=eq.fly&dopamine_at=is.null&actual=not.is.null"
                    "&order=commence_at.asc")
    if not hungry:
        print("дофамин не нужен: новых сыгранных матчей нет")
        return 0
    inputs = {r["fixture_id"]: r for r in _fetch(url, key, "forecast_inputs?select=*")}
    fly = fly_load(url, key)
    fed = []
    for p in hungry:
        r = inputs.get(p["fixture_id"])
        if not r:
            continue
        fly.learn(row_to_odour(r), actual=p["actual"])
        fed.append({"fixture_id": p["fixture_id"], "model": "fly",
                    "dopamine_at": now_iso()})
    if fed:
        _write(url, key, "forecast_pick?on_conflict=fixture_id,model", fed,
               method="POST")
        prev = _fetch(url, key, "fly_state?select=dopamine&id=eq.mb")
        total = int(prev[0]["dopamine"]) if prev else 0
        fly_save(url, key, fly, total + len(fed))
    print(f"дофамин: {len(fed)} матчей, всего обучено {fly.taught}, "
          f"ослаблено {fly.learned_fraction() * 100:.2f} % веса")
    return len(fed)


def step_backfill(url: str, key: str) -> int:
    """Заполнить историю задним числом — ТОЛЬКО по тестовой части.

    ⚠️ ЗАДНИМ ЧИСЛОМ, И СТРОКА ОБ ЭТОМ ГОВОРИТ (`backfilled`). Историю можно
    было бы ждать неделями, пока сыграются матчи; вместо этого модели прогоняются
    по уже сыгранным. Но назвать это «прогнозом, сделанным до матча» было бы
    неправдой, поэтому у каждой такой строки стоит признак.

    ⚠️ БЕРЁТСЯ ТОЛЬКО ПОСЛЕДНЯЯ ПЯТАЯ ЧАСТЬ, И ЭТО ГЛАВНОЕ ОГРАНИЧЕНИЕ. На
    обучающей и проверочной частях подбирались лямбда, пороги и протокол мухи —
    прогон по ним показал бы не точность, а память о подгонке. Тестовая часть в
    выборе не участвовала ни разу.

    Признаки и там, и там считаются окном, кончающимся ЗА СУТКИ до матча, так
    что данных из будущего в них нет.
    """
    params = load_params(url, key)
    rows = _fetch(url, key, "duel_features?select=*&order=match_date.asc")
    rows = [r for r in rows if r.get("outcome")]
    rows.sort(key=lambda r: (r["match_date"], r["home_key"], r["away_key"]))
    _tr, _va, te = split_by_time(len(rows))
    test = rows[te]

    # Мозг мухи — с нуля, из коннектома, и учится ТОЛЬКО на обучающей части:
    # ровно так же, как в замере. Иначе история покажет мозг, уже видевший
    # тестовые матчи.
    fly = FlyBrain.load()
    fly.depression = 0.02
    for r in rows[_tr]:
        fly.learn(row_to_odour(r), actual=r["outcome"])

    have = {(p["fixture_id"], p["model"])
            for p in _fetch(url, key, "forecast_pick?select=fixture_id,model")}
    body, fed = [], 0
    for r in test:
        fid = f"bf:{r['match_date']}:{r['home_key']}:{r['away_key']}"
        stamp = f"{r['match_date']}T12:00:00Z"
        actual = r["outcome"]
        calls = {
            "llm": llm_call(params["llm"], r),
            "own": own_call_conf(params["own"], r),
            "fly": fly_call(fly, r),
        }
        for model, (pick, conf, total) in calls.items():
            if (fid, model) in have:
                continue
            body.append({
                "fixture_id": fid, "model": model, "pick": pick,
                "confidence": conf, "exp_total": round(total, 2),
                "commence_at": stamp, "home_team": r["home_key"],
                "away_team": r["away_key"], "backfilled": True,
                "actual": actual, "actual_total": float(r["total"]),
                "correct": pick == actual, "graded_at": now_iso(),
                "dopamine_at": now_iso() if model == "fly" else None,
            })
        # ⚠️ ДОФАМИН ИДЁТ ПО ХОДУ, А НЕ ПОСЛЕ ВСЕГО. Муха учится на матче ПОСЛЕ
        # того, как назвала его: иначе она отвечала бы, уже зная ответ.
        fly.learn(row_to_odour(r), actual=actual)
        fed += 1

    for i in range(0, len(body), 500):
        _write(url, key, "forecast_pick?on_conflict=fixture_id,model",
               body[i:i + 500], method="POST")
    if fed:
        fly_save(url, key, fly, fed)
    print(f"история задним числом: {len(body)} строк на {len(test)} матчей, "
          f"дофамин {fed}, ослаблено {fly.learned_fraction() * 100:.2f} %")
    return len(body)


def main() -> int:
    url, key = env()
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    if step == "backfill":
        step_backfill(url, key)
        return 0
    if step in ("train", "all"):
        step_train(url, key)
    if step in ("grade", "all"):
        step_grade(url, key)
    if step in ("dopamine", "all"):
        step_dopamine(url, key)
    if step in ("pick", "all"):
        step_pick(url, key)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
