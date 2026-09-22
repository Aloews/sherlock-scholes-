"""Daily deck-enrichment ORCHESTRATOR.

Runs the enrichment steps in dependency order, each as its own subprocess so
one step hitting the daily Wikimedia budget (photos_budget.json /
pageviews_budget.json = 5000) NEVER aborts the chain — the runner logs it and
moves on. Every underlying script is cache-first and idempotent, so re-running
the orchestrator simply RESUMES where the budget ran out (the on-disk cache +
budget files, carried between CI runs, are the checkpoint).

ORDER (why):
  1. newcomers      bare cards (facts IS NULL) need RESOLVE first to warm the
                    caches the later DB-only scripts read; also fills facts/tier/
                    wc2026 for just those cards.            (cards_enrich_newcomers --apply)
  2. career_stats   full Wikipedia career (clubs+apps+goals) for legends and any
                    clubs_minutes-tail player missing it — fixes cards showing 1
                    club instead of the real set. Runs AFTER newcomers so
                    facts.birth_year (its namesake check) is warm. (career_build APPLY=1)
  3. photos         cards without photo_url -> ruwiki/Wikidata image.  (run.py --cards-photos)
  4. translations   untranslated card names -> card_translations.      (run.py --cards-translations)
  5. legend/career  FREE cache-only reprocess of legend_career+titles. (reprocess, APPLY=1)
  6. tier           recompute tier LAST so new stars/facts/titles count. (tier_build, APPLY=1)
  7. fame           recompute cards.fame LAST of all — it is a PERCENTILE, so
                    every step above (new cards, pageviews, active flips) shifts
                    the scale. Also re-derives tier + the Pro 'legend' tag from
                    the refreshed fame, which is why it runs after step 6, not
                    before it.                        (cards_fame_refresh.py)

Budget: steps 1-4 spend the shared Wikimedia budget; 5-7 spend ZERO (pure DB).
Putting the free steps last means a budget wall in steps 1-4 still lets tier +
legend reprocess + fame refresh run to completion every day.

Note: the daily workflow (.github/workflows/daily-enrich.yml) also runs
cards_pageviews_i18n.py AFTER this orchestrator, which changes the very metric
fame is computed from — so the workflow re-runs cards_fame_refresh.py again
after that step. Running it here too keeps a standalone `python
docs/daily_enrich.py` correct on its own.

⚠️ СРОК (--minutes) — ЭТО ПОЧИНКА ЖИВОЙ ПОЛОМКИ, А НЕ ПРЕДОСТОРОЖНОСТЬ.
Оркестратор не имел потолка по времени вовсе и съедал ночь целиком: замер по
прогонам 12–21.09.2026 — шаг «Run daily enrichment» шёл 5 ч 22 мин, после чего
job упирался в свои 330 минут, runner получал SIGTERM (exit 143), и ДВАДЦАТЬ
ОДИН шаг ниже по цепочке не выполнялся ВООБЩЕ: эмблемы, стоимости, трансферы,
мост на Transfermarkt, составы, связывание составов с колодой, новые карточки,
Soccer Wiki и ревизия колоды. Десять ночей подряд.

⚠️ И УВИДЕТЬ ЭТО БЫЛО НЕОТКУДА. Прогон в списке Actions помечался не
«failure», а «cancelled» — то есть читался как «кто-то отменил вручную».
Сам оркестратор при этом честно печатал «ok» по каждому своему шагу и выходил
с нулём: он и правда отработал, просто забрал всё время.

Отсюда срок: `--minutes N` (или `ENRICH_MINUTES`). Проверяется ПЕРЕД каждым
шагом — шаг, на который времени уже не осталось, не запускается и помечается
`skip (время)`. Это честнее обрыва посередине: скрипты возобновляемые, и
недоделанное догонится завтра, а вот убитый на полуслове шаг оставляет мусор.

Run from anywhere:  python docs/daily_enrich.py [--minutes 110]
CI:                  see .github/workflows/daily-enrich.yml
Requires SUPABASE_URL + SUPABASE_KEY (service_role) in the env (or .env).
"""
import argparse
import os
import sys
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRAPER = os.path.join(ROOT, "football_scraper")
PY = sys.executable or "python"


