"""Разбор стоимости с профиля Transfermarkt (offline, без сети и без базы).

Покрывает parse_value из docs/cards_market_value_tm.py.

⚠️ Проверяется НАСТОЯЩАЯ функция, а не её копия. Копия в тесте проверяет
копию: в test_title_match.py логика уже была переписана рядом, гард в переписи
забыт — и тест был зелёным на поломке.

Разметка ниже снята с БОЕВЫХ страниц 04.09.2026 (Павлович 574671, Торриани
939745), а не придумана: придуманная разметка проверяет фантазию автора.

    python3 tests/test_market_value_parse.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.dirname(HERE)
ROOT = os.path.dirname(SCRAPER)

import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "cards_market_value_tm", os.path.join(ROOT, "docs", "cards_market_value_tm.py"))
mv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mv)

FAILURES = []


def check(label, got, want):
    if got != want:
        FAILURES.append("{}\n    ожидалось: {!r}\n    получено : {!r}".format(
            label, want, got))


# --- боевая разметка, миллионы -------------------------------------------
PAVLOVIC = (
    '<div class="data-header__box--small">\n'
    '<a href="/strahinja-pavlovic/marktwertverlauf/spieler/574671" '
    'class="data-header__market-value-wrapper">'
    '<span class="waehrung">€</span>40.00'
    '<span class="waehrung">m</span>'
    '<p class="data-header__last-update">Last update: 29/05/2026</p></a>\n'
    '</div>')

# --- боевая разметка, тысячи ---------------------------------------------
TORRIANI = (
    '<a href="/lorenzo-torriani/marktwertverlauf/spieler/939745" '
    'class="data-header__market-value-wrapper">'
    '<span class="waehrung">€</span>800'
    '<span class="waehrung">k</span>'
    '<p class="data-header__last-update">Last update: 29/05/2026</p></a>')

# --- у игрока оценки нет вовсе -------------------------------------------
NO_VALUE = (
    '<a class="data-header__market-value-wrapper">'
    '<span class="waehrung">€</span>-'
    '</a>')

# --- запасной путь: только meta-описание ---------------------------------
ONLY_META = (
    '<meta name="description" content="Strahinja Pavlović, 25, from '
    'Serbia ➤ AC Milan, since 2024 ➤ Centre-Back ➤ Market '
    'value: €40.00m ➤ * 24/05/2001 in Šabac" />')

# --- чужая валюта ---------------------------------------------------------
POUNDS = (
    '<a class="data-header__market-value-wrapper">'
    '<span class="waehrung">£</span>25.00'
    '<span class="waehrung">m</span></a>')

check("миллионы: 40.00m -> 40 000 000 евро и дата оценки",
      mv.parse_value(PAVLOVIC), (40000000, "2026-05-29", "€"))
check("тысячи: 800k -> 800 000, а не 800",
      mv.parse_value(TORRIANI), (800000, "2026-05-29", "€"))
check("прочерк у источника — это None, а не ноль",
      mv.parse_value(NO_VALUE)[0], None)
check("запасной путь: число берётся из meta, когда блока нет",
      mv.parse_value(ONLY_META)[0], 40000000)
check("без блока и без Last update даты нет, а число есть",
      mv.parse_value(ONLY_META)[1], None)
check("чужая валюта возвращается как есть — решает вызывающий",
      mv.parse_value(POUNDS)[2], "£")
check("пустой ответ не падает и ничего не выдумывает",
      mv.parse_value(""), (None, None, None))
check("None вместо страницы не падает",
      mv.parse_value(None), (None, None, None))

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ. Проверка обязана КРАСНЕТЬ на сломанном. Здесь
# ломается ровно то, из-за чего 800k стали бы восемьюстами: единицы.
_saved = dict(mv.UNITS)
try:
    mv.UNITS["k"] = 1
    broken, _d, _c = mv.parse_value(TORRIANI)
    check("контроль: со сломанными единицами 800k перестаёт быть 800 000",
          broken != 800000, True)
finally:
    mv.UNITS.clear()
    mv.UNITS.update(_saved)

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ 2: без запасного пути meta-случай обязан
# перестать разбираться. Иначе «запасной путь работает» ничем не доказано.
_meta_re = mv._META
try:
    mv._META = mv.re.compile(r"^НИКОГДА_НЕ_СОВПАДЁТ$")
    check("контроль: без meta-пути описание перестаёт давать число",
          mv.parse_value(ONLY_META)[0], None)
finally:
    mv._META = _meta_re

if FAILURES:
    print("ПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("test_market_value_parse: OK")
