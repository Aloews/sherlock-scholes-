"""Гербы клубов из ESPN и TheSportsDB — вместо фотографий из статьи.

    python3 club_crests.py --dry-run          # посчитать, ничего не писать
    python3 club_crests.py --sql-out c.sql    # выложить INSERT в файл
    python3 club_crests.py                    # записать в club_crest

⚠️ ЗАЧЕМ ЭТО ВООБЩЕ. `rebuild_football_clubs` берёт `crest_url` из
`cards.photo_url`, а `photo_url` у клубной карточки — заглавная картинка
статьи. Из 260 заполненных «гербов» больше половины были не эмблемами:
портрет Робби Сэвиджа у «Барнсли», раздевалка у «Арсенала», стадион у
«Аякса», мемориальная доска в Швеции у «Абердина». Результат пишется в
`club_crest`, а не в `football_club`: ночная пересборка второе затирает.

⚠️ ПОЧЕМУ НЕ РАВЕНСТВО КЛЮЧЕЙ. `club_norm_key` из базы для сведения не
годится: он знает только кириллицу и всю латинскую диакритику вырезает —
«1. FC Köln» превращается в `1 k ln`. Плюс источники пишут короче базы
(«Olympique de Marseille» против «Marseille»). Поэтому счёт идёт по общим
токенам с весом IDF, а редкое слово весит больше частого.

⚠️ ЧЕГО ЭТОТ СКРИПТ НЕ УМЕЕТ. Клуб, у которого в базе только русское имя,
он найдёт лишь если транслитерация случайно совпала с латинским написанием.
«Чикаго Файр» даёт `chikago fayr`, а в источнике `chicago fire`: звучит
одинаково, пишется иначе, и общих токенов ноль. Это главная причина, по
которой 617 клубов из 1519 остались без герба, — не пустота источников.
Лечится не порогом, а латинским именем в `football_club.name_en`.

Окружение: SUPABASE_URL, SUPABASE_KEY (service role) — только для записи.
Чтение справочника идёт через PostgREST анонимным ключом.
"""
import argparse
import collections
import difflib
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.parse

import requests

ESPN_LEAGUES = "https://sports.core.api.espn.com/v2/sports/soccer/leagues?limit=1000"
ESPN_TEAMS = "https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/teams"
TSDB_SEARCH = "https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t={q}"

# ⚠️ TheSportsDB на бесплатном ключе прикрыт Cloudflare. Замерено: 3907
# запросов в шесть потоков дали «error code: 1015» на 90% из них, а 20
# запросов в минуту идут без единого отлупа. Отсюда пауза, а не число
# потоков: параллелить тут нечего, ограничение на стороне сервера.
TSDB_DELAY_SECONDS = 3.0

MIN_SCORE = 0.70
SURE_SCORE = 0.80       # выше этого отрыв от второго не спрашивается
MIN_MARGIN = 1.15
FUZZY_SAME = 0.87       # посимвольная близость: `orlean` ↔ `orleans`

# Юридические формы и предлоги. Список намеренно КОРОТКИЙ: всё остальное
# взвешивает IDF. Ручной список уже стоил верной пары — «Atlético de San
# Luis» проигрывал «San Luis», потому что `atletico` лежало в шуме, хотя в
# Мексике оно как раз различает.
NOISE = frozenset("""
fc afc cf sc ac as ss ssc sv vfb vfl fk cd ud rc rcd bsc tsg psv nk hnk club
ssd us usc sk bk if ik kv rsc sl gd cs ogc sco asd aj ff sd kf fs ca sa pfc
de del della di do da of the el la le les los and y e i du des der den van von al
""".split())
YEAR = re.compile(r"^(1[89]\d\d|20\d\d)$")
# `II` и `B` сюда НЕ входят: «Willem II» — название клуба, а не дубль, и по
# этому признаку он терялся целиком.
YOUTH = re.compile(r"\b(u-?\d\d|under\s?\d\d|wom(?:en)?|fem(?:enino|inin)?|"
                   r"youth|junior|jr|reserves?|academy)\b", re.I)
