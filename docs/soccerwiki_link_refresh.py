# -*- coding: utf-8 -*-
"""Пересвязать составы Soccer Wiki с колодой и разнести рейтинг по карточкам.

ТРИ ШАГА, И ПОРЯДОК У НИХ ОБЯЗАТЕЛЬНЫЙ:

    1) fill_current_club_resolved_key()  ключ «карточка → клуб»
    2) link_soccerwiki_cards()           состав источника → карточки
    3) fill_sw_rating()                  рейтинг источника → cards.sw_rating
    4) fill_photo_from_soccerwiki()      портрет источника → cards.photo_url

По умолчанию выполняются все четыре шага. Для фото-конвейера используется
--skip-photo-fill: фотографии проходят через очередь, проверку URL и
read-after-write, а не записываются напрямую без проверки доступности.

ЗАПУСК:
    python docs/soccerwiki_link_refresh.py
    python docs/soccerwiki_link_refresh.py --skip-photo-fill
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _sb import sb  # общий транспорт: с повторами на обрыве

STEPS = [
    ("fill_current_club_resolved_key", "ключей «карточка → клуб» проставлено"),
    ("link_soccerwiki_cards",          "игроков связано с колодой"),
    ("fill_sw_rating",                 "карточек получили рейтинг источника"),
    ("fill_photo_from_soccerwiki",     "карточек получили портрет источника"),
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


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-photo-fill",
        action="store_true",
        help="leave photo writes to the verified profile backfill queue",
    )
    args = parser.parse_args(argv)
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY")):
        raise SystemExit("SUPABASE_URL/SUPABASE_KEY не заданы")
    steps = STEPS[:-1] if args.skip_photo_fill else STEPS
    failed = 0
    for name, what in steps:
        res = sb("rpc/" + name, method="POST", body={})
        n = number(res)
        if n is None:
            print("✗ %-34s ОТКАЗ" % name, flush=True)
            failed += 1
        else:
            print("✓ %-34s %s: %d" % (name, what, n), flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
