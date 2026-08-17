"""Offline tests for the sports.ru page parsers — NO network.

Run from the football_scraper/ directory:
    python3 -m tests.test_sports_ru
or:
    python3 tests/test_sports_ru.py

The fixtures below are trimmed from real pages fetched on 2026-08-16. The
shapes that matter are kept verbatim, because every one of them once broke
the parser in a way that still produced believable numbers.
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper.sports_ru import (  # noqa: E402
    parse_club_slugs,
    parse_match_rows,
    parse_ru_date,
    parse_seasons,
    parse_person_names,
    parse_squad,
    parse_totals,
    slug_candidates,
    totals_disagreement,
)


def check(label, got, want):
    status = "ok " if got == want else "FAIL"
    print("  [{}] {}: got={!r} want={!r}".format(status, label, got, want))
    return got == want


def _row(date_text, tournament, heading, score, cards, minutes, goals, assists):
    """Build one match row the way sports.ru builds it.

    Note which cells carry `m-value_0`: the site tags a ZERO with an extra
    class while still printing the digit. That is the whole point of the
    regression below, so the fixture must keep it.
    """

    def cell(value, width=True):
        cls = "b-tag-player-stats__table-list-item-stats-item"
        if value == "0":
            cls += " m-value_0"
        style = ' style="width: 22px;"' if width else ""
        return '<div class="{}"{}>{}</div>'.format(cls, style, value)

    return (
        '<li class="b-tag-player-stats__table-list-item">'
        '<div class="b-tag-player-stats__table-list-item-heading"> {heading} '
        '<div class="b-tag-player-stats__table-score"> <i> </i> {score} <i> </i> </div>'
        "</div>"
        '<div class="b-tag-player-stats__table-list-item-details"> {date} '
        '<span class="g-delimiter-a"></span> {tournament} </div>'
        '<div class="b-tag-player-stats__table-list-item-stats">'
        '<div class="b-tag-player-stats__table-list-item-stats-item"> {cards} </div>'
        "{minutes}{goals}{assists}"
        "</div></li>"
    ).format(
        heading=heading,
        score=score,
        date=date_text,
        tournament=tournament,
        cards=cards,
        minutes=cell(minutes),
        goals=cell(goals),
        assists=cell(assists),
    )


YELLOW = '<span class="b-tag-player-stats__card m-type_yellow"></span>'
RED = '<span class="b-tag-player-stats__card m-type_red"></span>'


def _sum_line(yellow, red, goals, assists):
    """The page's own "Всего" line — laid out UNLIKE a match row."""
    return (
        '<div class="b-tag-player-stats__table-sum">'
        '<div class="b-tag-player-stats__table-sum-item">Всего</div>'
        '<div class="b-tag-player-stats__table-sum-item" style="text-align: right;">'
        '<span class="b-tag-player-stats__card m-type_yellow">{y}</span>'
        '<span class="b-tag-player-stats__card m-type_red">{r}</span></div>'
        '<div class="b-tag-player-stats__table-sum-item" style="width: 22px;">{g}</div>'
        '<div class="b-tag-player-stats__table-sum-item" style="width: 22px;">{a}</div>'
        "</div>"
    ).format(y=yellow, r=red, g=goals, a=assists)


