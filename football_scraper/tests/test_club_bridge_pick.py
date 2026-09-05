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


def check(name, got, want):
    if got != want:
        FAILURES.append("%s\n    ожидалось: %r\n    получено : %r" % (name, want, got))


# Настоящая выдача 05.09.2026, а не выдуманная.
KOLN = [("Q104770", "1. FC Köln", "3")]
ANGERS = [("Q845137", "Angers SCO", "1420"),
          ("Q109500461", "Angers SCO II", "16672")]
PLZEN = [("Q182281", "FC Viktoria Plzeň", "1200"),
         ("Q12047031", "FC Viktoria Plzeň B", "50961")]

hit, why = cb.pick("1. FC Köln", KOLN)
check("единственный кандидат берётся", hit[2], "3")
check("и причина названа", why, "один кандидат")

hit, why = cb.pick("Angers SCO", ANGERS)
check("ничья решается ТОЧНЫМ равенством ярлыка", hit[2], "1420")
check("резервная команда не выигрывает", hit[1], "Angers SCO")

# ⚠️ Регистр не должен решать: у ESPN и Викиданных он расходится.
hit, _ = cb.pick("angers sco", ANGERS)
check("равенство ярлыка без учёта регистра", hit[2], "1420")

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
    check("контроль: без правила берётся ПЕРВЫЙ попавшийся", hit[2], "1200")
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
