"""Выбор клуба среди кандидатов Викиданных (offline, без сети и базы).

Покрывает pick() из docs/clubs_transfermarkt_id_wikidata.py — правило, по
которому клуб получает мост на Transfermarkt.

⚠️ Проверяется НАСТОЯЩАЯ функция, а не её копия: копия в тесте проверяет
копию (так уже было в test_title_match.py).

Кандидаты — это выдача Викиданных, УЖЕ отобранная по наличию P7223. Сам
отбор и есть гард: сущность с идентификатором клуба на Transfermarkt —
клуб на Transfermarkt по определению, и списка P31 вести не надо.

    python3 tests/test_club_bridge_pick.py
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_spec = importlib.util.spec_from_file_location(
    "clubs_transfermarkt_id_wikidata",
    os.path.join(ROOT, "docs", "clubs_transfermarkt_id_wikidata.py"))
cb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cb)

FAILURES = []


def tm(hit):
    """id из кандидата, или понятная метка вместо падения по типу.

    Сломанное правило обязано давать внятный отчёт: тест, роняющий
    TypeError, краснеет, но не говорит ЧТО именно сломалось.
    """
    return hit[2] if hit else "(кандидат не выбран)"


def label(hit):
    return hit[1] if hit else "(кандидат не выбран)"


def check(name, got, want):
    if got != want:
        FAILURES.append("%s\n    ожидалось: %r\n    получено : %r" % (name, want, got))


# Настоящая выдача 05.09.2026, а не выдуманная.
# Четвёртое поле — «производная команда»: P361 («часть чего») у молодёжки и
# резерва стоит, у основной команды его нет. Замерено на Q172969/Q131388941.
KOLN = [("Q104770", "1. FC Köln", "3", False)]
ANGERS = [("Q845137", "Angers SCO", "1420", False),
          ("Q109500461", "Angers SCO II", "16672", True)]
PLZEN = [("Q182281", "FC Viktoria Plzeň", "1200", False),
         ("Q12047031", "FC Viktoria Plzeň B", "50961", False)]
SHAKHTAR = [("Q172969", "Шахтёр", "660", False),
            ("Q131388941", "Шахтёр (до 19 лет)", "14300", True)]
HILAL = [("Q73965", "Аль-Хиляль", "1114", False),
         ("Q284461", "Аль-Хиляль", "8430", False),
         ("Q987240", "Аль-Хиляль", "101315", False)]

hit, why = cb.pick("1. FC Köln", KOLN)
check("единственный кандидат берётся", tm(hit), "3")
check("и причина названа", why, "один кандидат")

hit, why = cb.pick("Angers SCO", ANGERS)
check("резервная команда отсеяна структурно, а не по имени", tm(hit), "1420")
check("и это сказано вслух", "отсеяно производных: 1" in why, True)

# ⚠️ ГЛАВНЫЙ СЛУЧАЙ РУССКОГО ПУТИ. Ярлык «Шахтёр» НЕ равен нашему «Шахтёр
# Донецк», поэтому одно только точное равенство здесь отказало бы. Спасает
# именно отсев по P361: после него кандидат остаётся один.
hit, why = cb.pick("Шахтёр Донецк", SHAKHTAR)
check("молодёжка отсеяна, основная команда взята", tm(hit), "660")
check("хотя точного равенства ярлыка НЕТ", label(hit) != "Шахтёр Донецк", True)

# ⚠️ ТРИ РАЗНЫХ КЛУБА С ОДНИМ ИМЕНЕМ — отказ, и это правильный ответ.
hit, why = cb.pick("Аль-Хиляль", HILAL)
check("три однофамильца — не берём ни одного", hit, None)
check("и отказ назван числом", why.startswith("ОТКАЗ: кандидатов 3"), True)

# ⚠️ Регистр не должен решать: у ESPN и Викиданных он расходится.
hit, _ = cb.pick("angers sco", ANGERS)
check("регистр не решает", tm(hit), "1420")

hit, why = cb.pick("Viktoria Plzeň", PLZEN)
check("нет точного совпадения — НЕ БЕРЁМ НИЧЕГО", hit, None)
check("и отказ назван числом", why, "ОТКАЗ: кандидатов 2, точных 0")

hit, why = cb.pick("Somebody FC", [])
check("пустая выдача — не мост", hit, None)
check("причина отличает пустоту от неоднозначности", why, "нет кандидата с P7223")

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ. Снимаем требование точного равенства — и
# «Плзень» немедленно получает мост резервной команды. Если проверка этого
# не заметит, она пустая.
_real = cb.pick
try:
    cb.pick = lambda name, cands: ((cands[0], "СЛОМАНО") if cands else (None, "нет"))
    hit, _ = cb.pick("Viktoria Plzeň", PLZEN)
    check("контроль: без правила берётся ПЕРВЫЙ попавшийся", tm(hit), "1200")
    hit, _ = cb.pick("Шахтёр Донецк", SHAKHTAR)
    check("контроль: и «Шахтёр» тоже берётся наугад", tm(hit), "660")
finally:
    cb.pick = _real

hit, why = cb.pick("Viktoria Plzeň", PLZEN)
check("после контроля правило снова отказывает", hit, None)

if FAILURES:
    print("ПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("test_club_bridge_pick: OK")