# Студенческие первенства США: в справочнике клубов нет ни одной
# университетской команды, а «Georgia» из них уводила сборную Грузии на
# эмблему GEORGIA BULLDOGS.
COLLEGE_PREFIX = "usa.ncaa."
INTL = frozenset(
    "uefa conmebol concacaf caf afc fifa club ofc global aff".split())

# Транслитерация кириллицы — та же, что у `club_translit` в базе.
_DIGRAPH = (("щ", "sch"), ("ш", "sh"), ("ч", "ch"), ("ц", "ts"),
            ("ю", "yu"), ("я", "ya"), ("ж", "zh"))
_SRC = "абвгдеёзийклмнопрстуфхыэіїєґўъь"
_DST = "abvgdeeziyklmnoprstufhyeiieguu"
# ⚠️ В Postgres `translate` УДАЛЯЕТ символы, которым не хватило пары: строка
# `to` короче на один, и последний символ `ь` пропадает. Питоновский
# str.translate так не умеет, поэтому маппится явно.
_MAP = {ord(a): b for a, b in zip(_SRC, _DST)}
for _ch in _SRC[len(_DST):]:
    _MAP[ord(_ch)] = None

# Страна клуба в базе записана по-русски (плюс несколько ISO-кодов), у
# TheSportsDB — по-английски. Чего в карте нет, страной не проверяется:
# молчаливое «не совпало» отбрасывало бы верные пары.
RU_EN = {
    "Англия": ["England"], "Бразилия": ["Brazil"], "Аргентина": ["Argentina"],
    "США": ["United States", "USA"], "Испания": ["Spain"], "Россия": ["Russia"],
    "Германия": ["Germany"], "Италия": ["Italy"], "Турция": ["Turkey", "Türkiye"],
    "Франция": ["France"], "Япония": ["Japan"], "JP": ["Japan"],
    "Саудовская Аравия": ["Saudi Arabia"],
    "Нидерланды": ["Netherlands", "The Netherlands", "Holland"],
    "Португалия": ["Portugal"], "Китай": ["China"], "Бельгия": ["Belgium"],
    "Колумбия": ["Colombia"], "Казахстан": ["Kazakhstan"], "Таиланд": ["Thailand"],
    "Греция": ["Greece"], "Беларусь": ["Belarus"], "Дания": ["Denmark"],
    "ЮАР": ["South Africa"], "Мексика": ["Mexico"], "MX": ["Mexico"],
    "BR": ["Brazil"], "Парагвай": ["Paraguay"], "Катар": ["Qatar"],
    "Уругвай": ["Uruguay"], "Венгрия": ["Hungary"], "Шотландия": ["Scotland"],
    "Азербайджан": ["Azerbaijan"], "Финляндия": ["Finland"], "Грузия": ["Georgia"],
    "Хорватия": ["Croatia"], "ОАЭ": ["United Arab Emirates"],
    "Швейцария": ["Switzerland"], "Армения": ["Armenia"], "Австрия": ["Austria"],
    "Болгария": ["Bulgaria"], "Сербия": ["Serbia"],
    "Чехия": ["Czech Republic", "Czechia"], "Норвегия": ["Norway"],
}


# --- разбор названий -------------------------------------------------------

def translit(s):
    if not s:
        return s
    s = s.lower()
    for a, b in _DIGRAPH:
        s = s.replace(a, b)
    return s.translate(_MAP)


def toks(s):
    """Название → значащие слова. Точки убираются ДО разбиения: иначе «F.C.»
    даёт токены `f` и `c`, и все английские клубы становятся похожи друг на
    друга — «Aberdeen F.C.» так проигрывал «Manta F.C.»."""
    if not s:
        return []
    s = translit(s).replace(".", "")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    for a, b in (("ß", "ss"), ("ø", "o"), ("đ", "d"), ("ł", "l"),
                 ("æ", "ae"), ("þ", "th"), ("œ", "oe")):
        s = s.replace(a, b)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return [w for w in s.split()
            if len(w) > 1 and w not in NOISE and not YEAR.match(w)]


