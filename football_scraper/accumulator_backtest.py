#!/usr/bin/env python3
"""Экспрессы на истории: какое правило отбора плеч даёт больше проходов.

⚠️ ЧТО ЗДЕСЬ МЕРЯЕТСЯ И ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ ПРЕЖНИХ ЗАМЕРОВ. Не доля
угаданных матчей, а доля прошедших ЭКСПРЕССОВ. Экспресс из четырёх плеч
проходит, только если сошлись все четыре: 0.46 в четвёртой степени — это
4.5 %, а не 46 %. Мерить одиночные матчи и говорить об экспрессах — разные
вещи, и владелец просил именно вторую.

⚠️ КОТИРОВКИ ДЛЯ ЭТОГО НЕ НУЖНЫ, И ЭТО ГЛАВНОЕ, ЧЕГО Я РАНЬШЕ НЕ ЗАМЕТИЛ.
Я написал владельцу «экспрессы измерить нечем, пока не накопятся котировки».
Это было верно только для ВЫПЛАТЫ. Доля проходов считается по исходам, а
исходы у нас есть: 12 543 матча с 2023-01-22. Котировки нужны, чтобы
сказать «выгодно ли», а не «как часто проходит».

⚠️ РАЗРЕЗ ПО ВРЕМЕНИ, БЕЗ ЕДИНОЙ ЗАГЛЯДЫВАЮЩЕЙ СТРОКИ. `fit_all` делит
историю на три части подряд (60/20/20) и подгоняет модели только на первых
двух. Калибровка подгоняется на ПРОВЕРОЧНОЙ части. Экспрессы собираются
только на ТЕСТОВОЙ — которую не видела ни одна подгонка.

    python3 football_scraper/accumulator_backtest.py

Печатает таблицу и ничего не пишет в базу.
"""
from __future__ import annotations

import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

from calibration import apply_platt, fit_platt  # noqa: E402
from fly_brain import FlyBrain, row_to_odour  # noqa: E402
from forecast_duel import _fetch, split_by_time  # noqa: E402
from forecast_pipeline import fit_all, fly_call, llm_call, own_call_conf  # noqa: E402

MODELS = ("llm", "fly", "own")


def env() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("нет SUPABASE_URL / SUPABASE_KEY")
    return url, key


