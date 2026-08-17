"""Pure parsing of sports.ru pages — no network, no I/O.

Three page shapes feed the player-rating pipeline, and each one exists because
the one before it cannot be guessed:

  /football/club/<slug>/table/  -> the other club slugs of that league
  /football/club/<slug>/team/   -> (player slug, Russian name) of the squad
  /football/person/<slug>/stat/ -> one row per match, WITH A DATE

The last one is the only page on the site that carries dated per-match rows;
the person page itself carries a season summary, and a season summary can
never answer "who scored in the last 7 days".

⚠️ The squad page is not a convenience — it is the only way to learn a slug.
A slug is NOT a transliteration of the displayed name: Zenit's "Нино" lives at
`marcilio-florencia-mota-filho`, "Джон Джон" at `jhonatan-dos-santos-rosa`,
"Педро" at `pedro-henrique`. Every one of those is a full legal name behind a
one-word playing name, so any generated-from-the-name slug misses them
silently — a 404 looks exactly like "this player had no matches".

robots.txt (checked with urllib.robotparser, not by eye): `Disallow: /stat/`
is a prefix rule and matches `sports.ru/stat/…`, NOT
`/football/person/<slug>/stat/`. `/api/`, `/ajax/` and `/search/` ARE closed,
which is why nothing here calls a JSON endpoint and why slugs are crawled
rather than searched.
"""
import re
import unicodedata
from datetime import date

# Row of the per-match table. The four stat cells are positional in the
# markup — only the last three carry a width style, so they cannot be told
# apart by attributes; index is the only stable key.
CARDS_CELL, MINUTES_CELL, GOALS_CELL, ASSISTS_CELL = 0, 1, 2, 3

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")

_PERSON_HREF = re.compile(
    r'href="https?://[a-z.]*sports\.ru/football/person/([a-z0-9-]+)/"'
    r'[^>]*>\s*([^<]{1,80}?)\s*<'
)
_CLUB_HREF = re.compile(r'href="https?://[a-z.]*sports\.ru/football/club/([a-z0-9-]+)/"')

_MATCH_ROW = re.compile(
    r'<li class="b-tag-player-stats__table-list-item">(.*?)</li>', re.S
)
_HEADING = re.compile(
    r'item-heading">(.*?)(?:<div class="b-tag-player-stats__table-score">(.*?)</div>)?\s*</div>',
    re.S,
)
_DETAILS = re.compile(r'item-details">(.*?)</div>', re.S)
# ⚠️ The class list must be matched loosely. A cell holding a zero is marked
# `class="…stats-item m-value_0"`, so a pattern anchored on `stats-item"`
# silently skips exactly the zero cells — and because the cells are read by
# POSITION, every value to the right then shifts one slot left. It reads as
# real data: Haaland came out 62 goals / 8 assists against the page's own
# 59 / 11, three assists having become goals.
_STAT_CELL = re.compile(
    r'<div class="[^"]*table-list-item-stats-item[^"]*"[^>]*>(.*?)</div>', re.S
)
_SUM_CELL = re.compile(
    r'<div class="[^"]*table-sum-item[^"]*"[^>]*>(.*?)</div>', re.S
)
_SEASON_OPTION = re.compile(r'<option value="(\d+)">(\d{4}(?:/\d{4})?)</option>')
_DATE = re.compile(r"(\d{2})\.(\d{2})\.(\d{4})")
_SCORE = re.compile(r"(\d+)\s*:\s*(\d+)")

# Team names are joined by an em dash surrounded by spaces. A hyphen inside a
# name ("Сент-Этьен", "Атлетико Мадрид-Б") is a different character, so the
# split cannot cut a club in half.
_TEAM_SEP = " — "


def _text(html):
    """Strip tags and collapse whitespace, decoding the few entities sports.ru
    actually emits in these blocks."""
    if not html:
        return ""
    out = _TAG.sub(" ", html)
    out = (
        out.replace("&minus;", "−")
        .replace("&mdash;", "—")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&#039;", "'")
    )
    return _WS.sub(" ", out).strip()


