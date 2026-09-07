# -*- coding: utf-8 -*-
"""Ревизия фото: совпадает ли снимок карточки с P18 её же QID.

ЗАЧЕМ. Владелец: «у Джона Кеннеди фото не футболиста, а президента… Carlos
Alcaraz так же фото теннисиста, а не футболиста. Поставь тест на контроль
таких эмблем и фото».

ЧТО ИМЕННО СЛОМАНО. QID у обеих карточек ПРАВИЛЬНЫЙ: Q105393903 — бразильский
нападающий Джон Кеннеди, Q88130791 — аргентинский полузащитник Карлос
Алькарас. Сломан снимок: он искался в Commons ПО ИМЕНИ, а по имени «John
Kennedy» первым отвечает президент США, по «Carlos Alcaraz» — теннисист.

⚠️ ПРОВЕРЯТЬ ИМЕНЕМ ФАЙЛА БЕСПОЛЕЗНО, и это главное. Файл президента
называется «John F. Kennedy, White House color photo portrait.jpg» — имя
карточки в нём ЕСТЬ. Похожесть строк тут ничего не доказывает; доказывает
только связь через сущность: у карточки есть QID, у QID есть P18, и снимок
обязан быть именно им.

⚠️ ДВЕ ОПОРЫ, А НЕ ОДНА, И ВТОРАЯ ПОЯВИЛАСЬ ПО ЖИВОМУ ПРОМАХУ. Первый прогон
проверял только P18 — и не поймал НИ Кеннеди, НИ Алькараса: у Q105393903 (Джон
Кеннеди, футболист) P18 нет вовсе, поэтому карточка получила вердикт «не
знаем» и осталась с президентом. Проверка, пропускающая оба случая, ради
которых её писали, бесполезна.

Опоры теперь такие, в порядке доверия:
  1) P18 сущности — снимок, назначенный самой Викиданными;
  2) ГЛАВНАЯ КАРТИНКА СТАТЬИ этого же QID (pageimages по sitelinks).
Обе привязаны к СУЩНОСТИ, а не к строке имени. Снимок, не совпавший ни с
одной, взят откуда-то ещё — и именно так в колоду попал президент США.

⚠️ ФОТО С TRANSFERMARKT НЕ ТРОГАЕМ ВОВСЕ: они привязаны к id игрока на
Transfermarkt, а не к имени, и подменить лицо там нечему.

ЗАПУСК (сухой по умолчанию; APPLY=1 чинит):
    python docs/cards_photo_qid_audit.py --limit 300
    APPLY=1 python docs/cards_photo_qid_audit.py
"""
import argparse
import json
import os
import re
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
COMMONS = "https://commons.wikimedia.org/wiki/Special:FilePath/"
BATCH = 25
PAUSE = 3.0
RETRIES = 5


def file_of(url):
    """Имя файла Commons из ссылки карточки, или None. ЧИСТАЯ ФУНКЦИЯ.

    Ссылка выглядит как
    `…/Special:FilePath/Mohamed_Salah_2018.jpg?width=256`. Нас интересует
    только имя файла: ширина и прочие параметры к тому, ЧЕЙ это снимок,
    отношения не имеют.
    """
    if not url or "commons.wikimedia.org" not in url:
        return None
    m = re.search(r"Special:FilePath/([^?]+)", url)
    if not m:
        return None
    return urllib.parse.unquote(m.group(1)).replace("_", " ").strip()


def p18_of(payload):
    """QID → имя файла из P18, или None. ЧИСТАЯ ФУНКЦИЯ."""
    out = {}
    for qid, entity in ((payload or {}).get("entities") or {}).items():
        claims = ((entity or {}).get("claims") or {}).get("P18") or []
        name = None
        for claim in claims:
            try:
                name = claim["mainsnak"]["datavalue"]["value"]
                break
            except (KeyError, TypeError):
                continue
        out[qid] = (name or "").replace("_", " ").strip() or None
    return out


def verdict(stored, official, lead=None):
    """'ok' | 'wrong' | 'unknown'. ЧИСТАЯ ФУНКЦИЯ.

    `official` — P18 сущности, `lead` — главная картинка её же статьи.

    ⚠️ ТРИ ИСХОДА, А НЕ ДВА. «Ни одной опоры нет» и «опора есть, и снимок
    другой» — разные утверждения. Склеить их значит снять верные снимки у всех,
    у кого в Викиданных ничего не проставлено.

    ⚠️ СОВПАДЕНИЕ С ЛЮБОЙ ИЗ ОПОР — УЖЕ ok. Редакторы статьи и редакторы
    Викиданных часто выбирают разные снимки ОДНОГО человека, и объявлять
    чужаком того, кто стоит в его же статье, — это churn, а не починка.
    """
    if not stored:
        return "unknown"
    known = [x.lower() for x in (official, lead) if x]
    if not known:
        return "unknown"
    return "ok" if stored.lower() in known else "wrong"


