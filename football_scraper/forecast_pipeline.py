#!/usr/bin/env python3
"""Ночной круг трёх прогнозистов: назвать — сверить — получить дофамин.

⚠️ ПЯТЬ ШАГОВ, И ПОРЯДОК ВАЖЕН.

    train      подогнать линейную модель и пороги «своего варианта»,
               поднять память мухи из базы
    pick       назвать исход КАЖДОГО предстоящего матча всеми тремя —
               и записать это ДО матча
    grade      сверить записанное с тем, чем матч кончился
    calibrate  привести уверенность к правде: подогнать sigmoid(a·logit(p)+b)
               по размеченному и записать вместе с Brier на отложенной части
    dopamine   отдать исход мухе: PAM в компартменты сбывшегося исхода,
               депрессия синапсов KC→MBON у горевших клеток; память — обратно
               в базу

⚠️ CALIBRATE ИДЁТ ПОСЛЕ GRADE, И ЭТО НЕ ВКУСОВЩИНА: калибровать можно только
по матчам, у которых известен исход. Он НЕ меняет выбранные исходы — только
число рядом с ними. Зачем это вообще нужно и почему без него нельзя считать
экспрессы — в шапке calibration.py.

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

from calibration import evaluate  # noqa: E402
from fly_brain import FlyBrain, row_to_odour  # noqa: E402
from forecast_duel import _fetch, _write  # noqa: E402
from forecast_winner import (  # noqa: E402
    K_FORM_GRID, LAMBDAS, LIN_FEATURES, OUTCOMES, TAU_GRID,
    accuracy, call_with_bias, design, expected_diff, fit_fly_bias, fit_linear,
    fit_own, labels, own_call, venue_diff, venue_form,
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


def _rpc(url: str, key: str, name: str, body: dict | None = None):
    """Позвать функцию базы и ПРОЧИТАТЬ ОТВЕТ.

    ⚠️ `_write` ДЛЯ ЭТОГО НЕ ГОДИТСЯ, И ЭТО НЕ ПРИДИРКА. Он шлёт
    `Prefer: return=minimal` и возвращает КОД ОТВЕТА, а не тело. Шаг сверки на
    нём печатал «сверено прогнозов: 0» при любом исходе: работа шла, счётчик
    врал. В логе ночного прогона это единственное, по чему видно, жив ли шаг, —
    то есть врущий счётчик хуже отсутствующего.
    """
    import json
    import urllib.request
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/rpc/{name}",
        data=json.dumps(body or {}).encode(),
        method="POST",
        headers={"apikey": key, "Authorization": "Bearer " + key,
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read() or b"null")


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

    # Сдвиг компартментов мухи — на той же проверочной трети. Мозг здесь
    # ОДНОРАЗОВЫЙ и в базу не идёт: он нужен только чтобы измерить, какой сдвиг
    # выправляет перекос. Живая память остаётся в `fly_state` нетронутой.
    probe = FlyBrain.load()
    probe.depression = 0.02
    for r in train:
        probe.learn(row_to_odour(r), actual=r["outcome"])
    fly_bias = fit_fly_bias([probe.scores(row_to_odour(r)) for r in valid], valid)

    return {
        "llm": {"lambda": lam, "W": W.tolist(), "features": list(LIN_FEATURES)},
        "own": {"tau_home": th, "tau_away": ta, "k_form": kf},
        "fly": {"bias": fly_bias},
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


def fly_call(fly: FlyBrain, r, bias: dict | None = None) -> tuple[str, float, float]:
    """Исход по мухе, со сдвигом компартментов.

    ⚠️ СДВИГ ОБЯЗАН ДОЕХАТЬ ДО БОЯ, ИНАЧЕ ЗАМЕР ВРЁТ. Без него муха на тесте
    даёт 0.4608, с ним 0.4707 — и она перестаёт называть ничью там, где ничья
    почти никогда не сбывалась. Сдвиг подобран на проверочной трети и лежит в
    `forecast_model.params`, а не в памяти мухи: веса KC→MBON он не трогает.
    """
    sc = fly.scores(row_to_odour(r))
    if bias:
        sc = {o: sc[o] - float(bias.get(o, 0.0)) for o in sc}
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


def fly_state_exists(url: str, key: str) -> bool:
    """Есть ли уже сохранённая память. Нужен бэкфиллу, чтобы её не затереть."""
    return bool(_fetch(url, key, "fly_state?select=id&id=eq.mb"))


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
                            ("fly", lambda x: fly_call(fly, x, params.get("fly", {}).get("bias")))):
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
    """Сверить названное с тем, чем матчи кончились.

    ⚠️ ВСЁ ДЕЛАЕТ БАЗА, И ЭТО ПОЧИНКА, А НЕ УКРАШЕНИЕ. Прежний шаг читал
    `fixtures` напрямую и падал с 403: у `service_role` нет SELECT на эту
    таблицу, и сверка не шла вовсе — история прогнозов не заполнялась, дофамин
    мухе не приходил.

        42501 permission denied for table fixtures

    Выдавать грант ради одного шага не стали: приложение и так читает расписание
    только через функции с `security definer`, и сверка стала ещё одной такой.
    Заодно это один запрос вместо сотен.
    """
    res = _rpc(url, key, "grade_forecast_picks")
    row = (res or [{}])[0] if isinstance(res, list) else (res or {})
    graded = int(row.get("graded") or 0)
    print(f"сверено прогнозов: {graded}, матчей: {row.get('matches')}")
    return graded


def step_calibrate(url: str, key: str) -> int:
    """Подогнать калибровку уверенности по каждой модели и записать в базу.

    ⚠️ ИДЁТ ПОСЛЕ `grade` И ТОЛЬКО ПОСЛЕ. Калибруется по размеченному —
    прогнозам, у которых уже известен исход. Запуск до сверки подгонял бы
    вчерашнюю калибровку на позавчерашних данных и называл это свежей.

    ⚠️ ПИШЕТСЯ НЕ ТОЛЬКО ПОДГОНКА, НО И ТРИ BRIER С ОТЛОЖЕННОЙ ЧАСТИ. Без них
    в базе лежало бы слово «откалибровано», по которому нельзя понять, стало
    ли лучше и насколько. Третье число — константа (предсказатель, всегда
    называющий долю попаданий): без него «лучше сырого» ничего не значит,
    потому что быть лучше вранья — не достижение.

    ⚠️ МОДЕЛЬ С МАЛЫМ ЧИСЛОМ РАЗМЕЧЕННОГО ПРОПУСКАЕТСЯ, А НЕ КАЛИБРУЕТСЯ
    КОЕ-КАК. `calibrated_confidence` при отсутствии строки возвращает
    исходное число — то есть отсутствие подгонки честно означает
    «не калибровано», а не тихо подставленную чепуху.
    """
    rows = _fetch(url, key,
                  "forecast_pick?select=model,confidence,correct,commence_at"
                  "&correct=not.is.null&confidence=not.is.null"
                  "&order=commence_at.asc,fixture_id.asc")
    by: dict[str, list] = {}
    for r in rows:
        by.setdefault(r["model"], []).append(
            (float(r["confidence"]), 1.0 if r["correct"] else 0.0))

    body, skipped = [], []
    for model in MODELS:
        pairs = by.get(model, [])
        try:
            m = evaluate(pairs)
        except ValueError as e:
            skipped.append(f"{model}: {e}")
            continue
        body.append({
            "model": model,
            "a": round(m["a"], 6), "b": round(m["b"], 6),
            "trained_on": m["trained_on"], "tested_on": m["tested_on"],
            "brier_raw": round(m["brier_raw"], 4),
            "brier_cal": round(m["brier_cal"], 4),
            "brier_const": round(m["brier_const"], 4),
            "fitted_at": now_iso(),
        })
        better = "лучше" if m["brier_cal"] < m["brier_const"] else "НЕ лучше"
        print(f"  {model}: a={m['a']:.3f} b={m['b']:+.3f}  "
              f"Brier сырой {m['brier_raw']:.4f} → калибр {m['brier_cal']:.4f}, "
              f"константа {m['brier_const']:.4f} — {better} константы")
    if body:
        _write(url, key, "forecast_calibration?on_conflict=model", body, method="POST")
    for s in skipped:
        print(f"  пропущено {s}")
    print(f"калибровка: {len(body)} моделей из {len(MODELS)}, "
          f"размеченного {len(rows)}")
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
        # ⚠️ PATCH, А НЕ UPSERT, И ЭТО ПОЧИНКА 400. `POST ?on_conflict=` — это
        # ВСТАВКА с разрешением конфликта, поэтому PostgREST требует все колонки
        # без умолчания: `pick`, `commence_at`, `home_team`, `away_team`. Здесь
        # их нет и быть не должно — проставляется одна отметка `dopamine_at`.
        # В бэкфилле тот же вызов проходил, потому что строки там полные.
        for r in fed:
            _write(url, key,
                   f"forecast_pick?fixture_id=eq.{r['fixture_id']}&model=eq.fly",
                   {"dopamine_at": r["dopamine_at"]}, method="PATCH")
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
    #
    # ⚠️ ЭТОТ МОЗГ ОДНОРАЗОВЫЙ И В БАЗУ ПОПАДАЕТ ТОЛЬКО ОДИН РАЗ — ПРИ ЗАСЕВЕ.
    # Раньше шаг безусловно сохранял его в конце, и это СТИРАЛО всю ночную
    # память: живая муха накопила 3620 учений и 907 подкреплений, а повторный
    # бэкфилл возвращал её к состоянию «обучена на исторической части и больше
    # ничего не видела». Снаружи поломка невидима — муха продолжает называть
    # исходы, просто забыв всё, чему её учил дофамин.
    seeding = not fly_state_exists(url, key)
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
            "fly": fly_call(fly, r, params.get("fly", {}).get("bias")),
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
    if fed and seeding:
        fly_save(url, key, fly, fed)
    print(f"история задним числом: {len(body)} строк на {len(test)} матчей, "
          f"дофамин {fed}, ослаблено {fly.learned_fraction() * 100:.2f} %"
          + ("" if seeding else ", живая память НЕ тронута"))
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
    if step in ("calibrate", "all"):
        step_calibrate(url, key)
    if step in ("dopamine", "all"):
        step_dopamine(url, key)
    if step in ("pick", "all"):
        step_pick(url, key)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
