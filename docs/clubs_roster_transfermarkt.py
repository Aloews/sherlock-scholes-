# -*- coding: utf-8 -*-
"""ПОЛНЫЙ состав клуба со стоимостью — одной страницей, а не по игроку.

ЗАЧЕМ. Составы у нас собирались из Викиданных, и это неполные заявки: замер
04.09.2026 — 1362 открытые строки на 294 клуба, полный состав у 42. Владелец
просит полные составы со всеми игроками и стоимостью.

Страница клуба на Transfermarkt отдаёт ВЕСЬ состав со стоимостями СРАЗУ:
замер на «Реале» (verein/418) — 27 строк состава, у каждой номер, позиция,
дата рождения, гражданство и цена. Один запрос на клуб вместо одного на
игрока.

⚠️ МОСТ — ИДЕНТИФИКАТОР, А НЕ ПОХОЖЕСТЬ ИМЁН. Идентификатор клуба берётся не
поиском по названию, а со страницы игрока, чей `transfermarkt_id` у нас уже
есть: профиль печатает свой клуб ссылкой `/verein/<id>`. Замер: Павлович
(574671) → «AC Milan» → verein/5. Сопоставление клубов по имени в этом проекте
уже связывало «Крузейро» с `cruz azul` и выдавало «Vitória S.C.» герб
бразильского EC Vitória.

⚠️ ТРАВМИРОВАННЫЕ ВЫПАДАЛИ ИЗ СОСТАВА МОЛЧА. У игрока с травмой внутри ссылки
на профиль стоит `<span class="verletzt-table">`, и разбор «текст до </a>»
такую строку не берёт вовсе. Замер на «Реале»: 21 имя из 27 — шесть
пропущенных, все травмированные. Снаружи это выглядело бы как «в клубе меньше
игроков», а не как поломка разбора. Поэтому имя берётся СО СНЯТИЕМ ТЕГОВ.

⚠️ ПУСТОЙ РАЗБОР НИЧЕГО НЕ СТИРАЕТ. `apply_club_roster` на пустом списке
возвращает (0,0): разбор, сломавшийся на смене вёрстки, иначе стёр бы составы
у всех клубов подряд. Пустота — это отказ источника, а не «в клубе никого нет».

⚠️ ИСТОЧНИК НАЗЫВАЕТСЯ. Состав и стоимости принадлежат Transfermarkt, их ToS
переиспользование ограничивают, и владелец принял это решение сознательно.
robots.txt сайта на 04.09.2026: `User-agent: * / Allow: /`. UA у нас свой, с
контактом: маскировать происхождение запроса нельзя.

⚠️ ЭМБЛЕМА КЛУБА ЗДЕСЬ НЕ ТРОГАЕТСЯ. Она в `football_club.crest_url` и
приходит с ESPN — у клуба один источник герба, так решил владелец.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет, по клубу на транзакцию):
    python docs/clubs_roster_transfermarkt.py --limit 5
    APPLY=1 python docs/clubs_roster_transfermarkt.py --limit 200
"""
import argparse
import html as htmlmod
import io
import json
import os
import re
import time
import urllib.parse
import urllib.request

