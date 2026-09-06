# -*- coding: utf-8 -*-
"""Разбор истории трансферов: сумма, id клуба, записи.

Данные взяты С ЖИВОГО ОТВЕТА 06.09.2026 (Леон Классен, id 441987) — того
самого игрока, с которого началась проверка.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name):
    path = os.path.join(HERE, "..", "..", "docs", name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


tr = _load("players_transfers_transfermarkt")
ok = 0


def check(cond, what):
    global ok
    if cond:
        ok += 1
        return
    print("ПРОВАЛ: %s" % what)
    sys.exit(1)


# --- сумма ----------------------------------------------------------------
check(tr.parse_fee("€100k") == 100_000, "тысячи")
check(tr.parse_fee("€18.50m") == 18_500_000, "миллионы с дробью")
check(tr.parse_fee("€1.20bn") == 1_200_000_000, "миллиарды")
check(tr.parse_fee("€600k") == 600_000, "стоимость Классена")

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ, И ОН ГЛАВНЫЙ. Ноль означал бы «перешёл
# бесплатно» — это ДРУГОЕ утверждение, чем «сумма неизвестна», и по нулям
# потом считали бы средние.
for text in ("loan transfer", "End of loan", "free transfer", "?", "", None):
    check(tr.parse_fee(text) is None, "«%s» — не число, а None" % (text,))

# --- id клуба -------------------------------------------------------------
check(tr.club_tm_id("/darmstadt-98/transfers/verein/105/saison_id/2026") == "105",
      "id клуба из ссылки")
check(tr.club_tm_id("/x/startseite") is None, "ссылка без verein — None")
check(tr.club_tm_id(None) is None, "пусто — None")

# --- записи ---------------------------------------------------------------
PAYLOAD = {"transfers": [
    {"url": "/leon-klassen/transfers/spieler/441987/transfer_id/6415187",
     "from": {"clubName": "Darmstadt 98", "href": "/darmstadt-98/transfers/verein/105/saison_id/2026"},
     "to": {"clubName": "Grazer AK 1902", "href": "/grazer-ak-1902/transfers/verein/316/saison_id/2026"},
     "dateUnformatted": "2026-07-09", "season": "26/27",
     "marketValue": "€600k", "fee": "€100k"},
    {"url": "/leon-klassen/transfers/spieler/441987/transfer_id/6000000",
     "from": {"clubName": "Grazer AK 1902", "href": "/x/verein/316"},
     "to": {"clubName": "Darmstadt 98", "href": "/x/verein/105"},
     "dateUnformatted": "2026-06-30", "season": "25/26",
     "marketValue": "€600k", "fee": "End of loan"},
]}
rows = tr.parse_transfers(PAYLOAD)
check(len(rows) == 2, "обе записи разобраны")
check(rows[0]["transfer_id"] == "6415187", "id перехода из ссылки")
check(rows[0]["moved_on"] == "2026-07-09" and rows[0]["fee_eur"] == 100_000,
      "дата и сумма первой записи")
check(rows[0]["from_tm_id"] == "105" and rows[0]["to_tm_id"] == "316", "id клубов")
# «End of loan» — строка сохраняется, число пустое.
check(rows[1]["fee_eur"] == "" and rows[1]["fee_text"] == "End of loan",
      "аренда: текст есть, суммы нет")

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: запись без id перехода не берётся наугад.
check(tr.parse_transfers({"transfers": [{"url": "/no-id-here"}]}) == [],
      "запись без transfer_id пропускается")
check(tr.parse_transfers({}) == [] and tr.parse_transfers(None) == [],
      "пусто — не история")

print("test_transfer_parse: OK (%d проверок)" % ok)
