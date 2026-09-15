"""Offline tests for sports_ru_stats.py's own matching logic — NO network.

Run from the football_scraper/ directory:
    python3 -m tests.test_sports_ru_stats
or:
    python3 tests/test_sports_ru_stats.py
"""
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sports_ru_stats import (  # noqa: E402
    FIRST_PASS_CANDIDATES, SEED_CLUBS, Db, _candidate_budget,
    active_cards_by_key, guess_order, resolve_by_name, resolve_slugs,
    slug_candidates,
)


def check(label, got, want):
    status = "ok " if got == want else "FAIL"
    print("  [{}] {}: got={!r} want={!r}".format(status, label, got, want))
    return got == want


def _card(card_id, name):
    return {"id": card_id, "name": name, "name_en": ""}


def test_active_cards_by_key():
    ok = True

    # The measured case: a retired legend's bare-name card, no current club —
    # excluded, so a squad page listing an unrelated active "Роналдо" has
    # nothing to wrongly match against.
    cards = [_card("legend", "Роналдо")]
    ok &= check("retired namesake excluded", active_cards_by_key(cards, set()), {})

    # An active player with a current club is included as before.
    cards = [_card("active", "Килиан Мбаппе")]
    ok &= check(
        "active player included",
        active_cards_by_key(cards, {"active"}),
        {"килианмбаппе": _card("active", "Килиан Мбаппе")},
    )

    # Mixed pool: only the one with a current club survives.
    cards = [_card("legend", "Роналдо"), _card("active", "Килиан Мбаппе")]
    got = active_cards_by_key(cards, {"active"})
    ok &= check("mixed pool keeps only the active one", len(got), 1)
    ok &= check("mixed pool keeps the right one", list(got.values())[0]["id"], "active")

    # Two cards sharing a canonical_key: first one wins, same as the
    # pre-existing dict.setdefault behaviour this function preserves.
    cards = [_card("first", "Данило"), _card("second", "Данило")]
    got = active_cards_by_key(cards, {"first", "second"})
    ok &= check("duplicate key: first wins", len(got), 1)
    ok &= check("duplicate key: first wins (id)", list(got.values())[0]["id"], "first")

    return ok


def test_guess_order():
    """Очередь догадки обязана ДВИГАТЬСЯ, а не перебирать одних и тех же.

    ⚠️ ЭТО ПРОВЕРКА ПО СЛЕДАМ ЗАМЕРА, А НЕ ПО ВКУСУ. Кандидаты шли в порядке
    `id`, а бюджет кончается на первых сотнях: прогон 11.09.2026 угадал ранги
    с 5-го по 368-й из 24 093, и ровно те же первые сотни перебирались бы
    каждую ночь. «Собрать статистику всех игроков» при таком порядке
    недостижимо в принципе.
    """
    print(" guess_order")
    ok = True
    cards = [_card("a", "А"), _card("b", "Б"), _card("c", "В"), _card("d", "Г")]
    wanted = {"a", "b", "c", "d"}

    # Уже в справочнике — не кандидат вовсе.
    got = [c["id"] for c in guess_order(cards, wanted, {"a"}, {})]
    ok &= check("known card is not a candidate", got, ["b", "c", "d"])

    # Никого не пробовали — порядок исходный.
    got = [c["id"] for c in guess_order(cards, wanted, set(), {})]
    ok &= check("nothing tried yet: order kept", got, ["a", "b", "c", "d"])

    # ⚠️ ГЛАВНОЕ: пробованные уходят В КОНЕЦ, непробованные вперёд.
    misses = {"a": (1, "2026-09-11"), "b": (1, "2026-09-11")}
    got = [c["id"] for c in guess_order(cards, wanted, set(), misses)]
    ok &= check("untried go first", got, ["c", "d", "a", "b"])

    # Среди пробованных: сначала те, кого пробовали РЕЖЕ, потом ДАВНЕЕ.
    misses = {
        "a": (3, "2026-01-01"),   # пробовали чаще всех — в самый конец
        "b": (1, "2026-09-11"),   # раз, недавно
        "c": (1, "2026-01-01"),   # раз, давно — вперёд «b»
        "d": (2, "2026-01-01"),
    }
    got = [c["id"] for c in guess_order(cards, wanted, set(), misses)]
    ok &= check("fewer tries first, then older", got, ["c", "b", "d", "a"])

    # ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: порядок ОБЯЗАН отличаться от исходного, иначе
    # проверка выше зеленела бы и на функции, которая ничего не сортирует.
    ok &= check("order actually changes", got == ["a", "b", "c", "d"], False)
    return ok