def _int(text, default=0):
    """First integer in the cell, or the default.

    The markup tags a zero with a `m-value_0` CLASS while still printing the
    digit, so the class is decoration: read the text, never the class.
    An unused substitute has an empty minutes cell — that is a 0, not a None,
    because the player was at the match and did not play.
    """
    m = re.search(r"-?\d+", text or "")
    return int(m.group(0)) if m else default


def parse_ru_date(text):
    """`16.08.2026` -> `datetime.date(2026, 8, 16)`; None when absent.

    Day-first. `08.09.2026` is 8 September, never 9 August — reading it the
    American way would move a match across a window boundary and quietly
    reshuffle a weekly rating.
    """
    m = _DATE.search(text or "")
    if not m:
        return None
    day, month, year = (int(g) for g in m.groups())
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_club_slugs(html):
    """Club slugs on a league-table page, in order, de-duplicated.

    Names are deliberately dropped: the page's own navigation links back to the
    current club under the menu label ("Лента"), so a slug->name map built here
    would claim Zenit is called "Лента". The slug is the only trustworthy half.
    """
    out = []
    seen = set()
    for slug in _CLUB_HREF.findall(html or ""):
        if slug not in seen:
            seen.add(slug)
            out.append(slug)
    return out


def parse_squad(html):
    """[{'slug', 'name_ru'}] from a club squad page, de-duplicated by slug.

    ⚠️ SCOPED TO THE SQUAD BLOCK ON PURPOSE. Every page on the site carries a
    navigation strip of "popular" players — Messi, Ronaldo, Haaland, Salah —
    as ordinary /football/person/ links. Read the whole page and every club
    comes back with the same dozen stars in its squad, which looks entirely
    plausible: a club that returns 13 players has clearly "worked". It is the
    same shape of mistake as reading a season table and calling it form.

    An empty result is therefore a real answer, and a common one: sports.ru
    server-renders the squad table for Russian clubs and leaves the block empty
    for foreign ones (checked — Chelsea's block is literally `<div> </div>`).
    Foreign slugs come from parse_scorers() instead.
    """
    block = re.search(
        r'b-tag-team-squad__content">(.*?)(?:</section>|<div class="b-up-button)',
        html or "",
        re.S,
    )
    if not block:
        return []
    out = []
    seen = set()
    for slug, name in _PERSON_HREF.findall(block.group(1)):
        name = _text(name)
        if not name or slug in seen:
            continue
        seen.add(slug)
        out.append({"slug": slug, "name_ru": name})
    return out


_H1 = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S)
_ALT_NAME = re.compile(r'tag-name-alt-name[^>]*>(.*?)</', re.S)

# Буквы, которые НЕ раскладываются по NFKD: у них нет отдельного диакритического
# знака, штрих — часть самой буквы. Их всего горстка, и список кончается —
# в отличие от списка «буква с чёрточкой», который бесконечен.
_NON_DECOMPOSING = str.maketrans({
    "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ł": "l", "Ł": "L",
    "ı": "i", "İ": "I", "ŀ": "l", "ß": "ss",
    "þ": "th", "Þ": "Th", "ð": "d", "Ð": "D",
    "æ": "ae", "Æ": "Ae", "œ": "oe", "Œ": "Oe",
})