CLUB_PAGE = "https://www.transfermarkt.com/x/startseite/verein/%s"
PLAYER_PAGE = "https://www.transfermarkt.com/x/profil/spieler/%s"
UA = ("SherlockScholesBot/1.0 "
      "(+https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
PAUSE = 1.5
RETRIES = 3
PAGE = 1000

UNITS = {"bn": 10 ** 9, "m": 10 ** 6, "k": 10 ** 3}

# Строка состава: внешний <tr class="odd|even"> на игрока.
ROW_SPLIT = re.compile(r'<tr class="(?:odd|even)">')
# ⚠️ Имя берётся СО СНЯТИЕМ ТЕГОВ: у травмированного внутри ссылки живёт
# <span class="verletzt-table">, и «текст до </a>» его строку теряет.
NAME_RE = re.compile(r'/profil/spieler/(\d+)"\s*>(.*?)</a>', re.S)
VALUE_RE = re.compile(r'/marktwertverlauf/spieler/\d+"\s*>\s*([^<]+?)\s*</a>')
MONEY_RE = re.compile(r'(€|£|\$)\s*([\d.,]+)\s*(bn|m|k)\b', re.I)
NUM_RE = re.compile(r'rn_nummer>\s*(\d+)\s*<')
POS_RE = re.compile(r'rueckennummer[^"]*"\s+title="([^"]+)"')
DOB_RE = re.compile(r'>(\d{2})/(\d{2})/(\d{4})')
NAT_RE = re.compile(r'title="([^"]+)"[^>]*class="flaggenrahmen"')
# Клуб игрока — прямая ссылка в шапке профиля.
CLUB_OF_PLAYER_RE = re.compile(
    r'data-header__club"[^>]*>\s*<a[^>]*href="/[^"]*/startseite/verein/(\d+)')


def strip_tags(s):
    return htmlmod.unescape(re.sub(r"<[^>]+>", "", s or "")).replace("\xa0", " ").strip()


def parse_money(text):
    """«€15.00m» -> 15000000. Чужая валюта и прочерк -> None.

    ⚠️ Цена в фунтах, записанная в колонку евро, — тихая ошибка в 15 %, и
    выглядит она правдоподобно. Знак валюты проверяется, а не отбрасывается.
    """
    m = MONEY_RE.search(text or "")
    if not m or m.group(1) != "€":
        return None
    try:
        v = int(round(float(m.group(2).replace(",", "")) * UNITS[m.group(3).lower()]))
    except (ValueError, KeyError):
        return None
    return v if v > 0 else None


def parse_roster(page):
    """[{tm_player_id, name, shirt_number, position, born_on, nationality,
    market_value_eur}] со страницы клуба."""
    out = []
    for chunk in ROW_SPLIT.split(page or "")[1:]:
        m = NAME_RE.search(chunk)
        if not m:
            continue
        name = strip_tags(m.group(2))
        if not name:
            continue
        num = NUM_RE.search(chunk)
        pos = POS_RE.search(chunk)
        dob = DOB_RE.search(chunk)
        nat = NAT_RE.search(chunk)
        val = VALUE_RE.search(chunk)
        out.append({
            "tm_player_id": m.group(1),
            "name": name,
            "shirt_number": num.group(1) if num else "",
            "position": htmlmod.unescape(pos.group(1)) if pos else "",
            "born_on": "%s-%s-%s" % (dob.group(3), dob.group(2), dob.group(1)) if dob else "",
            "nationality": htmlmod.unescape(nat.group(1)) if nat else "",
            "market_value_eur": parse_money(val.group(1)) if val else None,
        })
    return out


def get(url):
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as fh:
                return fh.read().decode("utf-8", "replace")
        except Exception:                                       # noqa: BLE001
            if attempt + 1 == RETRIES:
                return None
            time.sleep(PAUSE * 3 * (attempt + 1))
    return None


def sb(path, method="GET", body=None, params=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    key = os.environ["SUPABASE_KEY"]
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "apikey": key, "Authorization": "Bearer " + key,
        "Content-Type": "application/json", "Prefer": "return=minimal"})
    with urllib.request.urlopen(req, timeout=120) as fh:
        raw = fh.read()
    return json.loads(raw) if raw else []


def read_all(path, params):
    """Страницами: PostgREST режет ответ по db-max-rows, и одна страница на
    тысячу молча выглядит как «столько и есть»."""
    out, offset = [], 0
    while True:
        page = sb(path, params=dict(params, limit=PAGE, offset=offset))
        out.extend(page)
        if len(page) < PAGE:
            return out
        offset += PAGE


def clubs_to_do(limit):
    """Клубы в порядке «сколько его видно»: сперва те, чьи матчи игрок увидит."""
    clubs = read_all("football_club", {
        "select": "club_key,name,name_en,transfermarkt_id,crest_url",
        "kind": "eq.club", "order": "club_key"})
    stats = sb("rpc/club_directory", method="POST",
               body={"p_lang": "ru", "p_query": None, "p_limit": 10000})
    by_key = {d["club_key"]: d for d in stats}
    for c in clubs:
        c["matches"] = (by_key.get(c["club_key"]) or {}).get("matches") or 0
    clubs.sort(key=lambda c: (-c["matches"], c["club_key"]))
    return clubs[:limit] if limit else clubs


VOTES_NEEDED = 2      # один голос — не мост, см. ниже
VOTERS_MAX = 5


def club_tm_id(club_key, known):
    """Идентификатор клуба на TM — ПО ГОЛОСОВАНИЮ игроков, а не по одному.

    ⚠️ ОДИН ИГРОК МОСТА НЕ ДАЁТ, И ЭТО ЗАМЕРЕНО. Состав у нас собран из
    Викиданных и местами устарел: у «Байерна» в club_squad стоял игрок,
    который на самом деле в «Аугсбурге», и мост по нему привёл на verein/167 —
    Аугсбург. Снаружи это выглядело нормально: 28 игроков, у 27 цена, сумма
    177.8 млн €. Числа правдоподобные, клуб чужой.

    Поэтому берётся до пяти игроков состава, и клуб считается найденным
    только если минимум двое указывают на ОДИН И ТОТ ЖЕ verein. Имена в
    сравнении не участвуют вовсе — голосуют идентификаторы.

    Возвращает (id, как_нашли, голоса) — голоса нужны вызывающему, чтобы
    проверить ростер (см. roster_confirms).
    """
    if known:
        return known, "из базы", {}
    rows = sb("club_squad", params={
        "select": "card_id,cards!inner(transfermarkt_id)",
        "club_key": "eq." + club_key, "left_at": "is.null",
        "cards.transfermarkt_id": "not.is.null", "limit": str(VOTERS_MAX)})
    votes = {}
    for r in rows:
        tm = ((r.get("cards") or {}) or {}).get("transfermarkt_id")
        if not tm:
            continue
        page = get(PLAYER_PAGE % tm)
        time.sleep(PAUSE)
        m = CLUB_OF_PLAYER_RE.search(page or "")
        if m:
            votes.setdefault(m.group(1), []).append(tm)
        # Досрочный выход: как только у кого-то набралось нужное число голосов,
        # остальных не спрашиваем — бюджет вежливости конечен.
        best = max(votes.items(), key=lambda kv: len(kv[1])) if votes else None
        if best and len(best[1]) >= VOTES_NEEDED:
            return best[0], "голосов %d из %d" % (len(best[1]), len(votes)), votes
    if votes:
        top = max(votes.items(), key=lambda kv: len(kv[1]))
        return None, ("голосов не хватило: %s" %
                      ", ".join("verein/%s×%d" % (k, len(v)) for k, v in votes.items())), votes
    return None, "не найден", votes