class _FlakySession:
    """Сессия, которая роняет первые `fail` запросов сетью, потом отвечает."""

    def __init__(self, fail, payload):
        self.fail, self.payload, self.calls = fail, payload, 0
        self.headers = {}

    def update(self, *a, **k):  # pragma: no cover — headers.update
        pass

    def get(self, url, timeout=None):
        self.calls += 1
        if self.calls <= self.fail:
            raise requests.ConnectionError("boom")
        return _Resp(self.payload)


class _Resp:
    def __init__(self, payload, status=200):
        self.payload, self.status_code = payload, status
        # `upsert` печатает тело отказа — без него отказ был бы безымянным.
        self.text = ""

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError("{} Server Error".format(self.status_code))

    def json(self):
        return self.payload


def test_select_survives_a_dropped_connection():
    """Чтение обязано пережить одиночный обрыв — как и запись.

    ⚠️ ПО СЛЕДАМ ПАДЕНИЯ 12.09.2026:

        resolve FAILED: ReadTimeout: ... (read timeout=60)

    Упало на чтении `sports_ru_player`, и карта слагов за сутки не пополнилась
    вовсе. У `upsert` повтор был с 18.08, у `select` — нет; разница была
    недосмотром, а не решением: обрывается один и тот же Supabase.
    """
    print(" select retry")
    ok = True
    db = Db.__new__(Db)
    db.url = "https://example.invalid/rest/v1"

    # Два обрыва подряд, третий запрос отвечает — строки доходят.
    db.session = _FlakySession(fail=2, payload=[])
    got = db.select("/sports_ru_player?select=card_id&order=card_id")
    ok &= check("survives two drops", got, [])
    ok &= check("and it really retried", db.session.calls, 3)

    # ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: три обрыва подряд обязаны дойти до вызывающего.
    # Без него проверка зеленела бы и на «глотать любую ошибку», а это хуже
    # падения: прогон молча считал бы справочник пустым.
    db.session = _FlakySession(fail=3, payload=[])
    raised = False
    try:
        db.select("/sports_ru_player?select=card_id&order=card_id")
    except requests.ConnectionError:
        raised = True
    ok &= check("three drops still raise", raised, True)
    return ok


class _CodeSession:
    """Сессия, отвечающая заданными кодами по очереди."""

    def __init__(self, codes):
        self.codes, self.calls = list(codes), 0
        self.headers = {}

    def get(self, url, timeout=None):
        self.calls += 1
        code = self.codes[min(self.calls - 1, len(self.codes) - 1)]
        return _Resp([], status=code)


class _PagingSession:
    """Отдаёт `pages` по очереди и запоминает запрошенные адреса."""

    def __init__(self, pages):
        self.pages, self.urls = list(pages), []
        self.headers = {}

    def get(self, url, timeout=None):
        self.urls.append(url)
        page = self.pages[min(len(self.urls) - 1, len(self.pages) - 1)]
        return _Resp(page)


def test_keyset_column():
    """Обход по ключу — только там, где он ДОКАЗУЕМО верен."""
    print(" keyset column")
    ok = True
    ok &= check("simple order",
                Db._keyset_column("/cards?select=id,name&order=id"), "id")
    ok &= check("order column must be selected",
                Db._keyset_column("/cards?select=name&order=id"), None)
    # ⚠️ СОСТАВНОЙ ПОРЯДОК СРАВНИТЬ ОДНИМ `gt` НЕЛЬЗЯ — остаётся смещение.
    ok &= check("composite order falls back",
                Db._keyset_column(
                    "/sports_ru_player?select=card_id,slug"
                    "&order=checked_at.asc.nullsfirst,card_id.asc"), None)
    ok &= check("descending falls back",
                Db._keyset_column("/cards?select=id&order=id.desc"), None)
    return ok


def test_select_pages_by_key_not_offset():
    """Страницы обязаны идти ПО КЛЮЧУ, а не по смещению.

    ⚠️ ЭТО ПРОВЕРКА ПО СЛЕДАМ ОТКАЗА, А НЕ ПО ВКУСУ. Ручной прогон 13.09.2026:

        504 Server Error: Gateway Timeout
        /cards?select=id,name,name_en&...&order=id&limit=1000&offset=5000

    `OFFSET 5000` заставляет Postgres построить и выбросить пять тысяч строк,
    и цена растёт с каждой страницей. Двадцать шесть страниц по 25 508
    карточкам сервер не дотягивает.
    """
    print(" select pages by key")
    ok = True
    first = [{"id": "id-{:04d}".format(i)} for i in range(Db.PAGE_ROWS)]
    db = Db.__new__(Db)
    db.url = "https://example.invalid/rest/v1"
    db.session = _PagingSession([first, [{"id": "id-last"}]])
    got = db.select("/cards?select=id&order=id")
    ok &= check("both pages read", len(got), Db.PAGE_ROWS + 1)
    ok &= check("second page asks by key",
                "id=gt.id-0999" in db.session.urls[1], True)
    # ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: смещения быть не должно НИ В ОДНОМ адресе.
    # Без него проверка зеленела бы и на «ключ добавили, а offset оставили».
    ok &= check("no offset anywhere",
                any("offset=" in u for u in db.session.urls), False)
    return ok


