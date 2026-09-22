"""Срок ночного обогащения: шаг, на который времени нет, НЕ ЗАПУСКАЕТСЯ.

⚠️ ЭТОТ ТЕСТ СТЕРЕЖЁТ ДЕСЯТЬ ПОТЕРЯННЫХ НОЧЕЙ, А НЕ ФУНКЦИЮ.

Прогоны daily-enrich с 12 по 21 сентября 2026 все до одного помечены
«cancelled». Разбор: шаг «Run daily enrichment» шёл 5 ч 22 мин, job упирался в
свои 330 минут, runner получал SIGTERM (exit 143) — и ДВАДЦАТЬ ОДИН шаг ниже
по цепочке не выполнялся вообще: эмблемы, стоимости, трансферы, мост на
Transfermarkt, составы, связывание составов с колодой, новые карточки,
Soccer Wiki, ревизия колоды.

Увидеть это было неоткуда: «cancelled» читается как «кто-то отменил вручную»,
а сам оркестратор печатал «ok» по всем своим шагам и выходил с нулём. Он и
правда отработал — просто забрал всё время.

Поэтому проверяется не «функция возвращает список», а три вещи, каждая из
которых и была поломкой:

  1. за сроком шаги НЕ ЗАПУСКАЮТСЯ (а не обрываются на полуслове);
  2. непущенный шаг отличим от упавшего и от успешного;
  3. без срока поведение прежнее — иначе починка сама стала бы ограничением.

    python3 football_scraper/tests/test_daily_enrich_deadline.py
"""
import os
import sys

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "docs"))

from daily_enrich import run_steps  # noqa: E402

FAILED = []


def check(name, cond):
    print(("  ✓ " if cond else "  ✗ ") + name)
    if not cond:
        FAILED.append(name)


def peek_now(clock):
    """Часы для проверки остатка: время двигает сам раннер."""
    return lambda: clock["t"]


def steps(n):
    return [("%d/%d шаг" % (i + 1, n), ["echo", str(i)], {}) for i in range(n)]


def main():
    print("Срок ночного обогащения")

    # ── 1. Часы идут: первый шаг успевает, остальные нет ────────────────────
    clock = {"t": 0.0}

    def now():
        return clock["t"]

    def runner(_argv, _env, _limit=None):
        clock["t"] += 60.0 * 40      # каждый шаг «идёт» сорок минут
        return 0

    got = run_steps(steps(4), deadline_at=60.0 * 60, runner=runner, now=now)
    check("шагов в отчёте столько же, сколько на входе", len(got) == 4)
    check("первый шаг запущен", got[0][1] == 0)
    check("второй шаг запущен — срок ещё не вышел", got[1][1] == 0)
    check("третий НЕ запущен: времени не осталось", got[2][1] is None)
    check("четвёртый тоже не запущен", got[3][1] is None)
    check("у непущенных время ноль, а не выдуманное", got[2][2] == 0.0 and got[3][2] == 0.0)

    # ── 2. Непущенный отличим от упавшего ──────────────────────────────────
    def failing(_argv, _env, _limit=None):
        return 1

    got = run_steps(steps(2), deadline_at=None, runner=failing, now=now)
    check("упавший шаг помечен кодом возврата, а не None",
          got[0][1] == 1 and got[1][1] == 1)
    check("падение НЕ останавливает цепочку (бюджетная стена — не смерть)",
          len(got) == 2)

    # ── 3. Без срока — прежнее поведение ───────────────────────────────────
    ran = []

    def counting(argv, _env, _limit=None):
        ran.append(argv)
        clock["t"] += 60.0 * 600      # десять часов на шаг
        return 0

    got = run_steps(steps(3), deadline_at=None, runner=counting, now=now)
    check("без срока запускаются все шаги, сколько бы ни шли", len(ran) == 3)
    check("и ни один не помечен пропущенным",
          all(rc is not None for _, rc, _ in got))

    # ── 4. Отрицательный контроль: срок в прошлом — не идёт НИ ОДИН ─────────
    ran.clear()
    got = run_steps(steps(3), deadline_at=now() - 1, runner=counting, now=now)
    check("срок уже прошёл — не запущено ничего", not ran)
    check("и все три помечены пропущенными",
          all(rc is None for _, rc, _ in got))

    # ── 5. ЖЁСТКИЙ СРОК ШАГА: убит — это не «упал» и не «не запускали» ──────
    #
    # ⚠️ ЭТО ВТОРАЯ ПОЛОВИНА ТОЙ ЖЕ ПОЛОМКИ. Проверка срока ПЕРЕД шагом не
    # может прервать уже идущий: 22.09.2026 первый шаг шёл 3 ч 36 мин при
    # `--minutes 80`, и хвост снова не выполнился. По данным это видно так:
    # club_crest не обновлялся 20 суток, club_roster 15, soccerwiki_player и
    # player_transfer по 14 — при том, что ни один прогон не был красным.
    clock["t"] = 0.0
    seen_limits = []

    def slow(_argv, _env, limit=None):
        seen_limits.append(limit)
        clock["t"] += 60.0 * 90       # шаг «идёт» полтора часа
        return "timeout" if limit is not None and 60.0 * 90 > limit else 0

    got = run_steps(steps(2), deadline_at=None, runner=slow, now=now,
                    step_seconds=60.0 * 25)
    check("свой срок доехал до раннера, а не остался в расчётах",
          seen_limits and seen_limits[0] == 60.0 * 25)
    check("затянувшийся шаг ПОМЕЧЕН УБИТЫМ, а не успешным",
          got[0][1] == "timeout")
    check("убитый отличим от упавшего (1) и от непущенного (None)",
          got[0][1] != 1 and got[0][1] is not None)
    check("падение по сроку НЕ останавливает цепочку",
          len(got) == 2 and got[1][1] == "timeout")

    # ── 6. Срок шага ограничен остатком общего ─────────────────────────────
    #
    # ⚠️ БЕЗ ЭТОГО «СВОЙ СРОК» У ПОСЛЕДНЕГО ШАГА ОЗНАЧАЛ БЫ «СКОЛЬКО УГОДНО»:
    # бюджет ночи кончается, а шаг всё идёт, потому что его собственные 25
    # минут ещё не вышли.
    clock["t"] = 0.0
    seen_limits.clear()

    def peek(_argv, _env, limit=None):
        seen_limits.append(limit)
        clock["t"] += 60.0 * 10
        return 0

    run_steps(steps(3), deadline_at=60.0 * 25, runner=peek, now=peek_now(clock),
              step_seconds=60.0 * 25)
    check("первому отдан его собственный срок (остаток больше)",
          seen_limits[0] == 60.0 * 25)
    check("последнему отдан ОСТАТОК, а не его собственный срок",
          len(seen_limits) >= 2 and seen_limits[1] == 60.0 * 15)

    # ── 7. Отрицательный контроль: без срока раннер получает None ───────────
    # Иначе проверки выше зеленели бы и на функции, которая всегда шлёт
    # какое-нибудь число.
    seen_limits.clear()
    run_steps(steps(1), deadline_at=None, runner=peek, now=now, step_seconds=None)
    check("без сроков предел не выдумывается", seen_limits == [None])

    print()
    if FAILED:
        print("ПРОВАЛ: %d" % len(FAILED))
        for f in FAILED:
            print("  -", f)
        return 1
    print("OK — срок соблюдается, пропуск отличим от падения")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