def roster_confirms(rows, votes, tm_id):
    """Проверка моста ростером: те, кто за него голосовал, обязаны в нём быть.

    ⚠️ Это вторая, независимая улика, и она ничего не стоит — ростер уже
    выкачан. Сравниваются ИДЕНТИФИКАТОРЫ, не имена: игрок либо есть в составе
    клуба, либо нет.
    """
    if not votes:
        return True                    # мост взят из базы — голосов нет
    ids = {r["tm_player_id"] for r in rows}
    return any(v in ids for v in votes.get(tm_id, []))


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="сколько клубов (0 — все)")
    ap.add_argument("--club", default=None, help="один club_key")
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"

    clubs = clubs_to_do(args.limit)
    if args.club:
        clubs = [c for c in clubs if c["club_key"] == args.club]
    print("Клубов в работе: %d  (APPLY=%s)"
          % (len(clubs), "да" if apply_ else "нет — сухой прогон"), flush=True)

    bridged = players = priced = lost = no_id = rejected = 0
    for i, c in enumerate(clubs, 1):
        tm_id, how, votes = club_tm_id(c["club_key"], c.get("transfermarkt_id"))
        if not tm_id:
            no_id += 1
            print("  %-24s моста нет (%s)" % (c["club_key"][:24], how), flush=True)
            continue
        page = get(CLUB_PAGE % tm_id)
        time.sleep(PAUSE)
        rows = parse_roster(page)
        if rows and not roster_confirms(rows, votes, tm_id):
            # Голоса сошлись, а в составе тех игроков нет — мост неверен.
            rejected += 1
            print("  %-24s verein/%-7s ОТВЕРГНУТ: голосовавших нет в составе"
                  % (c["club_key"][:24], tm_id), flush=True)
            continue
        if not c.get("transfermarkt_id"):
            bridged += 1
            if apply_:
                sb("football_club", method="PATCH",
                   params={"club_key": "eq." + c["club_key"]},
                   body={"transfermarkt_id": tm_id})
        if not rows:
            # ⚠️ Пустой разбор — отказ, а не «в клубе никого нет».
            lost += 1
            print("  ⚠️ %-24s verein/%-7s состав НЕ РАЗОБРАН" % (c["club_key"][:24], tm_id),
                  flush=True)
            continue
        players += len(rows)
        priced += sum(1 for r in rows if r["market_value_eur"])
        total = sum(r["market_value_eur"] or 0 for r in rows)
        print("  %-24s verein/%-7s %2d игроков, %2d с ценой, %s € (%s)"
              % (c["club_key"][:24], tm_id, len(rows),
                 sum(1 for r in rows if r["market_value_eur"]),
                 "{:,}".format(total), how), flush=True)
        if apply_:
            # Один клуб — одна транзакция, и она заменяет состав целиком:
            # ушедший игрок обязан ИСЧЕЗНУТЬ, а не остаться навсегда.
            res = sb("rpc/apply_club_roster", method="POST",
                     body={"p_club_key": c["club_key"], "p_rows": rows})
            r0 = (res[0] if isinstance(res, list) else res) or {}
            if r0.get("removed"):
                print("      выбыло из состава: %d" % r0["removed"], flush=True)

    print("-" * 74)
    print("Мостов заведено (клуб → id на TM) : %d" % bridged)
    print("Игроков в составах                : %d, из них с ценой %d" % (players, priced))
    if no_id:
        print("Клубов без моста                  : %d — голоса игроков не "
              "сошлись или игроков с transfermarkt_id нет вовсе" % no_id)
    if rejected:
        print("Мостов отвергнуто ростером        : %d — голоса сошлись, а в "
              "составе тех игроков не оказалось" % rejected)
    if lost:
        print("⚠️ СОСТАВОВ НЕ РАЗОБРАНО          : %d — их пустота НИЧЕГО не "
              "значит, повторить прогон" % lost)
    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")


if __name__ == "__main__":
    main()