def _env(**extra):
    e = dict(os.environ)
    e.update(extra)
    return e


# (label, argv, env) — all run with cwd=SCRAPER (run.py modes need it; the
# docs/ scripts compute their own paths, so cwd is harmless for them).
# ⚠️ НОМЕРА ШАГОВ СЧИТАЮТСЯ, А НЕ ВПИСЫВАЮТСЯ. Раньше метки были вписаны
# вручную («1/7», «2/7», …), и добавление шага означало переписать их все —
# то есть однажды не переписать. Это та же ловушка, что стоила проекту «семи
# Edge-функций» при девяти и «остальных семи тестов» при полутора десятках:
# число устаревает молча, а по нему потом читают отчёт.
_STEPS = [
    ("newcomers (resolve + facts/tier/wc2026)",
     [PY, os.path.join(HERE, "cards_enrich_newcomers.py"), "--apply"], _env()),
    ("career_stats (legends + clubs_minutes-tail players)",
     [PY, os.path.join(HERE, "cards_career_build.py")], _env(APPLY="1")),
    ("photos (cards without photo_url)",
     [PY, "run.py", "--cards-photos"], _env()),
    # ⚠️ СРАЗУ ЗА ФОТО, И ЭТО НЕ УКРАШЕНИЕ ОТЧЁТА. Снимки с Викисклада
    # разрешено показывать ровно пока названы автор и лицензия; шаг выше
    # добавляет снимки, этот добавляет к ним подписи. Разведи их по разным
    # ночам — и сутки в приложении висят чужие фотографии без подписи.
    ("photo credits (условие лицензии CC BY: автор и лицензия у снимка)",
     [PY, os.path.join(HERE, "cards_photo_credits.py"), "--minutes", "12"],
     _env(APPLY="1")),
    ("translations (card_translations)",
     [PY, "run.py", "--cards-translations"], _env()),
    ("legend/career reprocess (free, cache-only)",
     [PY, os.path.join(HERE, "cards_legend_career_reprocess.py")], _env(APPLY="1")),
    ("tier recompute (after new stars/facts)",
     [PY, os.path.join(HERE, "cards_tier_build.py")], _env(APPLY="1")),
    ("fame recompute (percentile drifts on every import)",
     [PY, os.path.join(HERE, "cards_fame_refresh.py")], _env()),
]

STEPS = [("%d/%d %s" % (i + 1, len(_STEPS), label), argv, env)
         for i, (label, argv, env) in enumerate(_STEPS)]


#: Шаг убит по собственному сроку. Это НЕ код возврата и НЕ «не запускали»:
#: третий исход, и в сводке он обязан читаться отдельно от обоих.
TIMED_OUT = "timeout"


def _default_runner(argv, env, seconds=None):
    """Запуск шага с ЖЁСТКИМ сроком. Вернёт код возврата или TIMED_OUT."""
    try:
        return subprocess.run(argv, cwd=SCRAPER, env=env, timeout=seconds).returncode
    except subprocess.TimeoutExpired:
        return TIMED_OUT