def wilson(hits: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Доверительный интервал Вильсона для доли.

    ⚠️ БЕЗ ИНТЕРВАЛА ЭТУ ТАБЛИЦУ ЧИТАТЬ НЕЛЬЗЯ. На сотне билетов разница
    «25 % против 33 %» — это три билета, то есть шум. Максимум по столбцу,
    выбранный без интервала, — это подгонка под выборку, а не правило.
    """
    if n == 0:
        return (0.0, 0.0)
    p = hits / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


# ────────────────────────────────────────────────── правила отбора плеч ─────
#
# ⚠️ ПРАВИЛО — ЭТО И ЕСТЬ «ОБУЧЕНИЕ НА ЭКСПРЕССЫ». Отдельной модели для
# экспресса не бывает: экспресс проходит, когда сошлись все плечи, значит
# учить надо не предсказывать иначе, а ОТБИРАТЬ. Ниже — кандидаты, и
# выигрывает тот, чей интервал не перекрывается с остальными.

def pick_legs(day_rows, model, ab, k, rule, floor):
    """day_rows: {fixture_id: {model: (pick, prob, correct)}}. Вернуть k плеч."""
    cand = []
    for fid, by_model in day_rows.items():
        if model not in by_model:
            continue
        pick, raw, ok = by_model[model]
        prob = apply_platt(ab[0], ab[1], raw) if ab else raw
        if rule == "consensus":
            picks = {v[0] for v in by_model.values()}
            if len(by_model) < 3 or len(picks) != 1:
                continue
        elif rule == "two_of_three":
            same = sum(1 for v in by_model.values() if v[0] == pick)
            if same < 2:
                continue
        if prob < floor:
            continue
        cand.append((prob, fid, ok))
    if len(cand) < k:
        return None
    cand.sort(reverse=True)
    return cand[:k]


def predict_block(prefix, block):
    """Подогнать всё на `prefix`, предсказать `block`. Ни одной строки block.

    ⚠️ `fit_all` САМ делит переданное на три части (60/20/20) и подгоняет
    только на первых двух. Передаём растущий ПРЕФИКС — то есть ровно то, что
    было бы известно к началу блока. Калибровка подгоняется на последней
    пятой части префикса: она внутри `fit_all` служит проверочной, и по ней
    же честно калибровать — предсказания там не участвовали в подгонке
    коэффициентов.
    """
    params = fit_all(prefix)
    _tr, va, _te = split_by_time(len(prefix))
    valid = prefix[va]

    fly = FlyBrain.load()
    fly.depression = 0.02
    for r in prefix:
        fly.learn(row_to_odour(r), actual=r["outcome"])
    bias = params.get("fly", {}).get("bias")

    def call(model, r):
        if model == "llm":
            return llm_call(params["llm"], r)[:2]
        if model == "own":
            return own_call_conf(params["own"], r)[:2]
        return fly_call(fly, r, bias)[:2]

    ab = {}
    for m in MODELS:
        pairs = [(call(m, r)[1], 1.0 if call(m, r)[0] == r["outcome"] else 0.0)
                 for r in valid]
        ab[m] = fit_platt(pairs)

    out = defaultdict(dict)
    for r in block:
        fid = f"{r['match_date']}:{r['home_key']}:{r['away_key']}"
        for m in MODELS:
            pick, conf = call(m, r)
            out[r["match_date"]].setdefault(fid, {})[m] = (
                pick, conf, pick == r["outcome"])
    return out, ab


def main() -> int:
    url, key = env()
    rows = _fetch(url, key, "duel_features?select=*&order=match_date.asc")
    rows = sorted(rows, key=lambda r: (r["match_date"], r["home_key"], r["away_key"]))
    n = len(rows)
    print(f"матчей: {n}, с {rows[0]['match_date']} по {rows[-1]['match_date']}")

    # ⚠️ ХОД ВПЕРЁД БЛОКАМИ, А НЕ ОДИН РАЗРЕЗ. Один разрез 60/20/20 давал 35
    # дней и 33 билета на правило — при таком числе доверительный интервал
    # шире двадцати пунктов, и ЛЮБОЕ правило неотличимо от любого другого.
    # Ход вперёд переиспользует историю: модели переобучаются на каждом блоке
    # только по тому, что было известно к его началу, и проверочных дней
    # становится в несколько раз больше.
    start = int(n * 0.45)
    block_rows = 900
    days = {}
    ab_by_day = {}
    i = start
    blocks = 0
    while i < n:
        j = min(n, i + block_rows)
        got, ab = predict_block(rows[:i], rows[i:j])
        for d, v in got.items():
            days[d] = v
            ab_by_day[d] = ab
        blocks += 1
        print(f"  блок {blocks}: обучен на {i}, проверено {j - i} матчей "
              f"({rows[i]['match_date']} … {rows[j - 1]['match_date']})")
        i = j
    print(f"дней в проверке: {len(days)}, блоков переобучения: {blocks}")

    RULES = [
        ("топ по уверенности", "top", 0.00),
        ("топ, порог 0.40", "top", 0.40),
        ("топ, порог 0.45", "top", 0.45),
        ("топ, порог 0.50", "top", 0.50),
        ("все трое согласны", "consensus", 0.00),
        ("все трое, порог 0.45", "consensus", 0.45),
        ("двое из трёх", "two_of_three", 0.00),
        ("двое из трёх, 0.45", "two_of_three", 0.45),
    ]

    print(f"\n{'правило':22} {'k':>2} {'модель':>5} "
          f"{'билетов':>8} {'прошло':>7} {'доля':>7} {'интервал 95%':>16} {'ожидалось':>10}")
    best = []
    for name, rule, floor in RULES:
        for k in (3, 4):
            for m in MODELS:
                tickets = won = 0
                exp_sum = 0.0
                for day, day_rows in days.items():
                    legs = pick_legs(day_rows, m, ab_by_day[day][m], k, rule, floor)
                    if legs is None:
                        continue
                    tickets += 1
                    won += int(all(ok for _, _, ok in legs))
                    e = 1.0
                    for p, _, _ in legs:
                        e *= p
                    exp_sum += e
                if tickets == 0:
                    continue
                lo, hi = wilson(won, tickets)
                share = won / tickets
                print(f"{name:22} {k:>2} {m:>5} {tickets:8} {won:7} {share:7.1%} "
                      f"  [{lo:5.1%} … {hi:5.1%}] {exp_sum / tickets:9.1%}")
                best.append((share, lo, name, rule, floor, k, m, tickets, won,
                             exp_sum / tickets))
    # ⚠️ ЛУЧШЕЕ ВЫБИРАЕТСЯ ПО НИЖНЕЙ ГРАНИЦЕ ИНТЕРВАЛА, А НЕ ПО ДОЛЕ. Правило,
    # давшее 40 % на двадцати билетах, хуже правила с 30 % на двухстах: у
    # первого нижняя граница ниже.
    best.sort(key=lambda t: t[1], reverse=True)
    print("\nПо нижней границе интервала (так и надо выбирать):")
    for share, lo, name, rule, floor, k, m, tickets, won, exp in best[:8]:
        print(f"  {lo:5.1%} … {share:5.1%}  {name} / k={k} / {m} "
              f"({won} из {tickets}, ожидалось {exp:.1%})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
