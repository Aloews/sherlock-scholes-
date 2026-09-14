#!/usr/bin/env python3
"""Связать игроков Soccer Wiki с карточками по КЛУБУ и ДАТЕ РОЖДЕНИЯ.

⚠️ ПО ИМЕНИ ЭТО НЕ РЕШАЕТСЯ, И ЭТО ПРОВЕРЕНО. `link_soccerwiki_by_name`
сверяет имя точно, а Soccer Wiki пишет фамилию первой и склеивает:

    «Júnior Neymar»   → Neymar
    «Jorge Koke»      → Koke
    «Alarcón Isco»    → Isco
    «Frello Jorginho» → Жоржиньо
    «Pascal Gross»    → «Pascal Groß»     (ß)
    «Lukáš Hrádecký»  → «Lukas Hradecky»  (диакритика)

Совпадений по последнему слову 1952, а подтверждённых клубом из них 231 —
остальное однофамильцы, и связывать их значило бы приписать игроку чужую
статистику.

ЧТО РАБОТАЕТ: клуб И дата рождения, причём даты приходят из ДВУХ НЕЗАВИСИМЫХ
источников — Transfermarkt (`club_roster`) и Soccer Wiki. Замер на первых 291
строке с датой: 242 связались однозначно, 2 отвергнуты как неоднозначные.

⚠️ ШАГ БЕСПОЛЕЗЕН БЕЗ ЧТЕНИЯ СТРАНИЦ ИГРОКОВ. Дата рождения появляется только
там; запускать его надо СРАЗУ ПОСЛЕ `soccerwiki_players.py`.

    python3 docs/soccerwiki_link_by_birth.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _sb import sb  # noqa: E402


def main() -> int:
    res = sb("rpc/link_soccerwiki_by_birth", method="POST", body={})
    row = (res or [{}])[0] if isinstance(res, list) else {}
    linked = row.get("linked")
    amb = row.get("ambiguous")
    print(f"связано по клубу и дате рождения: {linked}, неоднозначных: {amb}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
