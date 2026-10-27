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


def game(sid, comp, club, *, played=True, minutes=90, goals=0, assists=0,
         own=0, pen=0, yellow=False, yellow_red=False, red=False, tg=1, og=0):
    return {
        "gameInformation": {"seasonId": sid, "competitionId": comp},
        "clubsInformation": {"club": {"clubId": club}},
        "statistics": {
            "generalStatistics": {"participationState": "played" if played else "notPlayed"},
            "goalStatistics": {
                "goalsScoredTotal": goals, "assists": assists,
                "ownGoalsScored": own, "penaltyGoalsScored": pen,
                "teamGoalsOnThePitch": tg, "opponentGoalsOnThePitch": og,
            },
            "cardStatistics": {
                "yellowCard": yellow, "yellowRedCard": yellow_red, "redCard": red,
            },
            "playingTimeStatistics": {"playedMinutes": minutes},
        },
    }


def wrap(rows):
    return {"success": True, "data": {"playerId": "1", "performance": rows}}


# --- match-level season aggregation -----------------------------------------
# Two clubs in the same season must remain distinct.
rows = parse_seasons(wrap([
    game(2021, "A1", "2446", minutes=90, goals=1),
    game(2021, "RU1", "232", minutes=60, assists=1),
]))
check("две команды одного сезона не схлопываются", len(rows), 2)
check("ключи различаются клубом",
      sorted((r["season_id"], r["competition_id"], r["club_id"]) for r in rows),
      [(2021, "A1", "2446"), (2021, "RU1", "232")])

rows = parse_seasons(wrap([
    game(2021, "RU1", "232", minutes=90),
    game(2021, "RUP", "232", minutes=30),
]))
check("лига и кубок одного клуба — две строки", len(rows), 2)

# --- incomplete keys are rejected ------------------------------------------
check("строка без клуба отклонена",
      parse_seasons(wrap([game(2021, "A1", None)])), [])
check("строка без турнира отклонена",
      parse_seasons(wrap([game(2021, None, "232")])), [])
check("строка без сезона отклонена",
      parse_seasons(wrap([game(None, "A1", "232")])), [])

# --- empty and malformed payloads ------------------------------------------
check("пустой список — пустой разбор", parse_seasons(wrap([])), [])
check("не словарь — пустой разбор", parse_seasons("не json"), [])
check("нет ключа data — пустой разбор", parse_seasons({"success": True}), [])
check("нет ключа performance — пустой разбор",
      parse_seasons({"success": True, "data": {}}), [])
check("ошибка API не считается валидной пустой историей",
      parse_seasons({"success": False, "data": {"performance": []}}), [])

# --- null numeric values are zero, but a played match remains an appearance -
one = parse_seasons(wrap([game(2021, "A1", "2446", minutes=None, goals=None) ]))[0]
check("сыгранный матч учитывается", one["apps"], 1)
check("null в минутах → 0", one["minutes"], 0)
check("null в голах → 0", one["goals"], 0)

# --- aggregate multiple match records ---------------------------------------
one = parse_seasons(wrap([
    game(2021, "A1", "2446", minutes=90, goals=1, assists=1, yellow=True, tg=2, og=1),
    game(2021, "A1", "2446", minutes=35, goals=0, assists=2, red=True, tg=1, og=0),
]))[0]
check("матчи агрегируются", one["apps"], 2)
check("минуты агрегируются", one["minutes"], 125)
check("голы агрегируются", one["goals"], 1)
check("передачи агрегируются", one["assists"], 3)
check("жёлтые агрегируются", one["yellow"], 1)
check("красные агрегируются", one["red"], 1)
check("командные голы на поле", one["team_goals"], 3)
check("голы соперника на поле", one["opponent_goals"], 1)
check("сезон числом, а не строкой", one["season_id"], 2021)
check("клуб строкой, а не числом", one["club_id"], "2446")

# An unplayed row must not increase any player totals.
one = parse_seasons(wrap([game(2021, "A1", "2446", played=False, minutes=90, goals=2)]))[0]
check("не сыгранная запись не увеличивает матчи", one["apps"], 0)
check("не сыгранная запись не увеличивает голы", one["goals"], 0)

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