def is_youth(name):
    return bool(YOUTH.search(name or ""))


def tokset(names):
    out = set()
    for n in names:
        if not is_youth(n):
            out |= set(toks(n))
    return out


def build_idf(teams):
    df = collections.Counter()
    for t in teams:
        df.update(tokset(t["names"]))
    n = max(len(teams), 1)
    return {tok: math.log(n / (1 + c)) for tok, c in df.items()}


def dice(a, b, idf, default):
    if not a or not b:
        return 0.0
    shared = a & b
    if not shared:
        return 0.0
    weight = lambda s: sum(idf.get(t, default) for t in s)  # noqa: E731
    return 2 * weight(shared) / (weight(a) + weight(b))


def best_name_score(club_toks, names, idf, default):
    """Счёт по ЛУЧШЕМУ отдельному названию, а не по объединению всех.

    Объединение наказывает команду за обилие псевдонимов: «Legia Warsaw»
    против набора {legia, warszawa, leg, warsaw} давало 0.67 и вылетало по
    порогу, хотя одно из названий совпадает буквально.
    """
    best = 0.0
    for n in names:
        if is_youth(n):
            continue
        t = set(toks(n))
        if not t:
            continue
        s = dice(club_toks, t, idf, default)
        if s < FUZZY_SAME:
            a = " ".join(sorted(club_toks))
            b = " ".join(sorted(t))
            r = difflib.SequenceMatcher(None, a, b).ratio()
            if r >= FUZZY_SAME:
                s = max(s, r)
        best = max(best, s)
    return best


# --- приёмка ---------------------------------------------------------------

def accept(top, second, country_conflict):
    """Порог по счёту сам по себе не спасает: в полосе 0.5–0.7 лежат и верные
    пары («Genoa CFC» → «Genoa»), и грубо неверные («FC Arsenal Tula» →
    лондонский «Arsenal»). Их различают отрыв и страна.

    Но отрыв нельзя требовать всегда: у ESPN «Арсенал», «Барселона», «Аякс»,
    «Севилья» заведены по два раза, и правило отрыва выкидывало ровно самые
    известные клубы, у которых «спорят» они же сами.
    """
    if country_conflict:
        return False
    if top < MIN_SCORE:
        return False
    if top >= SURE_SCORE:
        return True
    return not (second > 0 and top < second * MIN_MARGIN)


def marks(names):
    """Различающие слова. Двухбуквенные не годятся: в ключах живут и
    бразильские коды штатов («flamengo rj»), и сокращения формы («cr
    flamengo»), и они развели бы один клуб на два."""
    out = set()
    for n in names:
        out |= {t for t in toks(n) if len(t) > 2}
    return out


def different_clubs(a_names, b_names, a_key=None, b_key=None):
    """Разные клубы — те, у каждого из которых есть слово, которого нет у
    другого. «Arsenal» и «Arsenal» не спорят, «Arsenal» и «Arsenal Tula» —
    спорят. Порог по строке добавлен ради ключей, покалеченных диакритикой:
    «v lez sarsfield» и «velez sarsfield ba» словами расходятся, а строкой
    совпадают на 0.93."""
    ma, mb = marks(a_names), marks(b_names)
    if not ((ma - mb) and (mb - ma)):
        return False
    if a_key is not None and b_key is not None:
        if difflib.SequenceMatcher(None, a_key, b_key).ratio() >= FUZZY_SAME:
            return False
    return True


