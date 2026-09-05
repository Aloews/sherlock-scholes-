"""Разбор состава со страницы клуба Transfermarkt (offline, без сети и базы).

Покрывает parse_roster() и parse_money() из
docs/clubs_roster_transfermarkt.py.

⚠️ Проверяется НАСТОЯЩАЯ функция, а не её копия: копия в тесте проверяет
копию (так уже было в test_title_match.py).

Разметка снята с БОЕВОЙ страницы «Реала» (verein/418) 04.09.2026, а не
придумана: придуманная разметка проверяет фантазию автора.

    python3 tests/test_club_roster_parse.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(ROOT)

import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "clubs_roster_transfermarkt",
    os.path.join(ROOT, "docs", "clubs_roster_transfermarkt.py"))
tm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tm)

FAILURES = []


def check(label, got, want):
    if got != want:
        FAILURES.append("{}\n    ожидалось: {!r}\n    получено : {!r}".format(
            label, want, got))


def row(pid, name_html, num, pos, dob, nat, value_html):
    return (
        '<tr class="odd"> <td class="zentriert rueckennummer bg_Torwart" '
        'title="%s"><div class=rn_nummer>%s</div></td><td class="posrela"> '
        '<table class="inline-table"> <tr> <td rowspan="2"> <img title="x" /> '
        '</td> <td class="hauptlink"> <a href="/x/profil/spieler/%s"> %s </a> '
        '</td> </tr> <tr> <td> %s </td> </tr> </table> </td>'
        '<td class="zentriert">%s (30)</td>'
        '<td class="zentriert"><img title="%s" class="flaggenrahmen" /></td>'
        '<td class="rechts hauptlink"><a href="/x/marktwertverlauf/spieler/%s">'
        '%s</a></td></tr>' % (pos, num, pid, name_html, pos, dob, nat, pid,
                              value_html))


HEALTHY = row("108390", "Thibaut Courtois", "1", "Goalkeeper",
              "11/05/1992", "Belgium", "€15.00m")
# ⚠️ У ТРАВМИРОВАННОГО внутри ссылки живёт <span class="verletzt-table">, и
# разбор «текст до </a>» его строку теряет ЦЕЛИКОМ. Замер на «Реале»:
# 21 имя из 27, шесть пропущенных — все травмированные. Снаружи это выглядит
# как «в клубе меньше игроков», а не как поломка разбора.
INJURED = row("935245",
              'Raúl Asencio<span title="Muscle injury - Return unknown" '
              'class="verletzt-table icons_sprite">&nbsp;</span>',
              "2", "Centre-Back", "13/02/2003", "Spain", "€20.00m")
NO_VALUE = row("1", "Youngster", "40", "Midfield", "01/01/2008", "Spain", "-")
POUNDS = row("2", "Pounds Man", "7", "Attack", "01/01/1995", "England", "£25.00m")

PAGE = "<html>" + HEALTHY + INJURED + NO_VALUE + POUNDS + "</html>"
rows = tm.parse_roster(PAGE)
by_id = {r["tm_player_id"]: r for r in rows}

check("разобраны ВСЕ четыре строки, включая травмированного", len(rows), 4)
check("травмированный не потерян", "935245" in by_id, True)
check("значок травмы не попал в имя", by_id.get("935245", {}).get("name"), "Raúl Asencio")
check("здоровый разобран как был", by_id.get("108390", {}).get("name"), "Thibaut Courtois")
check("номер снят", by_id.get("108390", {}).get("shirt_number"), "1")
check("позиция снята", by_id.get("108390", {}).get("position"), "Goalkeeper")
check("дата рождения переведена в ISO", by_id.get("108390", {}).get("born_on"), "1992-05-11")
check("гражданство снято", by_id.get("108390", {}).get("nationality"), "Belgium")
check("стоимость снята", by_id.get("108390", {}).get("market_value_eur"), 15000000)
check("миллионы у травмированного тоже", by_id.get("935245", {}).get("market_value_eur"), 20000000)

# --- прочерк и чужая валюта -----------------------------------------------
check("прочерк — это None, а не ноль", by_id.get("1", {}).get("market_value_eur"), None)
check("но сам игрок в составе ОСТАЁТСЯ", "1" in by_id, True)
check("фунты в колонку евро не попадают", by_id.get("2", {}).get("market_value_eur"), None)
check("и этот игрок тоже остаётся в составе", "2" in by_id, True)

# --- parse_money ------------------------------------------------------------
check("€1.20bn", tm.parse_money("€1.20bn"), 1200000000)
check("€900k — это 900 000, а не 900", tm.parse_money("€900k"), 900000)
check("запятая-тысячи не ломает", tm.parse_money("€1,250.00k"), 1250000)
check("пусто — None", tm.parse_money(""), None)
check("None — None", tm.parse_money(None), None)

# --- пустая страница --------------------------------------------------------
# ⚠️ Пустой разбор НЕ должен выглядеть как «в клубе никого нет»: на стороне
# базы apply_club_roster на пустом списке ничего не стирает.
check("страница без состава даёт пустой список", tm.parse_roster("<html></html>"), [])
check("None вместо страницы не падает", tm.parse_roster(None), [])

# ⚠️ ОТРИЦАТЕЛЬНЫЕ КОНТРОЛИ. Проверка обязана КРАСНЕТЬ на сломанном.
# Ломаем ровно то, что было сломано: шаблон, не терпящий тега внутри ссылки.
# Строка травмированного тогда не находится ВООБЩЕ — он исчезает из состава,
# и снаружи это выглядит как «в клубе меньше игроков».
_name_re = tm.NAME_RE
try:
    tm.NAME_RE = tm.re.compile(r'/profil/spieler/(\d+)"\s*>\s*([^<]+?)\s*</a>')
    broken = {r["tm_player_id"] for r in tm.parse_roster(PAGE)}
    check("контроль: со старым шаблоном травмированный ПРОПАДАЕТ из состава",
          "935245" in broken, False)
    check("контроль: и состав становится короче", len(broken), 3)
finally:
    tm.NAME_RE = _name_re

_units = dict(tm.UNITS)
try:
    tm.UNITS["m"] = 1
    check("контроль: со сломанными единицами 15.00m перестаёт быть 15 млн",
          tm.parse_money("€15.00m") != 15000000, True)
finally:
    tm.UNITS.clear()
    tm.UNITS.update(_units)

check("после контролей разбор снова верен",
      {r["tm_player_id"]: r["name"] for r in tm.parse_roster(PAGE)}.get("935245"),
      "Raúl Asencio")

# ─────────────────────────────────────────────────────────────────────────────
# Мост «клуб → verein»: занятый идентификатор — отказ.
#
# ⚠️ ЭТО ЕДИНСТВЕННАЯ УЛИКА, ЛОВЯЩАЯ «СТРАСБУР → verein/631». Голосование там
# отработало по написанному: двое из пяти указали на один клуб — но оба уже
# играли за «Челси» (клубы одного владельца). Вторая улика, roster_confirms,
# на таком мосту подтверждает сама себя, и ниже это ПОКАЗАНО, а не заявлено.
TAKEN = {"631": "chelsea", "418": "real madrid"}

check("свободный verein — мост берётся",
      tm.bridge_owner("27", "bayern munich", TAKEN), None)
check("verein «Челси» под «Страсбуром» — отказ с именем владельца",
      tm.bridge_owner("631", "strasbourg alsace", TAKEN), "chelsea")
check("свой же мост не считается чужим (повторный прогон)",
      tm.bridge_owner("631", "chelsea", TAKEN), None)
check("пустой справочник никого не отвергает",
      tm.bridge_owner("631", "strasbourg alsace", {}), None)

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ №1: показать, что roster_confirms этот мост
# ПРОПУСКАЕТ. Голосовавшие за verein/631 — игроки «Челси», и в заявке «Челси»
# они, разумеется, есть. Проверка, подтверждающая сама себя, зеленеет.
_chelsea_rows = [{"tm_player_id": "568177"}, {"tm_player_id": "581678"}]
_votes = {"631": ["568177", "568177"]}
check("контроль: roster_confirms чужой мост ПРОПУСКАЕТ — потому и нужен индекс",
      tm.roster_confirms(_chelsea_rows, _votes, "631"), True)

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ №2: сломать само правило — проверка обязана
# покраснеть. Если она этого не заметит, она пустая.
_real = tm.bridge_owner
try:
    tm.bridge_owner = lambda tm_id, club_key, taken: None
    check("контроль: со снятым правилом «Страсбур» забирает verein «Челси»",
          tm.bridge_owner("631", "strasbourg alsace", TAKEN) is None, True)
finally:
    tm.bridge_owner = _real

check("после контролей правило снова отвергает чужой мост",
      tm.bridge_owner("631", "strasbourg alsace", TAKEN), "chelsea")

if FAILURES:
    print("ПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("test_club_roster_parse: OK")
