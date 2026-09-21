"""Offline tests for espn_stats.py's own matching logic — NO network.

Run from the football_scraper/ directory:
    python3 -m tests.test_espn_stats
or:
    python3 tests/test_espn_stats.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import date, timedelta  # noqa: E402

from calendar import monthrange  # noqa: E402

from espn_stats import (  # noqa: E402
    LEAGUES,
    active_cards_by_key,
    card_key,
    month_windows,
    within_span,
    write_rows,
)


def check(label, got, want):
    status = "ok " if got == want else "FAIL"
    print("  [{}] {}: got={!r} want={!r}".format(status, label, got, want))
    return got == want


def _card(card_id, name_en):
    return {"id": card_id, "name": "", "name_en": name_en}


def test_active_cards_by_key():
    ok = True

    # The measured case, ESPN's side of it: a retired legend's bare-name card
    # (name_en "Ronaldo"), no current club — excluded, so a currently-active
    # same-named player on some league's roster has nothing to wrongly match
    # against. See docs/namesake_fixes.sql.
    cards = [_card("legend", "Ronaldo")]
    ok &= check("retired namesake excluded", active_cards_by_key(cards, set()), {})

    # An active player with a current club is included as before.
    cards = [_card("active", "Kylian Mbappe")]
    ok &= check(
        "active player included",
        active_cards_by_key(cards, {"active"}),
        {card_key("Kylian Mbappe"): _card("active", "Kylian Mbappe")},
    )

    # Mixed pool: only the one with a current club survives.
    cards = [_card("legend", "Ronaldo"), _card("active", "Kylian Mbappe")]
    got = active_cards_by_key(cards, {"active"})
    ok &= check("mixed pool keeps only the active one", len(got), 1)
    ok &= check("mixed pool keeps the right one", list(got.values())[0]["id"], "active")

    # Two cards sharing a card_key: first one wins, same setdefault behaviour
    # the un-guarded loop in collect() had before.
    cards = [_card("first", "Danilo"), _card("second", "Danilo")]
    got = active_cards_by_key(cards, {"first", "second"})
    ok &= check("duplicate key: first wins", len(got), 1)
    ok &= check("duplicate key: first wins (id)", list(got.values())[0]["id"], "first")

    return ok


def _days_covered(months):
    """Множество всех суток, которые покрывают месячные окна `YYYYMM`."""
    days = set()
    for key in months:
        y, m = int(key[:4]), int(key[4:])
        for d in range(1, monthrange(y, m)[1] + 1):
            days.add(date(y, m, d))
    return days


def test_month_windows():
    """Месяцы обязаны накрыть запрошенные сутки — без единой дыры.

    Дыра здесь не падает и не кричит: пропущенный день выглядит как день без
    матчей, и потеря обнаружилась бы только тем, что у игрока не хватает
    матча в рейтинге. Поэтому проверяется не форма строк, а ПОКРЫТИЕ.

    ⚠️ ЛИШНЕЕ ТЕПЕРЬ РАЗРЕШЕНО, И ЭТО НЕ ПОСЛАБЛЕНИЕ. Календарный месяц по
    определению шире запрошенных суток; отсечь лишнее обязан `within_span`
    при отборе событий, и его проверяет тест ниже. Здесь сторожится ровно то,
    ради чего окно и считается, — что НИ ОДНИ запрошенные сутки не потеряны.
    """
    ok = True
    today = date(2026, 9, 13)

    for days in (1, 2, 29, 30, 31, 60, 90, 91, 365):
        months = month_windows(days, today)
        covered = _days_covered(months)
        want = {today - timedelta(days=i) for i in range(days)}
        # Сравниваются множества, а печатается их РАЗНОСТЬ: вывалить сюда
        # девяносто дат значило бы утопить настоящее падение в стене строк —
        # ровно так, как это уже было с прогоном тестов скрапера.
        ok &= check("{} сут.: не покрыто".format(days), sorted(want - covered), [])
        # Месяцев ровно столько, сколько их задевает отрезок, — ни одного
        # лишнего запроса к ESPN.
        ok &= check(
            "{} сут.: месяцев не больше нужного".format(days),
            len(months), len({(d.year, d.month) for d in want}),
        )
        ok &= check("{} сут.: без повторов".format(days), len(months), len(set(months)))

    # Формат — ESPN-овский YYYYMM, свежий месяц первым.
    # 60 суток от 13 сентября достают до июля — три месяца, а не два.
    ok &= check("формат месяца", [len(m) for m in month_windows(60, today)], [6, 6, 6])
    ok &= check("свежий месяц первым", month_windows(60, today)[0], "202609")
    ok &= check("двое суток — один месяц", month_windows(2, today), ["202609"])
    # Переход через границу месяца: 13 сентября минус 20 суток — это ещё август.
    ok &= check("через границу месяца", month_windows(20, today), ["202609", "202608"])
    # И через границу года.
    ok &= check("через границу года", month_windows(40, date(2026, 1, 20)),
                ["202601", "202512"])
    return ok


def test_within_span():
    """Отбор событий месяца по запрошенным суткам, с запасом в день.

    ⚠️ ЗАПАС ПРОВЕРЯЕТСЯ КАК ТРЕБОВАНИЕ, А НЕ КАК ДОПУСК. Дата в табло — UTC
    по началу матча, а записывается дата из карточки матча; на матче в 23:30Z
    это разные сутки. Отбор ровно по границе выбрасывал бы поздние матчи —
    самые незаметные из возможных потерь.
    """
    ok = True
    first, last = date(2026, 9, 12), date(2026, 9, 13)
    ok &= check("внутри", within_span("2026-09-12", first, last), True)
    ok &= check("внутри, второй день", within_span("2026-09-13", first, last), True)
    ok &= check("запас слева", within_span("2026-09-11", first, last), True)
    ok &= check("запас справа", within_span("2026-09-14", first, last), True)
    ok &= check("за запасом слева", within_span("2026-09-10", first, last), False)
    ok &= check("за запасом справа", within_span("2026-09-15", first, last), False)
    ok &= check("другой месяц отсечён", within_span("2026-08-30", first, last), False)
    # Событие без даты не выбрасывается: лучше лишний summary, чем потерянный
    # матч из-за поля, которого в ответе не оказалось.
    ok &= check("без даты — берём", within_span("", first, last), True)
    ok &= check("через границу года",
                within_span("2025-12-31", date(2026, 1, 1), date(2026, 1, 2)), True)
    return ok


def test_leagues():
    """Список лиг: ключи не повторяются, имена настоящие, старые не потеряны.

    ⚠️ ПРОВЕРЯЕТСЯ ИМЕННО ПОТЕРЯ. Лига, выпавшая из списка, не ломает ни один
    запрос: обход просто перестаёт её спрашивать, и игроки этой лиги тихо
    остаются без статистики — ровно так вторые дивизионы годами стояли на пяти
    процентах покрытия.
    """
    ok = True
    ok &= check("лиги — словарь код->имя", isinstance(LEAGUES, dict), True)
    ok &= check("пустых имён нет", [c for c, n in LEAGUES.items() if not n.strip()], [])
    ok &= check(
        "коды похожи на коды ESPN",
        [c for c in LEAGUES if not c.replace(".", "").replace("_", "").isalnum()],
        [],
    )
    ok &= check(
        "имена не повторяются",
        len(set(LEAGUES.values())), len(LEAGUES),
    )
    were = (
        "eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "usa.1", "bra.1", "rus.1",
        "ned.1", "por.1", "mex.1", "arg.1", "ksa.1", "uefa.champions",
    )
    ok &= check("ни одна прежняя лига не потеряна",
                [c for c in were if c not in LEAGUES], [])
    return ok


class _FakeDb(object):
    """Db с одним нужным методом: запомнить, что бы ушло в PostgREST."""

    def __init__(self):
        self.batches = []

    def upsert(self, table, rows, on_conflict):
        self.batches.append((table, rows, on_conflict))
        return len(rows)


def _row(card_id, day, tournament, goals=0):
    return {"card_id": card_id, "match_date": day, "tournament": tournament,
            "goals": goals}


def test_write_rows():
    """Дубль схлопывается ДО отправки, иначе PostgREST отвергает всю пачку.

    Отрицательный контроль внутри: строки, различающиеся турниром, — не дубль
    и обязаны дойти обе. Без него проверка прошла бы и на коде, который просто
    выбрасывает всё лишнее.
    """
    ok = True

    db = _FakeDb()
    written = write_rows(db, [
        _row("a", "2026-09-01", "Serie B", 1),
        _row("a", "2026-09-01", "Serie B", 1),
    ])
    ok &= check("дубль схлопнут", written, 1)
    ok &= check("в базу ушла одна строка", len(db.batches[0][1]), 1)
    ok &= check("ключ конфликта", db.batches[0][2], "card_id,match_date,tournament")

    db = _FakeDb()
    written = write_rows(db, [
        _row("a", "2026-09-01", "Serie B"),
        _row("a", "2026-09-01", "Coppa Italia"),
    ])
    ok &= check("разные турниры — не дубль", written, 2)

    db = _FakeDb()
    written = write_rows(db, [
        _row("a", "2026-09-01", "Serie B"),
        _row("b", "2026-09-01", "Serie B"),
    ])
    ok &= check("разные карточки — не дубль", written, 2)
    return ok


def main():
    print("test_espn_stats.py")
    ok = test_active_cards_by_key()
    ok &= test_month_windows()
    ok &= test_within_span()
    ok &= test_leagues()
    ok &= test_write_rows()
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