def pick(ranked, team_of, conflict_of):
    """ranked: [(счёт, id)] по убыванию. Возвращает (id, счёт, второй, отказ)."""
    if not ranked:
        return None, 0.0, 0.0, "нет кандидатов"
    s1, i1 = ranked[0]
    top = team_of(i1)
    second = 0.0
    for s, i in ranked[1:]:
        other = team_of(i)
        if other["logo"] == top["logo"]:
            continue
        if not different_clubs(top["names"], other["names"]):
            continue
        second = s
        break
    conflict = conflict_of(i1)
    if accept(s1, second, conflict):
        return i1, s1, second, None
    return None, s1, second, ("конфликт стран" if conflict else
                              "низкий счёт" if s1 < MIN_SCORE else "мал отрыв")


def country_conflict(ru, en):
    """True, только когда ОБЕ стороны назвали страну и они не сошлись."""
    if not ru or not en:
        return False
    expected = RU_EN.get(ru)
    if not expected:
        return False
    return en not in expected


def dedupe(pairs, teams_by_id):
    """Один герб не может принадлежать разным клубам. «Локомотив Москва»,
    «Локомотив Ташкент», «Локомотив Загреб» и «Локомотив Пловдив» получили
    один значок: у источника нашёлся только первый. При этом `football_club`
    держит один клуб под несколькими ключами («benfica» и «sl benfica») — им
    один герб как раз положен."""
    by_url = {}
    for key, row in pairs.items():
        by_url.setdefault(row["url"], []).append(key)
    kept, dropped = {}, []
    for url, keys in by_url.items():
        keys.sort(key=lambda k: -pairs[k]["score"])
        win = keys[0]
        kept[win] = pairs[win]
        for k in keys[1:]:
            if different_clubs([win], [k], win, k):
                dropped.append((k, win))
            else:
                kept[k] = pairs[k]
    return kept, dropped


# --- источники -------------------------------------------------------------

def http_json(url, timeout=30):
    r = requests.get(url, timeout=timeout,
                     headers={"User-Agent": "sherlock-scholes-crests/1.0"})
    r.raise_for_status()
    return r.json()


def espn_teams(log=print):
    """Все команды из всех турниров ESPN. Их 218 — больше API не отдаёт: у
    ответа `pageCount: 1` при `limit=1000`."""
    slugs = []
    for item in http_json(ESPN_LEAGUES).get("items", []):
        ref = item.get("$ref", "")
        m = re.search(r"/leagues/([a-z0-9._-]+)", ref)
        if m:
            slugs.append(m.group(1))
    log("турниров ESPN: {}".format(len(slugs)))
    teams = {}
    for slug in slugs:
        if slug.startswith(COLLEGE_PREFIX):
            continue
        try:
            data = http_json(ESPN_TEAMS.format(slug=slug))
            league = data["sports"][0]["leagues"][0]
        except Exception:
            continue
        for wrap in league.get("teams", []):
            t = wrap.get("team") or {}
            tid = t.get("id")
            logo = None
            for entry in t.get("logos") or []:
                if "default" in (entry.get("rel") or []) and "dark" not in entry.get("href", ""):
                    logo = entry["href"]
                    break
            if not logo and t.get("logos"):
                logo = t["logos"][0].get("href")
            if not tid or not logo:
                continue
            rec = teams.setdefault(tid, {"id": tid, "logo": logo, "names": set(),
                                         "slugs": set(), "source": "espn"})
            for field in ("displayName", "shortDisplayName", "name",
                          "location", "nickname"):
                v = (t.get(field) or "").strip()
                if v:
                    rec["names"].add(v)
            for link in t.get("links") or []:
                m = re.search(r"/id/\d+/([a-z0-9-]+)", link.get("href", ""))
                if m:
                    rec["names"].add(m.group(1).replace("-", " "))
                    break
            rec["slugs"].add(slug)
    out = []
    for rec in teams.values():
        rec["names"] = sorted(rec["names"])
        rec["countries"] = sorted({s.split(".")[0] for s in rec["slugs"]} - INTL)
        rec["flag"] = "/countries/" in rec["logo"]
        rec["slugs"] = sorted(rec["slugs"])
        out.append(rec)
    log("команд ESPN: {}".format(len(out)))
    return out


