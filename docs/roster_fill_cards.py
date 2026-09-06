# -*- coding: utf-8 -*-
"""Заполнить карточки данными из состава — позиция, стоимость, страна, клуб.

ЗАЧЕМ ОТДЕЛЬНЫМ ШАГОМ. Ночной обход умел две вещи: СВЯЗАТЬ ростер с колодой
(`roster_link_cards.py`) и ЗАВЕСТИ карточку тому, кого в колоде нет
(`cards_from_roster.py`). Заполнения не было ни в одном — то есть каждую ночь
заводились карточки, у которых в досье пусто ВСЁ, а данные лежали рядом, в
`club_roster`, снятые с той же страницы.

Замер 06.09.2026, до этого шага: активных игроков 19 115, из них с позицией
15 609, со стоимостью 13 561. После вызова тех же двух функций руками —
9218 позиций, 8656 стоимостей и 12 491 текущий клуб за один прогон. Ровно это
владелец и увидел в проде: «игроков я в проде увидел, их нужно заполнить
данными и стоимостью».

⚠️ СЧИТАЕТ И СОПОСТАВЛЯЕТ SQL, А НЕ ЭТОТ ФАЙЛ. Здесь нет ни одного правила:
скрипт зовёт `fill_cards_from_roster()` и `fill_current_club_from_roster()` и
печатает их числа. Вторая копия правила «какую строку ростера считать
однозначной» разошлась бы с первой молча — этим проектом уже проверено.

⚠️ ПОРЯДОК В НОЧНОМ ОБХОДЕ ВАЖЕН: связать → завести → ЗАПОЛНИТЬ. Заполнение
идёт по `club_roster.card_id`, поэтому до заведения карточек ему нечего
делать.

Обе функции идемпотентны и пишут ТОЛЬКО пустое: собранное другими путями
точнее, и перезапись более свежего менее свежим — не починка.

ЗАПУСК (сухого прогона нет — вызов и есть запись; обе функции безопасны):
    python docs/roster_fill_cards.py
"""
import json
import os
import urllib.request


def sb_rpc(name):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/" + name
    key = os.environ["SUPABASE_KEY"]
    req = urllib.request.Request(url, data=b"{}", method="POST", headers={
        "apikey": key, "Authorization": "Bearer " + key,
        "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as fh:
        raw = fh.read()
    return json.loads(raw) if raw else []


def main():
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY")):
        raise SystemExit("нужны SUPABASE_URL и SUPABASE_KEY (служебный ключ)")

    fill = (sb_rpc("fill_cards_from_roster") or [{}])[0]
    print("Заполнено из состава: позиций %d, стоимостей %d, стран %d"
          % (fill.get("position_set", 0), fill.get("value_set", 0),
             fill.get("country_set", 0)), flush=True)

    club = (sb_rpc("fill_current_club_from_roster") or [{}])[0]
    # ⚠️ ОТКАЗ ПЕЧАТАЕТСЯ, А НЕ ГЛОТАЕТСЯ. Игрок в двух заявках (аренда) клуба
    # не получает вовсе: «какой-нибудь» клуб на карточке хуже, чем никакой —
    # по нему отбирается состав в игре.
    print("Текущий клуб: записано %d, отказано по двум заявкам %d"
          % (club.get("written", 0), club.get("ambiguous", 0)), flush=True)


if __name__ == "__main__":
    main()