def test_select_retries_a_gateway_timeout():
    """504 — это «сервер не успел», а не «запрос отвергли».

    ⚠️ ЭТО ВТОРОЙ КЛАСС ПОЛОМКИ, И ПЕРВЫЙ ПОВТОР ЕГО НЕ ЛОВИЛ. `ReadTimeout` —
    исключение сети; 504 приходит нормальным ответом и становится исключением
    только в `raise_for_status`. Повтор, написанный под один класс, второй
    пропускал бы — что и случилось.
    """
    print(" select retries 504")
    ok = True
    db = Db.__new__(Db)
    db.url = "https://example.invalid/rest/v1"

    db.session = _CodeSession([504, 504, 200])
    ok &= check("504 twice then 200 goes through",
                db.select("/cards?select=id&order=id"), [])
    ok &= check("and it really retried", db.session.calls, 3)

    # ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ ПЕРВЫЙ: три отказа подряд обязаны дойти наверх.
    db.session = _CodeSession([504])
    raised = False
    try:
        db.select("/cards?select=id&order=id")
    except requests.HTTPError:
        raised = True
    ok &= check("three 504 still raise", raised, True)

    # ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ ВТОРОЙ, И ОН ВАЖНЕЕ: 4xx повторять НЕЛЬЗЯ.
    # «Запрос рассмотрели и отвергли» повторится столько раз, сколько его
    # послать, — а прогон при этом будет ждать вдвое дольше и упадёт так же.
    db.session = _CodeSession([400])
    raised = False
    try:
        db.select("/cards?select=id&order=id")
    except requests.HTTPError:
        raised = True
    ok &= check("400 raises at once", raised, True)
    ok &= check("400 is not retried", db.session.calls, 1)
    return ok


class _PostSession:
    """Сессия, отвечающая на POST заданными кодами по очереди."""

    def __init__(self, codes):
        self.codes, self.calls = list(codes), 0
        self.headers = {}

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls += 1
        code = self.codes[min(self.calls - 1, len(self.codes) - 1)]
        return _Resp([], status=code)


def test_upsert_retries_a_gateway_timeout():
    """504 на ЗАПИСИ — тоже «сервер не успел», и повторять её можно.

    ⚠️ ТОТ ЖЕ УРОК, ЧТО У ЧТЕНИЯ, И ОН НЕ БЫЛ ПЕРЕНЕСЁН НА ЗАПИСЬ. Повтор здесь
    стоял только на исключениях сети, а 504 приходит нормальным ответом:

        13.09.2026  RuntimeError: player_match_stats upsert 504:
                    {"message":"Gateway Timeout"}

    Это унесло обход ESPN на тринадцатой лиге из пятидесяти трёх, через сорок
    минут работы. Повторять запись безопасно ровно потому, что она
    идемпотентна: merge-duplicates по одному ключу.
    """
    print(" upsert retries 504")
    ok = True
    db = Db.__new__(Db)
    db.url = "https://example.invalid/rest/v1"
    row = [{"card_id": "a", "match_date": "2026-09-01", "tournament": "Serie B"}]

    db.session = _PostSession([504, 504, 200])
    ok &= check("504 дважды, потом 200 — запись прошла",
                db.upsert("player_match_stats", row, "card_id"), 1)
    ok &= check("и повтор был настоящим", db.session.calls, 3)

    # ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ ПЕРВЫЙ: повтор не бывает вечным.
    db.session = _PostSession([504])
    raised = False
    try:
        db.upsert("player_match_stats", row, "card_id")
    except RuntimeError:
        raised = True
    ok &= check("три 504 подряд всё равно падают", raised, True)

    # ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ ВТОРОЙ, И ОН ВАЖНЕЕ: 4xx повторять НЕЛЬЗЯ.
    # «Пачку рассмотрели и отвергли» — 409 на дубликате повторится столько раз,
    # сколько его послать, и прогон только прождёт вдвое дольше.
    db.session = _PostSession([409])
    raised = False
    try:
        db.upsert("player_match_stats", row, "card_id")
    except RuntimeError:
        raised = True
    ok &= check("409 падает сразу", raised, True)
    ok &= check("409 не повторяется", db.session.calls, 1)

    # Пустая пачка ничего не пишет и никуда не ходит.
    db.session = _PostSession([500])
    ok &= check("пустая пачка — ноль", db.upsert("player_match_stats", [], "card_id"), 0)
    ok &= check("пустая пачка не ходит в сеть", db.session.calls, 0)
    return ok


