# -*- coding: utf-8 -*-
"""Разбор статистики с transfermarkt — на выдуманных ответах, без сети.

Проверяется РАЗБОР, а не источник. Каждая проверка отвечает на вопрос «что
случится, если источник отдаст вот это», и каждая из них однажды уже была
ошибкой или могла ей стать.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "docs"))
from players_stats_transfermarkt import (  # noqa: E402
    parse_birth, parse_club, parse_competition, parse_seasons)

FAILED = []


def check(name, got, want):
    if got != want:
        FAILED.append("%s\n   ожидалось: %r\n   получено : %r" % (name, want, got))
        print("✗ %s" % name)
    else:
        print("✓ %s" % name)


def season(sid, comp, club, **stats):
    return {
        "generalInformation": {"seasonId": sid, "competitionId": comp, "clubId": club},
        "statistics": {
            "goalStatistics": {"goalsSum": stats.get("goals", 0),
                               "assistsSum": stats.get("assists", 0),
                               "ownGoalsSum": stats.get("own", 0),
                               "penaltyShooterGoalsScored": stats.get("pen", 0),
                               "teamGoalsOnThePitchSum": stats.get("tg", 0),
                               "opponentGoalsOnThePitch": stats.get("og", 0)},
            "cardStatistics": {"yellowCardNetSum": stats.get("yellow", 0),
                               "yellowRedCardsCount": stats.get("yr", 0),
                               "redCardsCount": stats.get("red", 0)},
            "playingTimeStatistics": {"appearancesCount": stats.get("apps", 0),
                                      "startingCount": stats.get("starts", 0),
                                      "substitutedInCount": stats.get("in", 0),
                                      "substitutedOutCount": stats.get("out", 0),
                                      "playedMinutesSum": stats.get("minutes", 0)},
        },
    }


def wrap(rows):
    return {"success": True, "data": {"playerId": "1", "performance": rows}}


# --- ключ ------------------------------------------------------------------
# ⚠️ ГЛАВНАЯ ПРОВЕРКА ЭТОГО ФАЙЛА. Классен сезон 2021 начал в «Тироле» (2446),
# а закончил в «Спартаке» (232). Если клуб выпадет из ключа, одна строка
# затрёт другую и год исчезнет из карьеры — карточка будет выглядеть полной.
rows = parse_seasons(wrap([season(2021, "A1", "2446", apps=37, minutes=3144),
                           season(2021, "RU1", "232", apps=18, minutes=657)]))
check("две строки одного сезона за разные клубы не схлопываются", len(rows), 2)
check("ключи различаются клубом",
      sorted((r["season_id"], r["competition_id"], r["club_id"]) for r in rows),
      [(2021, "A1", "2446"), (2021, "RU1", "232")])

rows = parse_seasons(wrap([season(2021, "RU1", "232", apps=18),
                           season(2021, "RUP", "232", apps=14)]))
check("лига и кубок одного клуба — две строки, а не одна", len(rows), 2)

# --- неполный ключ ---------------------------------------------------------
check("строка без клуба выброшена",
      parse_seasons(wrap([season(2021, "A1", None, apps=9)])), [])
check("строка без турнира выброшена",
      parse_seasons(wrap([season(2021, None, "232", apps=9)])), [])
check("строка без сезона выброшена",
      parse_seasons(wrap([season(None, "A1", "232", apps=9)])), [])

# --- пустота и мусор -------------------------------------------------------
check("пустой список — пустой разбор", parse_seasons(wrap([])), [])
check("не словарь — пустой разбор", parse_seasons("не json"), [])
check("нет ключа data — пустой разбор", parse_seasons({"success": True}), [])
check("нет ключа performance — пустой разбор",
      parse_seasons({"success": True, "data": {}}), [])

# --- null вместо числа -----------------------------------------------------
# Источник иногда отдаёт null там, где всегда стояло число. Падать нельзя, и
# выдумывать тоже: ноль здесь — то, что и означает отсутствие событий.
bad = season(2021, "A1", "2446")
bad["statistics"]["playingTimeStatistics"]["appearancesCount"] = None
bad["statistics"]["goalStatistics"]["goalsSum"] = None
one = parse_seasons(wrap([bad]))[0]
check("null в матчах → 0", one["apps"], 0)
check("null в голах → 0", one["goals"], 0)

nostat = {"generalInformation": {"seasonId": 2021, "competitionId": "A1", "clubId": "1"}}
check("строка совсем без statistics не роняет разбор",
      parse_seasons(wrap([nostat]))[0]["minutes"], 0)

# --- поля не перепутаны ----------------------------------------------------
one = parse_seasons(wrap([season(2021, "A1", "2446", apps=37, starts=36, minutes=3144,
                                 goals=1, assists=7, yellow=7, red=0, out=9)]))[0]
check("матчи", one["apps"], 37)
check("в старте", one["starts"], 36)
check("минуты", one["minutes"], 3144)
check("голы", one["goals"], 1)
check("передачи", one["assists"], 7)
check("жёлтые", one["yellow"], 7)
check("заменён", one["sub_out"], 9)
check("сезон числом, а не строкой", one["season_id"], 2021)
check("клуб строкой, а не числом", one["club_id"], "2446")

# --- дата рождения ---------------------------------------------------------
check("дата рождения",
      parse_birth({"lifeDates": {"dateOfBirth": "2000-05-29",
                                 "isDateOfBirthUnknown": False}}), "2000-05-29")
# ⚠️ ФЛАГ СИЛЬНЕЕ ДАТЫ. При неизвестной дате источник ставит 1 января: записать
# её значит поздравлять тысячи человек с днём рождения в один и тот же день.
check("неизвестная дата не берётся, хотя 1 января проставлено",
      parse_birth({"lifeDates": {"dateOfBirth": "2000-01-01",
                                 "isDateOfBirthUnknown": True}}), None)
check("пустая дата → None",
      parse_birth({"lifeDates": {"dateOfBirth": ""}}), None)
check("нет lifeDates → None", parse_birth({}), None)
check("не словарь → None", parse_birth(None), None)
check("время после даты отрезано",
      parse_birth({"lifeDates": {"dateOfBirth": "1998-06-10T00:00:00+00:00"}}),
      "1998-06-10")

# --- справочники -----------------------------------------------------------
# `isNationalTeam` — поле ИСТОЧНИКА, и на нём держится разделение клубной
# карьеры и сборной. Сложить 5 матчей за Россию U17 в клубную сумму — соврать.
check("сборная опознана источником",
      parse_club({"id": "23138", "name": "Russia U17",
                  "baseDetails": {"isNationalTeam": True, "countryId": 141}}),
      {"id": "23138", "name": "Russia U17", "country_id": 141, "is_national_team": True})
check("клуб — не сборная",
      parse_club({"id": "232", "name": "Spartak Moscow",
                  "baseDetails": {"isNationalTeam": False, "countryId": 141}})["is_national_team"],
      False)
check("нет baseDetails — считаем клубом, а не сборной",
      parse_club({"id": "1", "name": "X"})["is_national_team"], False)
check("клуб без id — None", parse_club({"name": "X"}), None)
check("id клуба строкой", parse_club({"id": 232, "name": "X"})["id"], "232")

check("турнир",
      parse_competition({"id": "A1", "name": "Bundesliga",
                         "baseDetails": {"shortName": "Bundesliga"},
                         "originDetails": {"countryId": 127}, "typeId": 1,
                         "logoUrl": "u"}),
      {"id": "A1", "name": "Bundesliga", "short_name": "Bundesliga",
       "country_id": 127, "type_id": 1, "logo_url": "u"})
check("турнир без id — None", parse_competition({"name": "X"}), None)

print()
if FAILED:
    print("ПРОВАЛЕНО: %d" % len(FAILED))
    for f in FAILED:
        print(" ", f)
    sys.exit(1)
print("Все проверки разбора статистики прошли.")
