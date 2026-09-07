# -*- coding: utf-8 -*-
"""Разбор страницы игрока Soccer Wiki: рост, вес, нога, дата рождения, фото.

Разметка взята С ЖИВОЙ СТРАНИЦЫ 07.09.2026 (pid=147713, Samuel Ângelo) и
урезана до тех абзацев, что читает разбор.

⚠️ РАЗБОР ИДЁТ ПО ПОДПИСИ, А НЕ ПО ПОРЯДКУ, И ЭТО ПРОВЕРЯЕТСЯ НИЖЕ. У вратаря
на странице нет «Preferred Foot»; счёт по позиции сдвинул бы всё следующее и
записал бы вратарю чужой рост.
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


sw = _load("soccerwiki_players")
ok = 0


def check(cond, what):
    global ok
    if cond:
        ok += 1
        return
    print("ПРОВАЛ: %s" % what)
    sys.exit(1)


PAGE = '''
<div class="player-img text-center mb-2"><img class="lozad img-fluid"
 src="https://cdn.soccerwiki.org/images/spacer.gif"
 data-src="https://cdn.soccerwiki.org/images/player/147713.png" alt="X" /></div>
<p class="player-info-subtitle mb-2"><span class="text-dark">Full Name:</span> Ângelo Samuel Chaves</p>
<p class="player-info-subtitle mb-2"><span class="text-dark">Shirt Name:</span> ÂNGELO</p>
<p class="player-info-subtitle mb-2"><span class="text-dark">Position:</span> <span title="x">D,DM,M(L)</span></p>
<p class="player-info-subtitle mb-2"><span class="text-dark">Rating:</span> <span>68</span></p>
<p class="player-info-subtitle mb-2"><span class="text-dark">Age:</span> 25 (Feb 10, 2001)</p>
<p class="player-info-subtitle mb-2"><span class="text-dark">Nation:</span>
 <a href="/country.php?countryId=BRA"><span class="flag-icon flag-icon-br"></span></a>
 <a class="text-underline pl-2" href="/country.php?countryId=BRA">Brazil</a></p>
<p class="player-info-subtitle mb-2"><span class="text-dark">Height (cm):</span> 182</p>
<p class="player-info-subtitle mb-2"><span class="text-dark">Weight (kg):</span> 81</p>
<p class="player-info-subtitle mb-2"><span class="text-dark">Squad Number:</span> Unknown</p>
<p class="player-info-subtitle mb-2"><span class="text-dark">Preferred Foot:</span> Left</p>
<p class="player-info-subtitle mb-2"><span class="text-dark">Position Desc:</span> Wingback</p>
'''

got = sw.parse_detail(PAGE)
check(got["full_name"] == "Ângelo Samuel Chaves", "полное имя из абзаца")
check(got["born_on"] == "2001-02-10", "дата рождения из «25 (Feb 10, 2001)»")
check(got["nation"] == "Brazil" and got["nation_code"] == "BRA", "страна словом и кодом")
check(got["height_cm"] == 182 and got["weight_kg"] == 81, "рост и вес")
check(got["foot"] == "Left", "нога")
check(got["position_desc"] == "Wingback", "описание позиции")
check(got["photo_url"] == "https://cdn.soccerwiki.org/images/player/147713.png",
      "портрет берётся из data-src, а не из src-заглушки")

# ⚠️ ПОДПИСЬ, А НЕ ПОРЯДОК. Убираем «Preferred Foot» посередине: всё
# остальное обязано остаться на своих местах.
NO_FOOT = PAGE.replace(
    '<p class="player-info-subtitle mb-2"><span class="text-dark">Preferred Foot:</span> Left</p>', '')
got2 = sw.parse_detail(NO_FOOT)
check(got2["foot"] is None, "нет подписи — нет значения")
check(got2["height_cm"] == 182 and got2["position_desc"] == "Wingback",
      "пропавший абзац НЕ сдвигает соседние поля")

# ⚠️ ЗАГЛУШКА ФОТО — ЭТО ОТСУТСТВИЕ ФОТО. Записать её значило бы раздать всей
# колоде один серый силуэт как «портрет с Soccer Wiki».
MISSING = PAGE.replace("player/147713.png", "player/missing_player.png")
check(sw.parse_detail(MISSING)["photo_url"] is None, "missing_player.png — не фото")

# «Unknown» в ячейке — не значение.
UNKNOWN_FOOT = PAGE.replace(">Preferred Foot:</span> Left<", ">Preferred Foot:</span> Unknown<")
check(sw.parse_detail(UNKNOWN_FOOT)["foot"] is None, "«Unknown» — не нога")

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: пустая страница обязана дать пусто, а не выдумку.
blank = sw.parse_detail("<html><body>ничего</body></html>")
check(all(v is None for v in blank.values()), "пустая страница — все поля пусты")

# Возраст БЕЗ даты не превращается в дату: вычисленная дата рождения на экране
# выглядит точно так же, как настоящая.
check(sw.parse_born("25") is None, "возраст без даты — не дата")
check(sw.parse_born("25 (Feb 10, 2001)") == "2001-02-10", "дата читается")
check(sw.parse_born("25 (Xyz 10, 2001)") is None, "выдуманный месяц — не дата")
check(sw.parse_born("25 (Feb 40, 2001)") is None, "40-е число — не дата")
check(sw.parse_born("(Feb 10, 1850)") is None, "1850 год — не дата футболиста")
check(sw.parse_born(None) is None and sw.parse_born("") is None, "пусто — не дата")

check(sw.to_int("182") == 182, "число читается")
check(sw.to_int("") is None and sw.to_int(None) is None, "пусто — не ноль")
check(sw.to_int("2126880700002480080700") is None, "нечисло не притворяется числом")

print("test_soccerwiki_player: OK (%d проверок)" % ok)