class _KilledMidPass(BaseException):
    """Процесс сняли. BaseException — чтобы `except RuntimeError` не поймал."""


class _FakeDb:
    """База, помнящая записи. Возвращает по префиксу адреса."""

    def __init__(self, cards):
        self._cards = cards
        self.select_no_slug = []   # что уже лежит в sports_ru_no_slug
        self.upserts = []          # (таблица, [строки])
        self.deletes = []          # (таблица, колонка, [значения])

    def select(self, path):
        if path.startswith("/cards?"):
            return list(self._cards)
        if path.startswith("/card_current_club?"):
            return [{"card_id": c["id"]} for c in self._cards]
        if path.startswith("/sports_ru_player?"):
            return []
        if path.startswith("/sports_ru_no_slug?"):
            return list(self.select_no_slug)
        raise AssertionError("незнакомый select: {}".format(path))

    def upsert(self, table, rows, key):
        self.upserts.append((table, list(rows)))
        return len(rows)

    def delete_in(self, table, column, values):
        self.deletes.append((table, column, list(values)))
        return len(values)

    def misses_written(self):
        return sum(len(rows) for t, rows in self.upserts if t == "sports_ru_no_slug")


class _FakeFetcher:
    """Каждая догадка — промах. После `die_after` страниц процесс снимают."""

    def __init__(self, die_after=None, budget=10 ** 6):
        self.count = 0
        self.die_after = die_after
        self.budget = budget

    @property
    def remaining(self):
        return max(0, self.budget - self.count)

    def get(self, url):
        self.count += 1
        if self.die_after is not None and self.count > self.die_after:
            raise _KilledMidPass(url)
        return None  # ни клубов, ни страниц игроков — все догадки мимо


def _cards(n):
    return [{"id": "c{:04d}".format(i), "name": "Иван Петров {}".format(i),
             "name_en": "Ivan Petrov {}".format(i)} for i in range(n)]


def test_guess_pass_flushes_before_the_end():
    """Проход отдаёт отметки об отказе ПО ХОДУ, а не одним залпом в конце.

    ⚠️ ЭТО ПРО СНЯТЫЙ ПРОЦЕСС, А НЕ ПРО АККУРАТНОСТЬ. Пока весь список копился
    в памяти до последней строки цикла, прогон, убитый на середине —
    `timeout-minutes: 180`, падение, снятый контейнер, — не записывал НИ ОДНОЙ
    отметки. А очередь кандидатов строится ИМЕННО по ним: без записи следующей
    ночью перебираются те же первые сотни карточек, и двадцать тысяч
    остальных не пробуются никогда. Ровно эту поломку таблица и чинила.
    """
    print(" guess_pass_flush")
    ok = True

    # Полный проход: 450 карточек, пачка 200. Отметки доходят все.
    db = _FakeDb(_cards(450))
    resolve_slugs(_FakeFetcher(), db, guess=True, reserve=0)
    ok &= check("полный проход записал все отказы", db.misses_written(), 450)

    # Тот же проход, но процесс снят на 250-й карточке. Страниц на карточку
    # СЧИТАЕМ, а не пишем числом: все кандидаты дают 404, значит перебираются
    # все, и захардкоженное «одна страница» разошлось бы с кодом молча.
    # Ни одной карточки ещё не пробовали, значит заход первый и форм у него
    # `FIRST_PASS_CANDIDATES`, а не сколько их вообще.
    per_card = min(len(list(slug_candidates(_cards(1)[0]["name_en"]))),
                   FIRST_PASS_CANDIDATES)
    die_at = len(SEED_CLUBS) + 250 * per_card

    db = _FakeDb(_cards(450))
    killed = False
    try:
        resolve_slugs(_FakeFetcher(die_after=die_at), db, guess=True, reserve=0)
    except _KilledMidPass:
        killed = True
    ok &= check("процесс действительно снят", killed, True)
    ok &= check("снятый на середине успел записать 200", db.misses_written(), 200)

    # ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: та же проверка против прежнего поведения —
    # накопить всё и записать в конце — обязана упасть. Иначе она пустая.
    class _HoardingDb(_FakeDb):
        def upsert(self, table, rows, key):
            if table == "sports_ru_no_slug":
                return len(rows)  # «записали» в конце, то есть никуда
            return super().upsert(table, rows, key)

    db = _HoardingDb(_cards(450))
    try:
        resolve_slugs(_FakeFetcher(die_after=die_at), db, guess=True, reserve=0)
    except _KilledMidPass:
        pass
    ok &= check("контроль: копящая база теряет всё", db.misses_written(), 0)
    return ok