def tsdb_search(query, log=print):
    try:
        data = http_json(TSDB_SEARCH.format(q=urllib.parse.quote(query)))
    except Exception:
        return []
    out = []
    for t in (data.get("teams") or []):
        if t.get("strSport") != "Soccer":
            continue
        badge = (t.get("strBadge") or "").strip()
        if not badge:
            continue
        names = [v for v in [(t.get("strTeam") or "").strip(),
                             (t.get("strTeamShort") or "").strip()] if v]
        names += [v.strip() for v in (t.get("strTeamAlternate") or "").split(",")
                  if v.strip()]
        out.append({"id": "tsdb:" + t["idTeam"], "logo": badge,
                    "names": list(dict.fromkeys(names)),
                    "country": (t.get("strCountry") or "").strip() or None,
                    "countries": [], "flag": False, "source": "thesportsdb"})
    return out


def queries_for(club):
    """Что спрашивать у TheSportsDB. Поиск там ТОЧНЫЙ, а не нечёткий:
    «FC Volendam» не находит ничего, «Volendam» находит клуб. Поэтому первым
    идёт название без юридических форм."""
    out = []
    for raw in (club.get("name_en"), club.get("name")):
        if not raw:
            continue
        joined = " ".join(toks(raw))
        if len(joined) >= 3:
            out.append(joined)
        if len(raw) >= 3:
            out.append(raw)
    return [q for q in dict.fromkeys(out) if q]


# --- справочник клубов -----------------------------------------------------

def fetch_clubs(base_url, key, log=print):
    """PostgREST режет ответ по db-max-rows (1000), клубов больше — поэтому
    страницами."""
    out = []
    offset = 0
    while True:
        url = ("{}/rest/v1/football_club?select=club_key,name,name_en,country,"
               "kind,card_id,crest_url&order=club_key&limit=1000&offset={}"
               .format(base_url.rstrip("/"), offset))
        r = requests.get(url, timeout=60,
                         headers={"apikey": key, "Authorization": "Bearer " + key})
        r.raise_for_status()
        page = r.json()
        out += page
        if len(page) < 1000:
            break
        offset += 1000
    log("клубов в справочнике: {}".format(len(out)))
    return out


# --- сведение --------------------------------------------------------------

def match_all(clubs, espn, tsdb_for_club, log=print):
    """tsdb_for_club: club -> список команд TheSportsDB (уже скачанных)."""
    idf = build_idf(espn)
    default = max(idf.values()) if idf else 1.0
    inverted = collections.defaultdict(list)
    espn_toks = {}
    for i, t in enumerate(espn):
        ts = tokset(t["names"])
        espn_toks[i] = ts
        for tok in ts:
            inverted[tok].append(i)

    pairs, reasons = {}, collections.Counter()
    for club in clubs:
        club_toks = tokset([club.get("name_en"), club.get("name")])
        if not club_toks:
            reasons["нет имени"] += 1
            continue
        want_national = club.get("kind") == "national"
        ru = club.get("country")

        pool = {}
        seen = set()
        for tok in club_toks:
            lst = inverted.get(tok, ())
            if len(lst) > 400:          # слишком частое слово ничего не сужает
                continue
            seen.update(lst)
        for i in seen:
            score = best_name_score(club_toks, espn[i]["names"], idf, default)
            if not score:
                continue
            if ru and espn[i]["countries"]:
                # ESPN страну называет префиксом слага; сверяется он не с
                # русским названием, а с тем, что уже подтвердилось на
                # однозначных парах, — см. country_votes.
                pass
            # `kind` в базе врёт (сборные из fixtures лежат как клубы),
            # поэтому расхождение только слегка опускает счёт.
            score *= 1.15 if espn[i]["flag"] == want_national else 0.95
            pool[i] = (score, espn[i])
        for t in tsdb_for_club(club):
            score = best_name_score(club_toks, t["names"], idf, default)
            if not score:
                continue
            if country_conflict(ru, t.get("country")):
                score = 0.0
            if score:
                pool[t["id"]] = (score, t)

        ranked = sorted(((v[0], k) for k, v in pool.items()),
                        key=lambda x: (-x[0], str(x[1])))
        chosen, s1, s2, why = pick(
            ranked, lambda k: pool[k][1],
            lambda k: country_conflict(ru, pool[k][1].get("country")))
        if chosen is None:
            reasons[why] += 1
            continue
        team = pool[chosen][1]
        # Флаг страны вместо герба — только при почти точном совпадении
        # имени: иначе «Сатурн» рискует получить флаг, а не эмблему.
        if team["flag"] and s1 < 0.9:
            reasons["флаг при слабом счёте"] += 1
            continue
        pairs[club["club_key"]] = {"url": team["logo"], "source": team["source"],
                                   "score": round(s1, 3), "name": team["names"][0]}

    pairs, dropped = dedupe(pairs, None)
    for _ in dropped:
        reasons["чужой герб"] += 1
    log("сведено пар: {}".format(len(pairs)))
    for why, n in reasons.most_common():
        log("   отклонено — {}: {}".format(why, n))
    return pairs