def main():
    ok = True

    # ---- dates -----------------------------------------------------------
    ok &= check("day-first date", parse_ru_date("16.08.2026"), date(2026, 8, 16))
    # 08.09 is 8 September. Read the American way it becomes 9 August — a full
    # month away, which silently moves a match into another rating window.
    ok &= check("08.09 is September", parse_ru_date("08.09.2026"), date(2026, 9, 8))
    ok &= check("date inside a sentence", parse_ru_date("x 01.02.2026 y"), date(2026, 2, 1))
    ok &= check("no date", parse_ru_date("Товарищеские"), None)
    ok &= check("impossible date", parse_ru_date("31.02.2026"), None)
    ok &= check("empty", parse_ru_date(""), None)

    # ---- one ordinary row ------------------------------------------------
    html = _row(
        "16.08.2026", "США. МЛС", "Нэшвилл — Интер Майами", "4 : 1",
        YELLOW, "90", "0", "1",
    )
    rows = parse_match_rows(html)
    ok &= check("one row parsed", len(rows), 1)
    r = rows[0]
    ok &= check("date", r["date"], date(2026, 8, 16))
    ok &= check("tournament", r["tournament"], "США. МЛС")
    ok &= check("home", r["home"], "Нэшвилл")
    ok &= check("away", r["away"], "Интер Майами")
    ok &= check("score", (r["home_score"], r["away_score"]), (4, 1))
    ok &= check("minutes", r["minutes"], 90)
    ok &= check("goals", r["goals"], 0)
    ok &= check("assists", r["assists"], 1)
    ok &= check("yellow", r["yellow"], 1)
    ok &= check("red", r["red"], 0)

    # ---- THE REGRESSION --------------------------------------------------
    # A zero cell carries `m-value_0` in its class list. A pattern anchored on
    # `stats-item"` skips those cells, and because the cells are positional
    # every value to the right then shifts one slot left: the assist below
    # would be read as a goal. Both numbers stay plausible, which is why this
    # has to be a test and not an eyeball.
    shifted = _row(
        "23.08.2025", "Англия. Премьер-лига", "Манчестер Сити — Тоттенхэм", "0 : 2",
        "", "90", "0", "2",
    )
    r2 = parse_match_rows(shifted)[0]
    ok &= check("zero cell kept: goals stay 0", r2["goals"], 0)
    ok &= check("zero cell kept: assists not stolen", r2["assists"], 2)
    ok &= check("zero cell kept: minutes intact", r2["minutes"], 90)

    # An unused substitute: empty minutes is 0, not None — he was there.
    benched = _row("01.03.2026", "Кубок", "А — Б", "1 : 0", "", "", "0", "0")
    ok &= check("empty minutes -> 0", parse_match_rows(benched)[0]["minutes"], 0)

    # Two cards in one match.
    sent_off = _row("02.03.2026", "Кубок", "А — Б", "1 : 0", YELLOW + RED, "45", "0", "0")
    r3 = parse_match_rows(sent_off)[0]
    ok &= check("yellow and red", (r3["yellow"], r3["red"]), (1, 1))

    # A row with no parsable date is dropped, never dated "today": a match on
    # the wrong date lands inside a window and cannot be told from a real one.
    undated = _row("", "Кубок", "А — Б", "1 : 0", "", "90", "1", "0")
    ok &= check("undated row dropped", parse_match_rows(undated), [])

    # A hyphen inside a club name is not the em dash that joins two clubs.
    hyphen = _row("03.03.2026", "Лига 1", "Сент-Этьен — Пари Сен-Жермен", "0 : 3",
                  "", "90", "0", "0")
    r4 = parse_match_rows(hyphen)[0]
    ok &= check("hyphen kept in home", r4["home"], "Сент-Этьен")
    ok &= check("hyphen kept in away", r4["away"], "Пари Сен-Жермен")

    # ---- totals as a self-check -----------------------------------------
    page = _sum_line(1, 0, 0, 3) + "<ul>" + html + shifted + "</ul>"
    totals = parse_totals(page)
    ok &= check("totals goals", totals["goals"], 0)
    ok &= check("totals assists", totals["assists"], 3)
    # A card total is a NUMBER inside one span; a row prints one empty span per
    # card. Counting spans here would report every total as 1.
    ok &= check("totals yellow is the printed number", totals["yellow"], 1)
    ok &= check("rows agree with printed total",
                totals_disagreement(parse_match_rows(page), totals), {})

    # And the guard fires when they disagree.
    lying = _sum_line(1, 0, 99, 3) + "<ul>" + html + shifted + "</ul>"
    ok &= check(
        "guard catches a shift",
        totals_disagreement(parse_match_rows(lying), parse_totals(lying)),
        {"goals": (0, 99)},
    )
    ok &= check("no total block -> no complaint", totals_disagreement(rows, None), {})

    # ---- squad and clubs -------------------------------------------------
    # The navigation strip is OUTSIDE the squad block and must stay out of the
    # result. Every page on the site carries these "popular" links, so a
    # whole-page scan gives every club the same dozen stars — and a club that
    # returns 13 players looks like it worked.
    squad = (
        '<a href="https://m.sports.ru/football/person/messi/">Месси</a>'
        '<div class="b-tag-team-squad__content">'
        '<a href="https://m.sports.ru/football/person/marcilio-florencia-mota-filho/">'
        " Нино </a>"
        '<a href="https://m.sports.ru/football/person/pedro-henrique/"> Педро </a>'
        '<a href="https://m.sports.ru/football/person/pedro-henrique/"> </a>'
        "</section>"
        '<a href="https://m.sports.ru/football/person/cristiano-ronaldo/">Роналду</a>'
    )
    got = parse_squad(squad)
    # The slug is a full legal name behind a one-word playing name. No
    # transliteration of "Нино" reaches this string, which is exactly why the
    # squad page is crawled instead of the slug being generated.
    ok &= check("squad pairs", got, [
        {"slug": "marcilio-florencia-mota-filho", "name_ru": "Нино"},
        {"slug": "pedro-henrique", "name_ru": "Педро"},
    ])

    # Foreign clubs render the block empty — a real answer, not a failure.
    ok &= check(
        "empty squad block",
        parse_squad('<div class="b-tag-team-squad__content"> </div></section>'),
        [],
    )
    # No block at all (a page that is not a squad page) must not fall back to
    # scanning the whole document.
    ok &= check(
        "no squad block -> nothing",
        parse_squad('<a href="https://m.sports.ru/football/person/messi/">Месси</a>'),
        [],
    )

    # ---- guessed slugs, and the check that makes guessing safe ------------
    ok &= check("full name first", slug_candidates("Cristiano Ronaldo"),
                ["cristiano-ronaldo", "ronaldo"])
    ok &= check("diacritics folded", slug_candidates("Kylian Mbappé"),
                ["kylian-mbappe", "mbappe"])
    ok &= check("three parts keep the tail", slug_candidates("Virgil van Dijk"),
                ["virgil-van-dijk", "van-dijk", "dijk"])
    ok &= check("single name", slug_candidates("Neymar"), ["neymar"])
    ok &= check("nothing to guess from", slug_candidates(""), [])

    header = (
        "<h1>Эрлинг Холанд</h1>"
        '<div class="b-tag-header__tag-name-alt-name">Erling Håland</div>'
    )
    ok &= check("person names", parse_person_names(header), ("Эрлинг Холанд", "Erling Håland"))
    # The stat sub-page appends a suffix to the same heading.
    ok &= check(
        "stat page suffix stripped",
        parse_person_names("<h1>Эрлинг Холанд - статистика</h1>")[0],
        "Эрлинг Холанд",
    )
    ok &= check("no header", parse_person_names(""), (None, None))

    table = (
        '<a href="https://m.sports.ru/football/club/zenit/">Лента</a>'
        '<a href="https://m.sports.ru/football/club/krasnodar/">Краснодар</a>'
        '<a href="https://m.sports.ru/football/club/zenit/">Зенит</a>'
    )
    # Slugs only: the page links back to the current club under the menu label,
    # so a name taken from here would claim Zenit is called "Лента".
    ok &= check("club slugs deduped, ordered", parse_club_slugs(table), ["zenit", "krasnodar"])

    ok &= check(
        "seasons",
        parse_seasons('<option value="1298623">2025/2026</option>'
                      '<option value="994417">2024/2025</option>'),
        [("1298623", "2025/2026"), ("994417", "2024/2025")],
    )

    # ---- empties ---------------------------------------------------------
    ok &= check("no rows", parse_match_rows(""), [])
    ok &= check("no squad", parse_squad(""), [])
    ok &= check("no clubs", parse_club_slugs(""), [])
    ok &= check("no totals", parse_totals(""), None)

    print("\n{}".format("ALL TESTS PASSED" if ok else "SOME TESTS FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
