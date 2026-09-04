"""Рыночная стоимость: разбор страницы и чтение внешнего id (offline).

Покрывает две вещи, каждая из которых ломается МОЛЧА:

  * parse_market_value из docs/players_market_value_transfermarkt.py —
    «15.00m» это пятнадцать МИЛЛИОНОВ, а не пятнадцать сотых, и ошибка тут
    не падает, а записывает в базу неправдоподобное число;
  * WikidataEnricher.external_ids_for_qids — P2446 приходит СТРОКОЙ, и
    чтение её как QID (`value["id"]`) вернуло бы None у всех до единого,
    то есть «ни у кого нет Transfermarkt id» вместо настоящего ответа.

⚠️ Проверяются НАСТОЯЩИЕ функции, а не их копии рядом: копия проверяет копию.

    python3 tests/test_market_value.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.dirname(HERE)
ROOT = os.path.dirname(SCRAPER)
sys.path.insert(0, SCRAPER)

import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "players_market_value_transfermarkt",
    os.path.join(ROOT, "docs", "players_market_value_transfermarkt.py"))
mv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mv)

from scraper.wikidata import WikidataEnricher  # noqa: E402

FAILURES = []


def check(label, got, want):
    if got != want:
        FAILURES.append("{}\n    ожидалось: {!r}\n    получено : {!r}".format(
            label, want, got))


def wrapper(amount, unit, updated="02/06/2026"):
    """Разметка суммы ровно та, что стоит на живой странице профиля."""
    return (
        '<a href="/x/marktwertverlauf/spieler/1" '
        'class="data-header__market-value-wrapper">'
        '<span class="waehrung">€</span>{}<span class="waehrung">{}</span> '
        '<p class="data-header__last-update">Last update: {}</p></a>'
    ).format(amount, unit, updated)


# --- сумма и единица -------------------------------------------------------
check("15.00m — это 15 миллионов",
      mv.parse_market_value(wrapper("15.00", "m")), (15_000_000, "2026-06-02"))
check("900k — это 900 тысяч",
      mv.parse_market_value(wrapper("900", "k"))[0], 900_000)
check("1.20bn — это 1.2 миллиарда",
      mv.parse_market_value(wrapper("1.20", "bn"))[0], 1_200_000_000)

# ⚠️ Запятая — разделитель ТЫСЯЧ, а не десятичный: «1,250.00k» это 1 250 000.
# Снять её обязательно, иначе float() падает и игрок молча теряет стоимость.
check("запятая-тысячи не ломает разбор",
      mv.parse_market_value(wrapper("1,250.00", "k"))[0], 1_250_000)

# --- дата оценки -----------------------------------------------------------
# День/месяц/год: 03/06 — это ТРЕТЬЕ ИЮНЯ, а не шестое марта. Перепутанные
# местами день и месяц дали бы дату из будущего у половины игроков.
check("дата оценки читается как ДД/ММ/ГГГГ",
      mv.parse_market_value(wrapper("40.00", "m", "03/06/2026"))[1], "2026-06-03")
check("день больше 12 не переезжает в месяц",
      mv.parse_market_value(wrapper("40.00", "m", "22/07/2026"))[1], "2026-07-22")

# --- запасной якорь --------------------------------------------------------
check("мета-описание годится, когда обёртки нет",
      mv.parse_market_value(
          '<meta name="description" content="X ➤ Market value: €15.00m ➤ Y">'),
      (15_000_000, None))

# --- отказы ----------------------------------------------------------------
# Пусто лучше нуля: ноль означал бы «оценён в ничто» и утащил бы вниз средний.
check("пустая страница", mv.parse_market_value(""), (None, None))
check("страница без суммы",
      mv.parse_market_value("<html>ничего похожего</html>"), (None, None))
check("прочерк вместо суммы — не стоимость",
      mv.parse_market_value(
          'data-header__market-value-wrapper<span class="waehrung">€</span>-'),
      (None, None))
check("ноль — не стоимость", mv.parse_market_value(wrapper("0", "m")), (None, None))


# --- внешний id: P2446 приходит строкой ------------------------------------
class FakeCache(object):
    def __init__(self):
        self.data = {}

    def get(self, ns, key):
        return self.data.get((ns, key))

    def set(self, ns, key, value):
        self.data[(ns, key)] = value


class FakeWikidata(WikidataEnricher):
    def __init__(self, cache, entities):
        self.cache = cache
        self.entities = entities
        self.calls = []

    def _api(self, params):
        self.calls.append(params)
        ids = params["ids"].split("|")
        return {"entities": {q: self.entities.get(q, {}) for q in ids}}


def entity(tm_id):
    return {"claims": {"P2446": [
        {"mainsnak": {"datavalue": {"value": tm_id}}}]}}


cache = FakeCache()
wd = FakeWikidata(cache, {
    "Q1": entity("28003"),
    "Q2": entity("418560"),
    "Q3": {"claims": {}},                       # игрока на TM нет
    # Значение-словарь вместо строки: формат менялся, и это не должно ронять
    # весь прогон — просто у этого игрока id нет.
    "Q4": {"claims": {"P2446": [{"mainsnak": {"datavalue": {"value": {"id": "x"}}}}]}},
})

got = wd.external_ids_for_qids(["Q1", "Q2", "Q3", "Q4"], "P2446")
check("строковый id прочитан", got, {"Q1": "28003", "Q2": "418560"})
check("одна пачка — один запрос", len(wd.calls), 1)

# Отрицательный результат тоже кэшируется: иначе игроки без TM id
# перезапрашивались бы каждую ночь и пачки не сходились бы никогда.
before = len(wd.calls)
again = wd.external_ids_for_qids(["Q1", "Q2", "Q3", "Q4"], "P2446")
check("повтор берётся из кэша", len(wd.calls), before)
check("повтор даёт тот же ответ", again, got)

# Пачками: 120 QID при chunk=50 — это три запроса, а не 120.
wd2 = FakeWikidata(FakeCache(), {"Q%d" % i: entity(str(i)) for i in range(120)})
wd2.external_ids_for_qids(["Q%d" % i for i in range(120)], "P2446", chunk=50)
check("120 QID укладываются в 3 запроса", len(wd2.calls), 3)


if FAILURES:
    print("ПРОВАЛОВ: {}".format(len(FAILURES)))
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("test_market_value: всё сошлось")
