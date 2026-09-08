# -*- coding: utf-8 -*-
"""Разбор тренера со страницы Soccer Wiki — на сохранённой разметке.

⚠️ РАЗБОР ИДЁТ ПО ПОДПИСИ «Manager», А НЕ ПО ПОРЯДКУ БЛОКОВ, и проверяется
именно это: у клуба без тренера блока нет вовсе, и счёт по позиции сдвинул бы
всё следующее — на страницу приехал бы капитан или первый игрок состава.

Отдельным скриптом, а не pytest-набором: `pytest` в этом проекте собирает лишь
три файла, остальных не видит вовсе (см. CLAUDE.md).
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

spec = importlib.util.spec_from_file_location(
    "swm", os.path.join(ROOT, "docs", "soccerwiki_managers.py"))
swm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(swm)

fails = []


def eq(got, want, what):
    if got != want:
        fails.append(f"{what}: получено {got!r}, ожидалось {want!r}")


# Кусок настоящей страницы клуба: блок тренера ровно в том виде, в каком его
# отдаёт источник (clubid=2, «Астон Вилла», снято 08.09.2026).
CLUB = '''
<div><img class="img-fluid img-thumbnail" src="https://cdn.soccerwiki.org/images/spacer.gif"
 data-src="https://cdn.soccerwiki.org/images/manager/172.png" alt="Unai Emery" /></div>
<p class="player-info-subtitle mb-1"><span class="text-dark">Manager</span></p>
<p class="player-info-subtitle mb-2"><a href="/country.php?countryId=ESP"><span
 class="flag-icon flag-icon-es"></span></a>
 <a class="text-underline" href="/football-manager.php?mid=172">Unai Emery</a></p>
<p class="player-info-subtitle mb-2"><span class="text-dark">Age:</span> 54</p>
'''

got = swm.parse_manager(CLUB)
eq(got[0], 172, "идентификатор тренера")
eq(got[1], "Unai Emery", "имя тренера")
eq(got[2], "ESP", "страна тренера")
eq(got[3], "https://cdn.soccerwiki.org/images/manager/172.png", "портрет")

# ⚠️ КЛУБ БЕЗ ТРЕНЕРА ОБЯЗАН ДАТЬ None, А НЕ ПЕРВОГО ПОПАВШЕГОСЯ ЧЕЛОВЕКА.
# На странице есть ссылки на игроков и капитана; разбор по порядку принял бы
# любую из них за тренера.
NO_MANAGER = '''
<p class="player-info-subtitle mb-1"><span class="text-dark">Captain</span></p>
<p class="player-info-subtitle mb-2"><a href="/player.php?pid=555">John Smith</a></p>
<p><a href="/football-manager.php?mid=999">Somebody Else</a></p>
'''
eq(swm.parse_manager(NO_MANAGER), None, "клуб без подписи Manager")
eq(swm.parse_manager(""), None, "пустая страница")

# Заглушка портрета — это НЕ портрет. Записать её значило бы раздать всем
# тренерам один серый силуэт как «фото с Soccer Wiki».
STUB = CLUB.replace("manager/172.png", "manager/missing_player.png")
eq(swm.parse_manager(STUB)[3], None, "заглушка портрета отсеяна")

# Дата рождения живёт только на странице тренера и берётся из ТЕКСТА без
# разметки: первая версия выражения требовала литеральный «<» и не находила
# ничего.
MGR = "<div>Role Manager <b>Date Of Birth</b> Nov 3, 1971 Country of Birth Spain</div>"
eq(swm.parse_born(MGR), "1971-11-03", "дата рождения тренера")
eq(swm.parse_born("<div>Role Manager Country of Birth Spain</div>"), None,
   "без даты рождения")
eq(swm.parse_born(""), None, "пустая страница тренера")

if fails:
    print("ПРОВАЛ")
    for f in fails:
        print(" ", f)
    sys.exit(1)
print("OK: разбор тренера — 10 проверок")
