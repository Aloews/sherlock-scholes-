# -*- coding: utf-8 -*-
"""Эмблемы клубам из ESPN — того же источника, что уже в базе.

ЗАЧЕМ. `football_club.crest_url` заполняется ровно одним способом: копируется
из `cards.photo_url` карточки клуба (`rebuild_football_clubs`). Следствие видно
глазами — клуб без карточки не получит эмблему НИКОГДА.

Замер 03.09.2026:

    клубов в справочнике        1521
    с эмблемой                   934      из них с ESPN 707, из Викимедиа 0
    без эмблемы                  587

Заводить 587 карточек ради гербов нельзя: это те самые голые карточки, из-за
которых колода уже портилась. Эмблема — свойство КЛУБА, и брать её надо там же,
откуда пришли остальные 707.

⚠️ ВИКИДАННЫЕ ЗАМЕНОЙ НЕ СЛУЖАТ, И ЭТО ПРОВЕРЕНО, А НЕ ПРЕДПОЛОЖЕНО. Свойство
P154 («логотип») нашлось у 3 клубов из 25, а ссылки `Special:FilePath` на
найденное отдавали 404. Первый вариант этого сборщика был написан на Викиданных
и выброшен целиком.

⚠️ ХОСТ ESPN ВАЖЕН. `site.api.espn.com` отдаёт 403 из песочницы агента (Akamai,
при любом User-Agent), а `sports.core.api.espn.com` отвечает 200. Оба ведут к
одним данным; здесь используется второй, поэтому сборщик проверяем и локально,
а не только в GitHub Actions.

КАК. Лиги (218) → команды лиги → название и логотип. Логотип у ESPN
детерминирован: `.../teamlogos/soccer/500/<id>.png`, id лежит в ссылке команды.

⚠️ СОПОСТАВЛЯЕТ SQL, А НЕ ЭТОТ ФАЙЛ. На выходе — список пар (имя ESPN, ссылка),
а связывает их с `football_club` уже база, через свои `club_match_key` и
`club_alias`. Вторая копия правила сопоставления в питоне разошлась бы с
серверной молча, и клуб получил бы чужой герб.

ЗАПУСК (сеть только на чтение; записи нет — на выходе SQL):
    python docs/clubs_crests_espn.py --sql-out crests.sql
    python docs/clubs_crests_espn.py --leagues 5      # быстрая проба
"""
import argparse
import io
import json
import os
import re
import sys
import time
import urllib.request

CORE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues"
UA = "SherlockScholesBot/0.1 (pilot players DB; contact: giafreec@gmail.com)"
PAUSE = 0.25
RETRIES = 3
LOST = []


def get(url):
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as fh:
                return json.load(fh)
        except Exception as exc:                             # noqa: BLE001
            if attempt == RETRIES - 1:
                LOST.append(str(exc)[:80])
                return None
            time.sleep(PAUSE * 4 * (attempt + 1))
    return None


def league_slugs(limit=0):
    data = get(CORE + "?limit=400") or {}
    slugs = []
    for item in data.get("items") or []:
        m = re.search(r"/leagues/([^/?]+)", item.get("$ref", ""))
        if m:
            slugs.append(m.group(1))
    return slugs[:limit] if limit else slugs


def teams_of_league(slug):
    """[(название, ссылка на эмблему)] одной лиги."""
    data = get("%s/%s/teams?limit=100" % (CORE, slug))
    out = []
    for item in (data or {}).get("items") or []:
        ref = item.get("$ref") or ""
        team = get(ref)
        if not team:
            continue
        name = team.get("displayName") or team.get("name")
        logo = None
        for l in team.get("logos") or []:
            href = l.get("href") or ""
            # Тёмный вариант — второй в списке; на тёмном фоне приложения
            # он сливается, поэтому берётся ПЕРВЫЙ, обычный.
            if href and "500-dark" not in href:
                logo = href
                break
        if name and logo:
            out.append((name, logo))
        time.sleep(PAUSE)
    return out


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--leagues", type=int, default=0, help="сколько лиг (0 — все)")
    ap.add_argument("--sql-out", default=None, help="куда выписать UPDATE")
    args = ap.parse_args()

    slugs = league_slugs(args.leagues)
    print("Лиг у ESPN: %d" % len(slugs), flush=True)

    pairs = {}
    for i, slug in enumerate(slugs, 1):
        for name, logo in teams_of_league(slug):
            pairs.setdefault(name, logo)
        if i % 10 == 0 or i == len(slugs):
            print("  лиг %d/%d, команд %d" % (i, len(slugs), len(pairs)), flush=True)
        time.sleep(PAUSE)

    print("-" * 70)
    if LOST:
        print("⚠️ ЗАПРОСОВ ПОТЕРЯНО: %d — столько команд осталось без ответа. "
              "Их отсутствие здесь ничего не значит." % len(LOST))
    print("Команд с эмблемой: %d" % len(pairs))
    for name, logo in list(pairs.items())[:8]:
        print("  %-34s %s" % (name[:34], logo[:60]))

    if args.sql_out and pairs:
        def q(v):
            return "'" + str(v).replace("'", "''") + "'"
        out = [
            "-- Эмблемы клубам из ESPN. Сгенерировано docs/clubs_crests_espn.py.",
            "-- Команд: %d." % len(pairs),
            "--",
            "-- ⚠️ СОПОСТАВЛЯЕТ БАЗА, А НЕ СБОРЩИК. Ниже только пары «имя ESPN →",
            "-- эмблема»; club_match_key и club_alias — серверные, и вторая копия",
            "-- этого правила в питоне разошлась бы с ними молча.",
            "--",
            "-- Пишется ТОЛЬКО там, где эмблемы не было: ручной герб не",
            "-- перетирается, повтор прогона — no-op.",
            "update football_club f set crest_url = v.logo",
            "  from (values",
        ]
        out.append(",\n".join("    (%s, %s)" % (q(n), q(u))
                              for n, u in sorted(pairs.items())))
        out += [
            "  ) as v(espn_name, logo)",
            " where f.crest_url is null and f.kind = 'club'",
            "   and (club_match_key(f.name_en) = club_match_key(v.espn_name)",
            "        or club_match_key(f.name) = club_match_key(v.espn_name)",
            "        or exists (select 1 from club_alias a",
            "                    where a.club_key = f.club_key",
            "                      and a.alias_key = club_norm_key(v.espn_name)));",
        ]
        io.open(args.sql_out, "w", encoding="utf-8").write("\n".join(out) + "\n")
        print("SQL выписан в %s" % args.sql_out)


if __name__ == "__main__":
    main()
