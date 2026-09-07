# -*- coding: utf-8 -*-
"""Ревизия QID у карточек игроков: связан ли QID с ФУТБОЛИСТОМ.

ЗАЧЕМ. Владелец: «там до сих пор очень много ошибок». Одна из них нашлась
сама, когда сборщик просмотров напечатал строку про «Эмилио Эстевеса» с
просмотрами на de/it/nl/pl. Это Q220918 — американский АКТЁР, и он лежал в
колоде действующим игроком. Проверка ста самых заметных подозрительных
карточек: пять оказались не футболистами.

    Адриан              Q1427       римский император Адриан
    Эмилио Эстевес      Q220918     актёр
    Александр Жиров     Q1387026    горнолыжник
    Александар Павлович Q458552     не футболист
    Александар Станкович Q25459955  не футболист

⚠️ КАРТОЧКА НЕ ВИНОВАТА — ВИНОВАТА ССЫЛКА. Футболист с таким именем чаще
всего существует: Александар Павлович играет за «Баварию», Адриан — вратарь.
Ошибся резолв по имени, а не заведение карточки. Поэтому здесь снимается QID
и ВСЁ, что из него выведено (просмотры, слава), а сама карточка остаётся жить
и ждать правильной привязки. Удалять её значило бы выбросить настоящего
игрока из-за чужой ссылки.

⚠️ ПРОВЕРЯЕТСЯ P106 (род занятий), А НЕ P31. P31 у человека всегда Q5, и
актёр от футболиста по нему неотличим. Футболист — Q937857.

⚠️ ОТСУТСТВИЕ P106 — НЕ ПРИГОВОР. У малоизвестных футболистов в Викиданных
род занятий часто не проставлен вовсе; снимать по этому QID значит наказывать
за неполноту чужой базы. Снимаем ТОЛЬКО когда род занятий указан и футболиста
среди них НЕТ.

ЗАПУСК (сухой по умолчанию; APPLY=1 снимает):
    python docs/cards_qid_audit.py --limit 200
    APPLY=1 python docs/cards_qid_audit.py
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb import all_rows, sb  # общий транспорт: с повторами на обрыве

UA = ("SherlockScholesBot/1.0 "
      "(+https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
WD = "https://www.wikidata.org/w/api.php"
FOOTBALLER = "Q937857"          # association football player
BATCH = 25
PAUSE = 3.0
RETRIES = 5


def occupations(payload):
    """QID → множество родов занятий. ЧИСТАЯ ФУНКЦИЯ, её проверяет тест."""
    out = {}
    for qid, entity in ((payload or {}).get("entities") or {}).items():
        vals = set()
        for claim in ((entity or {}).get("claims") or {}).get("P106") or []:
            try:
                vals.add(claim["mainsnak"]["datavalue"]["value"]["id"])
            except (KeyError, TypeError):
                continue
        out[qid] = vals
    return out


def verdict(occ):
    """'ok' | 'not_footballer' | 'unknown'. ЧИСТАЯ ФУНКЦИЯ.

    ⚠️ ТРИ ИСХОДА, А НЕ ДВА. «Род занятий не указан» и «указан, и это не
    футболист» — разные утверждения, и склеить их значит снять QID у всех
    малоизвестных футболистов, у которых Викиданные просто неполны.
    """
    if occ is None:
        return "unknown"
    if not occ:
        return "unknown"
    return "ok" if FOOTBALLER in occ else "not_footballer"


def get(url):
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as fh:
                return json.loads(fh.read())
        except urllib.error.HTTPError as e:
            if e.code != 429:
                return None
        except Exception:                                        # noqa: BLE001
            pass
        time.sleep(8 * (attempt + 1))
    return None


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY")):
        raise SystemExit("нужны SUPABASE_URL и SUPABASE_KEY")

    # ⚠️ ПОДОЗРИТЕЛЬНЫ ТЕ, КОГО НЕ ПОДТВЕРДИЛ ВТОРОЙ ИСТОЧНИК. Есть id на
    # Transfermarkt — значит футболиста там нашли, и QID проверять незачем.
    cards = all_rows("cards", {
        "select": "id,name,name_en,wikidata_qid,pageviews",
        "category": "eq.player", "active": "is.true",
        "wikidata_qid": "not.is.null", "transfermarkt_id": "is.null",
        "market_value_eur": "is.null", "born_on": "is.null",
        "order": "pageviews.desc.nullslast"})
    if args.limit:
        cards = cards[:args.limit]
    print("Карточек к проверке: %d  (APPLY=%s)"
          % (len(cards), "да" if apply_ else "нет — сухой прогон"), flush=True)

    occ = {}
    qids = [c["wikidata_qid"] for c in cards]
    for i in range(0, len(qids), BATCH):
        payload = get("%s?action=wbgetentities&format=json&props=claims&ids=%s"
                      % (WD, "|".join(qids[i:i + BATCH])))
        if payload is None:
            print("  ⚠️ пачка %d не ответила — эти QID останутся непроверенными"
                  % (i // BATCH + 1), flush=True)
        else:
            occ.update(occupations(payload))
        if (i // BATCH) % 10 == 0:
            print("  проверено %d/%d" % (min(i + BATCH, len(qids)), len(qids)), flush=True)
        time.sleep(PAUSE)

    bad, unknown, ok = [], 0, 0
    for c in cards:
        v = verdict(occ.get(c["wikidata_qid"]))
        if v == "not_footballer":
            bad.append(c)
        elif v == "unknown":
            unknown += 1
        else:
            ok += 1

    print("-" * 70)
    print("Футболист подтверждён : %d" % ok)
    print("Род занятий не указан : %d — НЕ ТРОГАЕМ, это неполнота Викиданных" % unknown)
    print("НЕ футболист          : %d" % len(bad))
    for c in bad[:30]:
        print("   %-26s %-24s pv=%-8s %s"
              % ((c["name"] or "")[:26], (c["name_en"] or "")[:24],
                 c["pageviews"], c["wikidata_qid"]))

    if apply_ and bad:
        for c in bad:
            # Снимаем ССЫЛКУ и всё, что из неё выведено. Карточка остаётся.
            sb("cards", method="PATCH",
               params={"id": "eq." + c["id"]},
               body={"wikidata_qid": None, "pageviews": None,
                     "pageviews_i18n": None, "fame": None,
                     "fame_home": None, "fame_world": None})
        print("\nСнято QID и выведенные из него просмотры: %d" % len(bad))
    elif not apply_:
        print("\nСухой прогон. APPLY=1 — снять QID у не-футболистов.")


if __name__ == "__main__":
    main()
