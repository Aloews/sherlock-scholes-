# -*- coding: utf-8 -*-
"""Разбор страниц Soccer Wiki: страны, клубы, состав.

Разметка взята С ЖИВЫХ СТРАНИЦ 06.09.2026 и урезана до одной строки каждого
вида. Порядок ячеек состава именно такой и замерен на «Арсенале»:

    0 номер | 1 пусто | 2 флаг | 3 имя | 4 позиция | 5 возраст | 6 рейтинг
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


sw = _load("soccerwiki_squads")
ok = 0


def check(cond, what):
    global ok
    if cond:
        ok += 1
        return
    print("ПРОВАЛ: %s" % what)
    sys.exit(1)


COUNTRIES = '''
<a href="/country.php?countryId=ARG" class="x">Argentina</a>
<a href="/country.php?countryId=ENG">England</a>
<a href="/country.php?countryId=ENG">England</a>
<a href="/league.php?leagueid=28">Premier League</a>
'''
got = sw.parse_countries(COUNTRIES)
check(got == [("ARG", "Argentina"), ("ENG", "England")], "страны разобраны и без повторов")
# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: ссылка на лигу — не страна.
check(all(code != "28" for code, _ in got), "лига страной не считается")
check(sw.parse_countries("") == [], "пусто — не страна")

CLUBS = '''
<a href="/squad.php?clubid=9">AFC Bournemouth</a>
<a href="/squad.php?clubid=1">Arsenal</a>
<a href="/squad.php?clubid=1">Arsenal</a>
'''
check(sw.parse_clubs(CLUBS) == [(9, "AFC Bournemouth"), (1, "Arsenal")],
      "клубы разобраны и без повторов")

SQUAD = '''
<table><tbody>
<tr class="r"><td>13</td><td></td><td><img src="/f.png"></td>
<td><a href="/player.php?pid=93071">Kepa Arrizabalaga</a></td>
<td>Gk</td><td>31</td><td>88</td></tr>
<tr class="r"><td>7</td><td></td><td><img src="/f.png"></td>
<td><a href="/player.php?pid=89144">Justin Kluivert</a></td>
<td>M(LR)</td><td>26</td><td>82</td></tr>
</tbody></table>
'''
rows = sw.parse_squad(SQUAD)
check(len(rows) == 2, "обе строки состава разобраны")
check(rows[0] == {"pid": 93071, "name": "Kepa Arrizabalaga", "shirt_number": 13,
                  "position": "Gk", "age": 31, "rating": 88}, "первая строка разобрана целиком")
check(rows[1]["position"] == "M(LR)" and rows[1]["rating"] == 82, "вторая строка тоже")

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ, И ОН ГЛАВНЫЙ. Разметка источника поменяется — и
# разбор обязан ОТДАТЬ ПУСТО, а не растащить ячейки наугад: молча заполненная
# мусором колода дороже пустого прогона, который видно числом.
SHIFTED = '''
<tr><td>13</td><td><a href="/player.php?pid=93071">Kepa</a></td><td>Gk</td></tr>
'''
check(sw.parse_squad(SHIFTED) == [], "строка с другим числом ячеек пропускается")
check(sw.parse_squad("<tr><td>1</td></tr>") == [], "строка без игрока — не состав")
check(sw.parse_squad("") == [], "пусто — не состав")

# Пустая ячейка — НЕ ноль: ноль означал бы «измерено и равно нулю».
NO_NUMBERS = '''
<tr><td></td><td></td><td></td><td><a href="/player.php?pid=1">X Y</a></td>
<td></td><td></td><td></td></tr>
'''
row = sw.parse_squad(NO_NUMBERS)[0]
check(row["shirt_number"] is None and row["age"] is None and row["rating"] is None,
      "пустые ячейки дают None, а не 0")
check(row["position"] is None, "пустая позиция — None, а не пустая строка")

# ⚠️ ЭТОТ СЛУЧАЙ УРОНИЛ ПЕРВЫЙ ЖИВОЙ ПРОГОН. Первая версия `to_int` вырезала
# из ячейки все нецифры и склеивала остаток: ячейка с двумя числами дала
# «2126880700002480080700», Postgres ответил «out of range for type integer»,
# и пачка не записалась ЦЕЛИКОМ — то есть клуб пропал молча.
check(sw.to_int("13") == 13, "простое число читается")
check(sw.to_int("31 (Nov 24, 2007)") == 31, "берётся ПЕРВОЕ число, а не все цифры подряд")
check(sw.to_int("") is None and sw.to_int(None) is None, "пусто — не ноль")
check(sw.to_int("нет") is None, "текст без цифр — None")
check(sw.to_int("2126880700002480080700") is None, "нечисло не притворяется числом")

print("test_soccerwiki_parse: OK (%d проверок)" % ok)