def run_steps(steps, deadline_at=None, runner=None, now=time.monotonic,
              step_seconds=None):
    """Прогнать шаги, не выходя за срок. Возвращает [(label, rc, seconds)].

    ⚠️ ПЕРВАЯ ВЕРСИЯ ПРОВЕРЯЛА СРОК ТОЛЬКО ПЕРЕД ШАГОМ, И ЭТОГО ОКАЗАЛОСЬ
    МАЛО. Довод был такой: убить шаг на полуслове — оставить недописанную
    пачку, а не начать его — просто отложить до завтра. Довод верный, вывод
    из него был неверный: проверка ПЕРЕД шагом не может прервать уже идущий,
    то есть «80 минут» означало «не начинать новое после 80», а не потолок.

    Замер 22.09.2026, прогон 111: первый шаг шёл 3 ч 36 мин при `--minutes 80`
    и снова забрал ночь. И это видно по данным, а не по логу: свежесть
    таблиц, которые наполняет хвост конвейера, на тот момент была

        club_crest              02.09   — 20 суток
        cards.market_value_at   06.09   — 16 суток
        club_roster             07.09   — 15 суток
        soccerwiki_player       08.09   — 14 суток
        player_transfer         08.09   — 14 суток

    то есть вторая половина обхода не отрабатывала ДВЕ НЕДЕЛИ, а прогоны при
    этом не были красными ни разу.

    Поэтому у шага теперь есть СВОЙ жёсткий срок, и он же ограничен остатком
    общего: шаг не может пережить бюджет. Убитый шаг теряет текущую пачку —
    все скрипты здесь дописывают по ходу и возобновляемы по кешу, так что
    цена измерима и мала, а цена прежнего поведения — ночь целиком.

    Три исхода, и они РАЗНЫЕ:
      `rc = 0`          отработал;
      `rc = число ≠ 0`  упал сам;
      `rc = TIMED_OUT`  убит по сроку — работа была, времени не хватило;
      `rc = None`       не запускался вовсе, времени не осталось уже до него.
    """
    # ⚠️ СРОК ПЕРЕДАЁТСЯ РАННЕРУ ВСЕГДА, И ЭТО РАДИ ПРОВЕРЯЕМОСТИ. Первая
    # версия отдавала его только настоящему subprocess'у, а подставному в
    # тестах — нет: то есть сам расчёт срока («меньшее из своего и остатка»)
    # не был виден ни одной проверке. Считать срок и не дать его увидеть —
    # то же самое, что не считать.
    run = runner if runner is not None else _default_runner
    results = []
    for label, argv, env in steps:
        left = None if deadline_at is None else deadline_at - now()
        if left is not None and left <= 0:
            print("\n>>> STEP %s — ПРОПУЩЕН: время вышло" % label, flush=True)
            results.append((label, None, 0.0))
            continue
        # ⚠️ СРОК ШАГА — МЕНЬШЕЕ ИЗ ДВУХ. Свой потолок держит один затянувшийся
        # шаг, остаток общего не даёт ему пережить бюджет. Без второго «свой
        # срок» у последнего шага снова означал бы «сколько угодно».
        limit = step_seconds
        if left is not None:
            limit = left if limit is None else min(limit, left)
        print("\n" + "-" * 70, flush=True)
        print(">>> STEP %s" % label, flush=True)
        print("    $ %s" % " ".join(argv), flush=True)
        print("-" * 70, flush=True)
        started = now()
        try:
            rc = run(argv, env, limit)
        except Exception as exc:  # never let a launch failure kill the chain
            print("!!! STEP FAILED TO LAUNCH: %r" % exc, flush=True)
            rc = -1
        spent = now() - started
        # A non-zero exit is logged but NOT fatal — a budget wall or a transient
        # network blip in one step must not stop the free downstream steps.
        results.append((label, rc, spent))
        if rc == TIMED_OUT:
            print("<<< STEP %s -> УБИТ ПО СРОКУ через %.1f мин  (continuing)"
                  % (label, spent / 60.0), flush=True)
        else:
            print("<<< STEP %s -> exit %s за %.1f мин%s"
                  % (label, rc, spent / 60.0, "" if rc == 0 else "  (continuing)"),
                  flush=True)
    return results


