"""Offline tests for the card-blurb shaping + guards (no network, no DB).

Covers docs/cards_descriptions_build.py: the Wikipedia lead -> blurb pipeline
and the two guards that keep a wrong article out of the deck.

    python3 tests/test_descriptions.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.dirname(HERE)
ROOT = os.path.dirname(SCRAPER)
sys.path.insert(0, SCRAPER)

import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "cards_descriptions_build",
    os.path.join(ROOT, "docs", "cards_descriptions_build.py"))
cdb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cdb)

FAILURES = []


def check(label, got, want):
    if got != want:
        FAILURES.append("{}\n    ожидалось: {!r}\n    получено : {!r}".format(
            label, want, got))
        print("FAIL  {}".format(label))
    else:
        print("ok    {}".format(label))


def check_true(label, got):
    check(label, bool(got), True)


def check_false(label, got):
    check(label, bool(got), False)


# --------------------------------------------------------------------------
# blurb shaping
# --------------------------------------------------------------------------
# A real ruwiki club lead: native-name parenthetical, stress marks, the
# "«Name» — definition" shape the cards already show the name for.
CLUB_LEAD = (
    "«Барсело́на» (полное название — Футбольный клуб «Барселона», кат. Futbol "
    "Club Barcelona) — испанский профессиональный футбольный клуб из города "
    "Барселона, столицы автономного сообщества Каталония. Основан в 1899 году."
)
check("клубный блёрб: субъект снят, скобки убраны, ударения сняты",
      cdb.blurb_from_lead(CLUB_LEAD),
      "Испанский профессиональный футбольный клуб из города Барселона, "
      "столицы автономного сообщества Каталония")

STADIUM_LEAD = (
    "«Олд Тра́ффорд» (англ. Old Trafford) — футбольный стадион в Большом "
    "Манчестере, Англия, домашняя арена клуба «Манчестер Юнайтед»."
)
check("стадион: одно предложение целиком",
      cdb.blurb_from_lead(STADIUM_LEAD),
      "Футбольный стадион в Большом Манчестере, Англия, домашняя арена клуба "
      "«Манчестер Юнайтед»")

# A short opener must pull in the next sentence rather than ship a stub.
SHORT_LEAD = "Скудетто — символ чемпиона Италии. Щит с цветами флага страны."
check("короткое первое предложение дополняется вторым",
      cdb.blurb_from_lead(SHORT_LEAD),
      "Символ чемпиона Италии. Щит с цветами флага страны")

# The dash must not be stripped when it separates clauses, not a title.
CLAUSE_LEAD = (
    "Мерсисайдское дерби — это футбольное противостояние двух клубов из "
    "Ливерпуля, и болельщики обеих команд нередко живут в одних семьях."
)
check_true("длинное предложение с тире не ломается",
           cdb.blurb_from_lead(CLAUSE_LEAD).startswith("Это футбольное"))

# Abbreviations must not end a sentence early.
ABBREV_LEAD = (
    "Футбольный клуб, основанный в 1902 г. в Мюнхене, выступает в Бундеслиге "
    "и является одним из самых титулованных в Европе."
)
check_true("«1902 г.» не обрывает предложение",
           "Мюнхене" in cdb.blurb_from_lead(ABBREV_LEAD))

# Length cap: cut on a word boundary, with an ellipsis.
LONG_LEAD = "Футбольный клуб из Мадрида, " + "очень длинное описание, " * 20
long_blurb = cdb.blurb_from_lead(LONG_LEAD)
check_true("длинный блёрб обрезан по лимиту",
           len(long_blurb) <= cdb.MAX_CHARS)
check_true("обрезка заканчивается многоточием", long_blurb.endswith("…"))
check_false("обрезка не рвёт слово посередине", long_blurb[-2:-1] == "н")

# Nothing usable -> empty string, never a half-blurb.
check("пустая преамбула -> пусто", cdb.blurb_from_lead(""), "")
check("слишком короткая преамбула -> пусто", cdb.blurb_from_lead("Клуб."), "")
check("страница-список -> пусто",
      cdb.blurb_from_lead("Список футбольных клубов Испании по алфавиту, "
                          "включающий все профессиональные команды."), "")
check("страница значений -> пусто",
      cdb.blurb_from_lead("Канониры может означать: прозвище футбольного "
                          "клуба «Арсенал», а также артиллеристов."), "")

# --------------------------------------------------------------------------
# football guard — the one that stops «Краснодар» the city
# --------------------------------------------------------------------------
CITY_LEAD = (
    "Краснода́р — город на юге России, административный центр Краснодарского "
    "края. Население — 1 099 344 человека."
)
check_false("город не проходит футбольный гард", cdb.lead_is_football(CITY_LEAD))

POET_LEAD = (
    "Да́нте Алигье́ри — итальянский поэт, мыслитель, богослов, один из "
    "основоположников литературного итальянского языка."
)
check_false("поэт не проходит футбольный гард", cdb.lead_is_football(POET_LEAD))

check_true("настоящий клуб проходит гард", cdb.lead_is_football(CLUB_LEAD))
check_true("стадион проходит гард", cdb.lead_is_football(STADIUM_LEAD))
check_true("комментатор проходит гард", cdb.lead_is_football(
    "Василий Уткин — российский спортивный журналист и комментатор, "
    "комментировал матчи чемпионата России по футболу."))

# Английские преамбулы проверяются английским словарём. Один общий русский
# паттерн молча заваливал их все — «football club» не совпадает ни с одной
# кириллической альтернативой, и enwiki-описание не писалось никогда.
EN_CLUB_LEAD = (
    "Futbol Club Barcelona is a professional football club based in "
    "Barcelona, Catalonia, Spain, that competes in La Liga."
)
EN_STADIUM_LEAD = (
    "Old Trafford is a football stadium in Old Trafford, Greater Manchester, "
    "England, and the home of Manchester United."
)
EN_COACH_LEAD = (
    "Jurgen Klopp is a German professional football manager and former "
    "player who was most recently the manager of Liverpool."
)
check_true("английский клуб проходит EN-гард",
           cdb.lead_is_football(EN_CLUB_LEAD, "en"))
check_true("английский стадион проходит EN-гард",
           cdb.lead_is_football(EN_STADIUM_LEAD, "en"))
check_true("английский тренер проходит EN-гард",
           cdb.lead_is_football(EN_COACH_LEAD, "en"))
check_false("английская преамбула НЕ проверяется русским словарём",
            cdb.lead_is_football(EN_CLUB_LEAD, "ru"))
check_false("английский город не проходит EN-гард", cdb.lead_is_football(
    "Krasnodar is a city and the administrative centre of Krasnodar Krai, "
    "Russia, located on the Kuban River.", "en"))
check_false("английский поэт не проходит EN-гард", cdb.lead_is_football(
    "Dante Alighieri was an Italian poet, writer, and philosopher.", "en"))
check_true("EN-блёрб сворачивается так же, как русский",
           cdb.blurb_from_lead(EN_CLUB_LEAD).startswith("Futbol Club"))

# --------------------------------------------------------------------------
# scope + P31 guard wiring
# --------------------------------------------------------------------------
# ⚠️ ИГРОКИ ТЕПЕРЬ В ОБЛАСТИ ДЕЙСТВИЯ. Раньше здесь стояло обратное: боялись,
# что однословные имена уведут не туда («Данте» → поэт). Держат это два гарда
# ниже, и оба уже проверены выше в этом же файле.
check_true("игроки в области действия скрипта",
           "player" in cdb.TARGET_CATEGORIES)
check_false("игроки больше не исключены",
            "player" in cdb.EXCLUDED_CATEGORIES)
check_true("игрок обязан быть человеком по P31",
           cdb.DESC_P31_ALLOW["player"] is cdb.HUMAN_P31_ALLOW)
# Тот самый случай, ради которого игроков исключали: поэт — человек и P31
# проходит, а футбольный гард его отсекает. Проверяем связку целиком.
check_true("поэт проходит P31 (он человек) — и это НЕ повод его пропустить",
           "Q5" in cdb.DESC_P31_ALLOW["player"])
check_false("...но футбольный гард его отсекает", cdb.lead_is_football(
    "Dante Alighieri was an Italian poet, writer, and philosopher.", "en"))
check_true("настоящий футболист гард проходит", cdb.lead_is_football(
    "Dante Bonfim Costa Santos is a Brazilian former professional "
    "footballer who played as a centre-back.", "en"))

# ⚠️ ЭТИ ДВА УТВЕРЖДЕНИЯ ПЕРЕВЁРНУТЫ ПО ЗАМЕРУ, А НЕ ПО УДОБСТВУ. Прежде они
# требовали, чтобы женские карточки были ИСКЛЮЧЕНЫ, и условие снятия стояло в
# самом скрипте: «не проверив на боевых данных». Проверка сделана 02.09.2026
# настоящей build_for_card на двенадцати карточках: 10 описаний построено, 2
# честных отказа («пустая преамбула»), чужих статей ноль. Решающим был случай
# «Марта» — однословное имя, тот самый страх, из-за которого когда-то
# исключали игроков, — резолв дал футболистку.
check_true("женщины-игроки в области действия",
           "woman" in cdb.TARGET_CATEGORIES)
check_false("женщины-игроки больше не исключены",
            "woman" in cdb.EXCLUDED_CATEGORIES)
# Механизм исключения остаётся рабочим — он понадобится следующей категории.
check_true("механизм исключения на месте",
           isinstance(cdb.EXCLUDED_CATEGORIES, tuple))
check_true("клубы используют P31-набор клубов",
           cdb.DESC_P31_ALLOW["club"] is cdb.run.CLUB_P31_ALLOW)
check_true("стадионы используют P31-набор стадионов",
           cdb.DESC_P31_ALLOW["stadium"] is cdb.run.STADIUM_P31_ALLOW)
check("тренер обязан быть человеком", cdb.DESC_P31_ALLOW["coach"],
      frozenset(("Q5",)))
check_false("у дерби нет P31-гарда (слишком разнородны)",
            "derby" in cdb.DESC_P31_ALLOW)

# The validator must be a no-op exactly where there is no allow-set.
check("валидатор None для дерби",
      cdb.make_validator({"category": "derby"}, None, None, None), None)
check_true("валидатор создан для клуба",
           cdb.make_validator({"category": "club"}, None, None, None) is not None)

# --------------------------------------------------------------------------
print("-" * 60)
if FAILURES:
    print("ПРОВАЛЕНО {} проверок:".format(len(FAILURES)))
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("Все проверки пройдены.")