class _CountingFetcher:
    """Считает запрошенные адреса. Отвечает страницей только на `answers`."""

    def __init__(self, answers=None, budget=10 ** 6):
        self.answers = answers or {}
        self.asked = []
        self.count = 0
        self.budget = budget

    @property
    def remaining(self):
        return max(0, self.budget - self.count)

    def get(self, url):
        self.count += 1
        self.asked.append(url.rsplit("/football/person/", 1)[-1].strip("/"))
        return self.answers.get(self.asked[-1])


def test_rare_name_forms_are_deferred_not_dropped():
    """Первый заход берёт частые формы, второй — все.

    ⚠️ ПРОВЕРЯЕТСЯ ИМЕННО «ОТЛОЖЕНО», А НЕ «ДЁШЕВО». Урезать перебор до двух
    форм насовсем значило бы потерять бразильцев, играющих под именем:
    «Vinícius Júnior» лежит на `/football/person/vinicius/`, а это ЧЕТВЁРТАЯ
    форма. Дешевизна первого обхода не стоит самых известных карточек, так что
    редкая форма обязана доставаться карточке на повторном заходе.
    """
    print(" rare_forms_deferred")
    ok = True

    vini = {"id": "v", "name": "Винисиус Жуниор", "name_en": "Vinicius Junior"}
    forms = list(slug_candidates(vini["name_en"]))
    # Позиция НЕ числом: `slug_candidates` выбрасывает совпавшие формы, и у
    # «Vinicius Junior» их три, а не четыре. Важно одно — голое имя лежит ЗА
    # порогом первого захода, иначе проверка ниже ничего не проверяет.
    ok &= check("голое имя — за порогом первого захода",
                forms.index("vinicius") + 1 > FIRST_PASS_CANDIDATES, True)

    page = '<h1>Винисиус Жуниор</h1><span>Vinicius Junior</span>'

    # Первый заход: две формы, страница не найдена, но и не запрошена.
    f = _CountingFetcher({"vinicius": page})
    got = resolve_by_name(f, vini, max_candidates=_candidate_budget(0))
    ok &= check("первый заход не нашёл", got, None)
    ok &= check("первый заход — две страницы", f.count, FIRST_PASS_CANDIDATES)
    ok &= check("голое имя ещё не спрашивали", "vinicius" in f.asked, False)

    # Второй заход: форм больше нет ограничения, страница найдена.
    f = _CountingFetcher({"vinicius": page})
    got = resolve_by_name(f, vini, max_candidates=_candidate_budget(1))
    ok &= check("второй заход нашёл", got, "vinicius")
    ok &= check("голое имя спрошено", "vinicius" in f.asked, True)

    # ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: если бюджет второго захода тоже урезать, форма
    # теряется — то есть проверка выше смотрит на настоящую разницу.
    f = _CountingFetcher({"vinicius": page})
    ok &= check("контроль: урезанный второй заход теряет форму",
                resolve_by_name(f, vini, max_candidates=FIRST_PASS_CANDIDATES), None)

    # И весь проход целиком: карточка с отметкой о промахе получает все формы.
    db = _FakeDb([vini])
    db.select_no_slug = [{"card_id": "v", "tried_at": "2026-09-01T00:00:00Z", "tries": 1}]
    f = _CountingFetcher({"vinicius": page})
    resolve_slugs(f, db, guess=True, reserve=0)
    ok &= check("проход дошёл до голого имени", "vinicius" in f.asked, True)
    ok &= check("и стёр отметку о промахе",
                [d for d in db.deletes if d[0] == "sports_ru_no_slug"] != [], True)
    return ok


def main():
    print("test_sports_ru_stats.py")
    ok = test_active_cards_by_key()
    ok = test_guess_order() and ok
    ok = test_guess_pass_flushes_before_the_end() and ok
    ok = test_rare_name_forms_are_deferred_not_dropped() and ok
    ok = test_select_survives_a_dropped_connection() and ok
    ok = test_keyset_column() and ok
    ok = test_select_pages_by_key_not_offset() and ok
    ok = test_select_retries_a_gateway_timeout() and ok
    ok = test_upsert_retries_a_gateway_timeout() and ok
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