def sql_for(pairs):
    esc = lambda s: "'" + s.replace("'", "''") + "'"  # noqa: E731
    rows = ["  ({}, {}, {}, {})".format(esc(k), esc(v["url"]), esc(v["source"]),
                                        v["score"])
            for k, v in sorted(pairs.items())]
    return ("insert into public.club_crest (club_key, url, source, score) values\n"
            + ",\n".join(rows)
            + "\non conflict (club_key) do update set\n"
              "  url = excluded.url, source = excluded.source,\n"
              "  score = excluded.score, fetched_at = now();\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="посчитать и напечатать, ничего не записывать")
    ap.add_argument("--sql-out", help="выложить INSERT в файл")
    ap.add_argument("--no-tsdb", action="store_true",
                    help="только ESPN: TheSportsDB отвечает 20 запросов в минуту")
    ap.add_argument("--limit", type=int, help="ограничить число клубов (отладка)")
    args = ap.parse_args()

    base = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not base or not key:
        print("нужны SUPABASE_URL и SUPABASE_KEY", file=sys.stderr)
        return 2

    clubs = fetch_clubs(base, key)
    if args.limit:
        clubs = clubs[:args.limit]
    espn = espn_teams()

    cache = {}

    def tsdb_for_club(club):
        if args.no_tsdb:
            return []
        out = []
        for q in queries_for(club):
            if q not in cache:
                cache[q] = tsdb_search(q)
                time.sleep(TSDB_DELAY_SECONDS)
            out += cache[q]
        seen, uniq = set(), []
        for t in out:
            if t["id"] not in seen:
                seen.add(t["id"])
                uniq.append(t)
        return uniq

    pairs = match_all(clubs, espn, tsdb_for_club)

    if args.sql_out:
        with open(args.sql_out, "w", encoding="utf-8") as f:
            f.write(sql_for(pairs))
        print("SQL записан: {}".format(args.sql_out))
    if args.dry_run:
        print("сухой прогон: в базу ничего не писалось")
        return 0

    url = base.rstrip("/") + "/rest/v1/club_crest?on_conflict=club_key"
    body = [{"club_key": k, "url": v["url"], "source": v["source"],
             "score": v["score"]} for k, v in sorted(pairs.items())]
    for i in range(0, len(body), 500):
        r = requests.post(url, json=body[i:i + 500], timeout=120, headers={
            "apikey": key, "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal"})
        r.raise_for_status()
    print("записано в club_crest: {}".format(len(body)))
    print("⚠️ герб появится на экране после apply_club_crests() — её зовёт "
          "rebuild_clubs_all, либо вызовите сами")
    return 0


if __name__ == "__main__":
    sys.exit(main())
