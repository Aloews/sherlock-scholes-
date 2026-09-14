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

from espn_stats import (  # noqa: E402
    CHUNK_DAYS,
    LEAGUES,
    active_cards_by_key,
    card_key,
    date_windows,
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


def _days_covered(windows):
    """Множество всех суток, которые покрывают окна — по одной дате за раз."""
    days = set()
    for lo, hi in windows:
        a = date(int(lo[:4]), int(lo[4:6]), int(lo[6:]))
        b = date(int(hi[:4]), int(hi[4:6]), int(hi[6:]))
        while a <= b:
            days.add(a)
            a += timedelta(days=1)
    return days


def test_date_windows():
    """Окна дат обязаны покрыть ровно запрошенные сутки — без дыр и без хвоста.

    Дыра здесь не падает и не кричит: пропущенный день выглядит как день без
    матчей, и потеря обнаружилась бы только тем, что у игрока не хватает
    матча в рейтинге. Поэтому проверяется не форма строк, а ПОКРЫТИЕ.
    """
    ok = True
    today = date(2026, 9, 13)

    for days in (1, 2, 29, 30, 31, 60, 90, 91):
        windows = date_windows(days, today)
        covered = _days_covered(windows)
        want = {today - timedelta(days=i) for i in range(days)}
        # Сравниваются множества, а печатается их РАЗНОСТЬ: вывалить сюда
        # девяносто дат значило бы утопить настоящее падение в стене строк —
        # ровно так, как это уже было с прогоном тестов скрапера.
        ok &= check("{} сут.: не покрыто".format(days), sorted(want - covered), [])
        ok &= check("{} сут.: лишнее".format(days), sorted(covered - want), [])
        ok &= check(
            "{} сут.: окон не больше нужного".format(days),
            len(windows), (days + CHUNK_DAYS - 1) // CHUNK_DAYS,
        )

    # Формат — ESPN-овский YYYYMMDD, и «с» не позже «по».
    lo, hi = date_windows(2, today)[0]
    ok &= check("формат даты", (len(lo), len(hi), lo <= hi), (8, 8, True))
    ok &= check("свежее окно первым", hi, "20260913")

    # Сутки считаются ВКЛЮЧИТЕЛЬНО: двое суток — это сегодня и вчера.
    ok &= check("двое суток = сегодня и вчера", date_windows(2, today), [("20260912", "20260913")])
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
    ok &= test_date_windows()
    ok &= test_leagues()
    ok &= test_write_rows()
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