def fold_latin(text):
    """Латиница без диакритики — тем же способом, каким её убирает сам сайт.

    ⚠️ ЗДЕСЬ БЫЛА РУКОПИСНАЯ ТАБЛИЦА НА 31 СИМВОЛ, И ОНА МОЛЧА ЕЛА БУКВЫ.
    Символа, которого в ней нет, `translate` не трогает, а следующий за ним
    `re.split(r"[^a-z0-9]+")` его ВЫБРАСЫВАЕТ. То есть «Luka Modrić»
    превращался не в `luka-modric`, а в `luka-modri` — слаг, которого не
    существует, и страница отвечала 404. Снаружи это неотличимо от «у игрока
    нет матчей»: обе ветки дают пустую статистику и ни одной ошибки.

    Замер на живой дыре (513 карточек с клубом и без слага): 52 из них, то
    есть каждая десятая, теряли символ. Что именно терялось:
        ć×32  ı×8  č×4  ō×4  ğ×3  ū×2  ń×2  ț ř ş ě ș ă
    `luka-modric` проверен запросом — отвечает 200 и «Лука Модрич».

    Поэтому список заменён ВЫВОДОМ: NFKD раскладывает букву со знаком на букву
    и знак, знаки выбрасываются как «объединяющие», и правило перестаёт
    зависеть от того, вспомнил ли кто-то про хорватскую ć. Таблица осталась
    только для букв, которые не раскладываются вовсе.
    """
    decomposed = unicodedata.normalize("NFKD", text or "")
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return stripped.translate(_NON_DECOMPOSING)


def parse_person_names(html):
    """(name_ru, name_latin) from a person page header; either may be None.

    This is the half that makes a GUESSED slug safe. Foreign squads are not in
    the HTML, so a slug has to be proposed from the Latin name — and a proposal
    is only usable if the page it opens can be checked against the card that
    asked for it. The header prints both spellings, so a wrong guess that still
    returns 200 (a different player with a similar name) is caught here rather
    than being written into the ratings as that player's goals.
    """
    h1 = _H1.search(html or "")
    name_ru = _text(h1.group(1)) if h1 else None
    alt = _ALT_NAME.search(html or "")
    name_latin = _text(alt.group(1)) if alt else None
    # The stat sub-page titles itself "<Имя> - статистика".
    if name_ru:
        name_ru = re.sub(r"\s*[-–—]\s*статистика\s*$", "", name_ru).strip()
    return (name_ru or None, name_latin or None)


def slug_candidates(name_latin):
    """Slugs worth trying for a Latin name, best first.

    sports.ru uses the full name for most foreign players (`cristiano-ronaldo`,
    `lamine-yamal`) and a bare surname for the very famous (`messi`, `mbappe`,
    `neymar`, `salah`). Both are cheap to try and both are VERIFIED against the
    page header before use, so a wrong guess costs one request and nothing
    else. Diacritics are folded because the site's slugs are plain ASCII.

    ⚠️ ПЕРВОЕ ИМЯ В ОДИНОЧКУ — ТОЖЕ ФОРМА, и её здесь не было. У бразильцев
    играющее имя это имя, а не фамилия: «Vinícius Júnior» живёт на
    `/football/person/vinicius/` — проверено запросом, отвечает 200 и
    «Винисиус Жуниор». Прежний список давал `vinicius-junior` (404) и `junior`
    (404), то есть перебирал обе неверные формы и ни одной верной.

    Стоит эта форма одного запроса и только для карточек, которые не
    разрешились ничем другим, — а неверная догадка по-прежнему отсекается
    сверкой с заголовком страницы, а не попадает в рейтинг.
    """
    cleaned = fold_latin(name_latin or "").lower()
    parts = [p for p in re.split(r"[^a-z0-9]+", cleaned) if p]
    if not parts:
        return []
    out = ["-".join(parts)]
    if len(parts) > 1:
        # Порядок — от самого вероятного к самому редкому: полное имя, хвост
        # после первого слова, голая фамилия и только потом голое имя.
        for tail in ("-".join(parts[1:]), parts[-1], parts[0]):
            if tail not in out:
                out.append(tail)
    return out


def parse_seasons(html):
    """[(season_id, label)] from the season picker, newest first as rendered."""
    return [(sid, label) for sid, label in _SEASON_OPTION.findall(html or "")]


def _card_total(cell_html, kind):
    """Number printed inside the yellow/red card span of the total line."""
    m = re.search(r'<span class="[^"]*' + kind + r'[^"]*"[^>]*>(.*?)</span>', cell_html, re.S)
    return _int(_text(m.group(1))) if m else 0


