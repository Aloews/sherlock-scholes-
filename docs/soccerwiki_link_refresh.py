# -*- coding: utf-8 -*-
"""Пересвязать составы Soccer Wiki с колодой и разнести рейтинг по карточкам.

ТРИ ШАГА, И ПОРЯДОК У НИХ ОБЯЗАТЕЛЬНЫЙ:

    1) fill_current_club_resolved_key()  ключ «карточка → клуб»
    2) link_soccerwiki_cards()           состав источника → карточки колоды
    3) fill_sw_rating()                  рейтинг источника → cards.sw_rating

⚠️ ПЕРВЫЙ ШАГ — НЕ ПРО SOCCER WIKI, И ИМЕННО ПОЭТОМУ ОН ЗДЕСЬ ПЕРВЫЙ.
Связывание идёт `card_current_club.resolved_key = soccerwiki_club.club_key`.
07.09.2026 оказалось, что `resolved_key` пуст у 23 548 строк из 24 807:
`fill_current_club_from_roster()` не писал эту колонку вовсе. Пока она пуста,
шаг 2 находит четверть того, что мог бы, — и находит МОЛЧА.

⚠️ ВТОРОЙ ШАГ НУЖЕН ОТДЕЛЬНО ОТ СБОРА. `apply_soccerwiki_squad` связывает в
момент записи клуба, то есть по состоянию колоды на тот момент. Всё, что
появилось позже — новая карточка, доехавший `name_en`, починенный ключ, —
остаётся несвязанным навсегда: клуб уже записан и второй раз не пишется.

⚠️ ТРЕТИЙ ШАГ НЕ ЗАПУСКАЛСЯ ПОСЛЕ СБОРА НИ РАЗУ. Замер 07.09.2026: связано
13 129 игроков, а рейтинг стоял у 6301 карточки — ровно столько, сколько было
на день, когда `fill_sw_rating` звали руками.

Пишет ВСЕГДА (это три идемпотентные функции базы, каждая — одна транзакция),
поэтому APPLY здесь не спрашивается: сухого варианта у него нет.

ЗАПУСК:
    python docs/soccerwiki_link_refresh.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _sb import sb  # общий транспорт: с повторами на обрыве

STEPS = [
    ("fill_current_club_resolved_key", "ключей «карточка → клуб» проставлено"),
    ("link_soccerwiki_cards",          "игроков связано с колодой"),
    ("fill_sw_rating",                 "карточек получили рейтинг источника"),
]


def number(res):
    """Число из ответа RPC, каким бы он ни пришёл. ЧИСТАЯ ФУНКЦИЯ."""
    if isinstance(res, (int, float)):
        return int(res)
    if isinstance(res, list) and res:
        first = res[0]
        if isinstance(first, dict):
            for v in first.values():
                if isinstance(v, (int, float)):
                    return int(v)
        elif isinstance(first, (int, float)):
            return int(first)
    if isinstance(res, dict):
        for v in res.values():
            if isinstance(v, (int, float)):
                return int(v)
    return None


def main():
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY")):
        raise SystemExit("SUPABASE_URL/SUPABASE_KEY не заданы")
    failed = 0
    for name, what in STEPS:
        res = sb("rpc/" + name, method="POST", body={})
        n = number(res)
        if n is None:
            # ⚠️ ОТКАЗ НАЗЫВАЕТСЯ ОТКАЗОМ. Молчаливый пропуск шага выглядит на
            # экране так же, как «связывать было нечего», а это разные ответы.
            print("✗ %-34s ОТКАЗ" % name, flush=True)
            failed += 1
        else:
            print("✓ %-34s %s: %d" % (name, what, n), flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