def lead_images(payload):
    """Ответ pageimages → {заголовок: имя файла}. ЧИСТАЯ ФУНКЦИЯ."""
    out = {}
    for page in ((payload or {}).get("query") or {}).get("pages", {}).values():
        title = page.get("title")
        name = page.get("pageimage")
        if title and name:
            out[title] = name.replace("_", " ").strip()
    return out


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

    cards = all_rows("cards", {
        "select": "id,name,name_en,wikidata_qid,photo_url,pageviews",
        "category": "eq.player", "active": "is.true",
        "wikidata_qid": "not.is.null",
        "photo_url": "like.*commons.wikimedia.org*",
        "order": "pageviews.desc.nullslast"})
    if args.limit:
        cards = cards[:args.limit]
    print("Карточек со снимком из Commons и QID: %d  (APPLY=%s)"
          % (len(cards), "да" if apply_ else "нет — сухой прогон"), flush=True)

    official, enwiki = {}, {}
    qids = [c["wikidata_qid"] for c in cards]
    for i in range(0, len(qids), BATCH):
        payload = get("%s?action=wbgetentities&format=json&props=claims|sitelinks"
                      "&sitefilter=enwiki&ids=%s" % (WD, "|".join(qids[i:i + BATCH])))
        if payload is None:
            print("  ⚠️ пачка %d не ответила — эти карточки останутся непроверенными"
                  % (i // BATCH + 1), flush=True)
        else:
            official.update(p18_of(payload))
            for qid, e in ((payload.get("entities")) or {}).items():
                link = ((e.get("sitelinks") or {}).get("enwiki") or {}).get("title")
                if link:
                    enwiki[qid] = link
        if (i // BATCH) % 10 == 0:
            print("  P18 и статьи: %d/%d" % (min(i + BATCH, len(qids)), len(qids)), flush=True)
        time.sleep(PAUSE)

    # ВТОРАЯ ОПОРА: главная картинка статьи этого же QID. Спрашивается ТОЛЬКО у
    # тех, у кого P18 нет — тратить запросы на уже подтверждённых незачем.
    need_lead = sorted({enwiki[c["wikidata_qid"]] for c in cards
                        if not official.get(c["wikidata_qid"])
                        and enwiki.get(c["wikidata_qid"])})
    print("Без P18, спрашиваем статью: %d" % len(need_lead), flush=True)
    lead = {}
    for i in range(0, len(need_lead), BATCH):
        titles = "|".join(urllib.parse.quote(t) for t in need_lead[i:i + BATCH])
        payload = get("https://en.wikipedia.org/w/api.php?action=query&format=json"
                      "&prop=pageimages&piprop=name&titles=" + titles)
        if payload is not None:
            lead.update(lead_images(payload))
        if (i // BATCH) % 10 == 0:
            print("  статьи: %d/%d" % (min(i + BATCH, len(need_lead)), len(need_lead)), flush=True)
        time.sleep(PAUSE)

    wrong, unknown, ok = [], 0, 0
    for c in cards:
        qid = c["wikidata_qid"]
        right = official.get(qid) or lead.get(enwiki.get(qid) or "")
        v = verdict(file_of(c["photo_url"]), official.get(qid),
                    lead.get(enwiki.get(qid) or ""))
        if v == "wrong":
            wrong.append((c, right))
        elif v == "unknown":
            unknown += 1
        else:
            ok += 1

    print("-" * 70)
    print("Снимок совпал с P18   : %d" % ok)
    print("P18 не проставлен     : %d — НЕ ТРОГАЕМ, снимок может быть верным" % unknown)
    print("ЧУЖОЙ СНИМОК          : %d" % len(wrong))
    for c, right in wrong[:30]:
        print("   %-26s pv=%-8s было «%s» → надо «%s»"
              % ((c["name"] or "")[:26], c["pageviews"],
                 (file_of(c["photo_url"]) or "")[:38], right[:38]))

    if apply_ and wrong:
        for c, right in wrong:
            sb("cards", method="PATCH", params={"id": "eq." + c["id"]},
               body={"photo_url": COMMONS + urllib.parse.quote(right.replace(" ", "_"))
                                  + "?width=400"})
        print("\nСнимков заменено на настоящие: %d" % len(wrong))
    elif not apply_:
        print("\nСухой прогон. APPLY=1 — заменить чужие снимки.")


if __name__ == "__main__":
    main()
