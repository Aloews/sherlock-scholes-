"""Сопоставление названия карточки со статьёй ru-вики — БЕЗ СЕТИ.

    python3 tests/test_title_match.py

ЗАЧЕМ ЭТОТ ФАЙЛ. Порог difflib 0.85 отбрасывал ПРАВИЛЬНЫЕ статьи, и снаружи
это выглядело как «статьи нет»: ру-вики называет людей «Фамилия, Имя
Отчество», в колоде лежит «Имя Фамилия», и лишнее слово роняет ratio. Замер на
боевых карточках, из отчёта о наполнении описаний:

    «Александр Зотов»   → «Зотов, Александр Владимирович»  0.700
    «Нобель Арустамян»  → «Арустамян, Нобель Эдуардович»   0.750
    «Иван Комаров»      → «Комаров, Иван Сергеевич»        0.710
    «Владислав Яковлев» → «Яковлев, Владислав Геннадьевич» 0.744
    «Кристофер Мартинс» → «Мартинс Перейра, Кристофер»     0.821

Все пять статей верные. Тест держит и обратную сторону: порог НЕ снижен, и
чужой человек по-прежнему не подходит.
"""
import os
import sys
from difflib import SequenceMatcher

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import run  # noqa: E402


class _Search:
    """Ру-вики, которая на любой запрос отдаёт один заранее заданный заголовок.

    Нужна затем, чтобы проверять НАСТОЯЩУЮ search_close_titles, а не её копию.
    Первая версия этого теста повторяла три сравнения у себя — и разошлась с
    оригиналом на первом же случае: забыла гард по уточнению в скобках, из-за
    чего «Халк» подошёл к «Халк (персонаж)». Копия логики в тесте проверяет
    копию, а не код.
    """
    def __init__(self, title):
        self.title = title

    def search_titles(self, name, limit):
        return [self.title]


def matches(card_name, title, category="player"):
    """Подойдёт ли статья карточке — по настоящему пути резолвера."""
    return search_close_titles_result(card_name, title, category) != []


def search_close_titles_result(card_name, title, category="player"):
    return run.search_close_titles(_Search(title), card_name, category)


def check(label, got, want):
    status = "ok " if got == want else "FAIL"
    print("  [{}] {}: got={!r} want={!r}".format(status, label, got, want))
    return got == want


def main():
    ok = True

    print("Отчество и вторая фамилия больше не отбрасывают верную статью")
    for card, title in [
        ("Александр Зотов",   "Зотов, Александр Владимирович (футболист)"),
        ("Нобель Арустамян",  "Арустамян, Нобель Эдуардович"),
        ("Иван Комаров",      "Комаров, Иван Сергеевич"),
        ("Владислав Яковлев", "Яковлев, Владислав Геннадьевич"),
        ("Кристофер Мартинс", "Мартинс Перейра, Кристофер"),
    ]:
        ok &= check("{} → {}".format(card, title), matches(card, title), True)

    print("\nПорог НЕ снижен: чужой человек не подходит")
    # Совпала фамилия и отчество, а имя — нет. Это другой человек, и подпустить
    # его к карточке значило бы приписать ей чужую биографию.
    ok &= check("Иван Комаров ↛ Комаров, Пётр Сергеевич",
                matches("Иван Комаров", "Комаров, Пётр Сергеевич"), False)
    ok &= check("Александр Зотов ↛ Зотов, Дмитрий Иванович",
                matches("Александр Зотов", "Зотов, Дмитрий Иванович"), False)

    print("\nОдносложная карточка не подходит ни к кому")
    # «Нино», «Халк», «Оскар» — играющее имя бразильца. Подмножество из одного
    # слова нашлось бы в любой статье, где это слово вообще есть.
    ok &= check("Нино ↛ Нино Бурджанадзе",
                matches("Нино", "Нино Бурджанадзе"), False)
    ok &= check("Халк ↛ Халк (персонаж)",
                matches("Халк", "Халк (персонаж)"), False)

    print("\nПрежнее поведение сохранено")
    # Этот случай назван в комментарии к SEARCH_MATCH_RATIO и работал до правки.
    ok &= check("Садьо Мане → Мане, Садио",
                matches("Садьо Мане", "Мане, Садио"), True)

    print("\nПричины отказа названы по отдельности, а не одной строкой")
    # Три разные поломки требуют трёх разных решений: чинить резолв названия,
    # уточнять имя карточки или ослаблять гард. Одно сообщение на три причины
    # не даёт выбрать ни одного.
    ok &= check("три разных кода", len({run.FAIL_NO_ARTICLE, run.FAIL_DISAMBIG,
                                        run.FAIL_P31}), 3)

    class _Resolver:
        """Ру-вики, у которой на всё есть страница неоднозначности."""
        def qid_for_title(self, title):
            return {"disambig": True}

        def search_titles(self, name, limit):
            return []

    reasons = []
    qid, _t, _s = run.resolve_card_qid(
        _Resolver(), {"name": "Зотов", "category": "player"}, ["Зотов"],
        None, reasons)
    ok &= check("дизамбиг назван дизамбигом", (qid, reasons),
                (None, [run.FAIL_DISAMBIG]))

    class _Missing(_Resolver):
        def qid_for_title(self, title):
            return {}

    reasons = []
    run.resolve_card_qid(_Missing(), {"name": "Нет", "category": "player"},
                         ["Нет"], None, reasons)
    ok &= check("отсутствие статьи названо отсутствием", reasons,
                [run.FAIL_NO_ARTICLE])

    class _WrongKind(_Resolver):
        def qid_for_title(self, title):
            return {"qid": "Q1"}

    reasons = []
    run.resolve_card_qid(_WrongKind(), {"name": "Эмилио", "category": "player"},
                         ["Эмилио"], lambda _q: False, reasons)
    ok &= check("отбраковка гардом названа гардом", reasons, [run.FAIL_P31])

    print("\n{}".format("ALL TESTS PASSED" if ok else "SOME TESTS FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
