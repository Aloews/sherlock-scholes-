# -*- coding: utf-8 -*-
"""Ревизия QID: разбор родов занятий и приговор. Без сети."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "docs"))
from cards_qid_audit import occupations, verdict  # noqa: E402

FAILED = []


def check(name, got, want):
    if got != want:
        FAILED.append("%s: ожидалось %r, получено %r" % (name, want, got))
        print("✗ %s" % name)
    else:
        print("✓ %s" % name)


def claim(qid):
    return {"mainsnak": {"datavalue": {"value": {"id": qid}}}}


payload = {"entities": {
    "Q1": {"claims": {"P106": [claim("Q937857")]}},                    # футболист
    "Q2": {"claims": {"P106": [claim("Q33999"), claim("Q10800557")]}}, # актёр
    "Q3": {"claims": {}},                                              # без P106
    "Q4": {"claims": {"P106": [claim("Q82955"), claim("Q937857")]}},   # политик И футболист
}}
occ = occupations(payload)
check("футболист разобран", occ["Q1"], {"Q937857"})
check("несколько занятий разобраны", occ["Q2"], {"Q33999", "Q10800557"})
check("без P106 — пустое множество", occ["Q3"], set())

check("футболист — ok", verdict(occ["Q1"]), "ok")
check("актёр — не футболист", verdict(occ["Q2"]), "not_footballer")

# ⚠️ ГЛАВНАЯ ПРОВЕРКА. «Род занятий не указан» и «указан, и это не футболист» —
# разные утверждения. Склеить их значит снять QID у всех малоизвестных
# футболистов, у которых Викиданные просто неполны, — то есть сломать больше,
# чем починить.
check("пустой род занятий — НЕ приговор, а «не знаем»", verdict(occ["Q3"]), "unknown")
check("QID не отвечал — «не знаем», а не «не футболист»", verdict(None), "unknown")

# Футболист, который ещё и политик, остаётся футболистом.
check("футболист среди прочих занятий — ok", verdict(occ["Q4"]), "ok")

check("мусор вместо ответа не роняет разбор", occupations(None), {})
check("нет entities — пусто", occupations({}), {})
broken = {"entities": {"Q9": {"claims": {"P106": [{"mainsnak": {}}]}}}}
check("клейм без значения пропускается", occupations(broken)["Q9"], set())

print()
if FAILED:
    print("ПРОВАЛЕНО: %d" % len(FAILED))
    for f in FAILED:
        print(" ", f)
    sys.exit(1)
print("test_qid_audit: OK")