def parse_totals(html):
    """The page's own "Всего" line: {'goals', 'assists', 'yellow', 'red'}, or
    None when the block is absent.

    This exists to check the row parser against the same page that produced the
    rows. The cells are read by position, and a markup change that drops or
    adds one cell shifts every value sideways into a plausible-looking number —
    the failure this project keeps meeting, where both numbers are believable
    and neither is right. Comparing the summed rows with the printed total
    turns that silent shift into a loud one.
    """
    block = re.search(r'table-sum">(.*?)</div>\s*<ul', html or "", re.S)
    if not block:
        return None
    cells = _SUM_CELL.findall(block.group(1))
    if len(cells) < 4:
        return None
    # ⚠️ The total line is NOT laid out like a match row. It has no minutes
    # column, so the label takes slot 0 and the cards slide into slot 1;
    # goals and assists land on 2 and 3 only by coincidence. And a card here
    # is a COUNT printed inside one span ("3"), where a row prints one empty
    # span per card — counting spans would report every total as 1.
    label, cards = cells[0], cells[1]
    del label
    return {
        "goals": _int(_text(cells[2])),
        "assists": _int(_text(cells[3])),
        "yellow": _card_total(cards, "m-type_yellow"),
        "red": _card_total(cards, "m-type_red"),
    }


def totals_disagreement(rows, totals):
    """Fields where the summed rows differ from the page's printed total, as
    {field: (summed, printed)}. Empty dict means they agree (or no total)."""
    if not totals:
        return {}
    summed = {
        key: sum(r[key] for r in rows) for key in ("goals", "assists", "yellow", "red")
    }
    return {k: (summed[k], totals[k]) for k in summed if summed[k] != totals[k]}


def parse_match_rows(html):
    """One dict per played match on a /stat/ page.

    Keys: date, tournament, home, away, home_score, away_score, minutes,
    goals, assists, yellow, red.

    Rows without a parsable date are dropped rather than defaulted to today —
    a match with the wrong date is worse than a missing one, because it lands
    inside a rating window and cannot be told from a real result.
    """
    rows = []
    for chunk in _MATCH_ROW.findall(html or ""):
        details = _DETAILS.search(chunk)
        when = parse_ru_date(_text(details.group(1)) if details else "")
        if when is None:
            continue

        # "16.08.2026 <delimiter> США. МЛС" -> tournament is what follows the date.
        detail_text = _text(details.group(1))
        tournament = _DATE.sub("", detail_text, count=1).strip(" ·-–—")

        heading = _HEADING.search(chunk)
        teams_text = _text(heading.group(1)) if heading else ""
        score_text = _text(heading.group(2)) if heading and heading.group(2) else ""
        home, away = "", ""
        if _TEAM_SEP in teams_text:
            home, away = (p.strip() for p in teams_text.split(_TEAM_SEP, 1))
        else:
            home = teams_text

        score = _SCORE.search(score_text)
        cells = [_text(c) for c in _STAT_CELL.findall(chunk)]
        raw_cards = _STAT_CELL.findall(chunk)
        cards_html = raw_cards[CARDS_CELL] if raw_cards else ""

        rows.append(
            {
                "date": when,
                "tournament": tournament,
                "home": home,
                "away": away,
                "home_score": int(score.group(1)) if score else None,
                "away_score": int(score.group(2)) if score else None,
                "minutes": _int(cells[MINUTES_CELL]) if len(cells) > MINUTES_CELL else 0,
                "goals": _int(cells[GOALS_CELL]) if len(cells) > GOALS_CELL else 0,
                "assists": _int(cells[ASSISTS_CELL]) if len(cells) > ASSISTS_CELL else 0,
                "yellow": cards_html.count("m-type_yellow"),
                "red": cards_html.count("m-type_red"),
            }
        )
    return rows