def main(argv=None):
    ap = argparse.ArgumentParser()
    # ⚠️ СРОК ПО УМОЛЧАНИЮ НЕ БЕСКОНЕЧЕН. Именно бесконечный съел ночь десять
    # раз подряд (разбор в шапке файла). 110 минут оставляют время двадцати
    # одному шагу ниже по цепочке при потолке job'а в 350 минут.
    ap.add_argument("--minutes", type=float,
                    default=float(os.environ.get("ENRICH_MINUTES", "110")),
                    help="сколько минут отвести на все шаги; 0 — без ограничения")
    # ⚠️ БЕЗ ЭТОГО ОБЩИЙ СРОК НЕ ЯВЛЯЕТСЯ ПОТОЛКОМ. Один шаг, идущий дольше
    # всего бюджета, делает бюджет декорацией — так и было 22.09.2026, когда
    # первый шаг шёл 3 ч 36 мин при `--minutes 80`. Двадцать пять минут — это
    # меньше трети бюджета, то есть ни один шаг не может съесть больше трети
    # ночи, а недоделанное догоняется завтра по кешу.
    ap.add_argument("--step-minutes", type=float,
                    default=float(os.environ.get("ENRICH_STEP_MINUTES", "25")),
                    help="жёсткий срок ОДНОГО шага; 0 — без ограничения")
    args = ap.parse_args(argv)

    print("=" * 70, flush=True)
    print("DAILY ENRICH — %d steps, continue-on-error, resumable" % len(STEPS), flush=True)
    print("срок: %s" % ("без ограничения" if args.minutes <= 0
                        else "%.0f мин" % args.minutes), flush=True)
    print("срок одного шага: %s" % ("без ограничения" if args.step_minutes <= 0
                                    else "%.0f мин" % args.step_minutes), flush=True)
    print("=" * 70, flush=True)

    deadline = None if args.minutes <= 0 else time.monotonic() + args.minutes * 60.0
    step_seconds = None if args.step_minutes <= 0 else args.step_minutes * 60.0
    results = run_steps(STEPS, deadline_at=deadline, step_seconds=step_seconds)

    print("\n" + "=" * 70, flush=True)
    print("DAILY ENRICH SUMMARY", flush=True)
    for label, rc, spent in results:
        if rc is None:
            mark, tail = "skip", "не запускался (время)"
        elif rc == TIMED_OUT:
            mark, tail = "kill", "УБИТ ПО СРОКУ через %.1f мин" % (spent / 60.0)
        else:
            mark = "ok  " if rc == 0 else "warn"
            tail = "%.1f мин" % (spent / 60.0)
        print("  [%s] %-55s %s" % (mark, label, tail), flush=True)
    skipped = sum(1 for _, rc, _ in results if rc is None)
    killed = sum(1 for _, rc, _ in results if rc == TIMED_OUT)
    if killed:
        print("  ⚠️ шагов убито по сроку: %d — догонятся завтра, кеш их помнит"
              % killed, flush=True)
    if skipped:
        print("  ⚠️ шагов пропущено по времени: %d — догонятся завтра, кеш их помнит"
              % skipped, flush=True)
    # ⚠️ ПОЛОВИНА ПРОПУЩЕННЫХ — ЭТО УЖЕ НЕ «ДОГОНИТСЯ ЗАВТРА». Именно так
    # выглядели десять потерянных ночей: каждая по отдельности «просто не
    # успела», а вместе они дали две недели без второй половины конвейера.
    # Строка печатается громко; заваливает прогон не она, а сторож ниже по
    # workflow — у него есть данные, а не только счётчик.
    if (skipped + killed) * 2 > len(results):
        print("  ⛔ НЕ ОТРАБОТАЛА БОЛЬШЕ ПОЛОВИНЫ ОБХОДА (%d из %d) — это не "
              "«не успели», это поломка расписания" % (skipped + killed, len(results)),
              flush=True)
    print("=" * 70, flush=True)
    # The orchestrator itself always exits 0: per-step failures are expected
    # (budget walls) and reported. Health is judged by cards_audit.py, the
    # workflow's final gating step.


if __name__ == "__main__":
    main()
