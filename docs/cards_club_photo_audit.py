# -*- coding: utf-8 -*-
"""Ревизия фото и name_en у карточек КЛУБОВ, стадионов и прозвищ.

ЗАЧЕМ. У людей такая ревизия есть (`cards_name_en_audit.py`), у клубов не было
— а промах там ровно того же рода и виден в игре сразу. Владелец прислал
скриншот коллекции: карточка «Зенит» с диаграммой астрономического зенита,
рядом «Сине-бело-голубые» с настоящей эмблемой клуба.

    Зенит      name_en = «Zenith»,  фото Equinox-NO-Zenit-Nadir.jpg
    Арминия    name_en = «Arminius», фото памятника вождю херусков
    Астана     фото города
    Ириски     фото ирисок

Однословное название клуба в вики почти всегда занято НЕ клубом: «Зенит» — это
зенит и надир, «Брест» — город, «Канарейки» — птица. P31-гард
(`run.CARD_P31_ALLOW`) это уже ловит НА ВХОДЕ, но появился он позже, чем
записаны эти строки, и старые никто не перепроверял.

⚠️ ПОЧЕМУ «ГАРД ОТВЕРГ РЕЗОЛВ» — ЭТО НЕ ПРИГОВОР. Первая версия этой проверки
считала виноватой каждую карточку, чей резолв гард не пропустил, и обвинила
«Амкар» (name_en `FC Amkar Perm`, фото `Amkar_FC_logo_2021.png`), «Волеренгу»
и «Кайзерслаутерн» — у всех троих данные ВЕРНЫЕ. Резолв статьи и содержимое
карточки — разные вещи: фото могло попасть верным путём, а статья по голому
имени не находиться. Поэтому вердикт выносится по НАЙДЕННОЙ КЛУБНОЙ СУЩНОСТИ,
а не по факту отказа.

ВЕРДИКТЫ, каждый — с доказательством:

  FIX    гард НАШЁЛ клубную сущность, и её изображение отличается от того,
         что лежит в карточке → меняем на изображение самого клуба.
  KEEP   всё остальное, включая «не проверить». Карточка не трогается по
         подозрению — только по найденной замене.

СУХОЙ ПРОГОН ПО УМОЛЧАНИЮ. APPLY=1 пишет, и запись сторожится текущим
значением: строка, изменённая кем-то между чтением и записью, остаётся как
есть, а не затирается.

    python docs/cards_club_photo_audit.py                # показать
    python docs/cards_club_photo_audit.py --limit 40
    APPLY=1 python docs/cards_club_photo_audit.py        # записать
"""
import argparse
import importlib.util
import io
import json
import os
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRAPER = os.path.join(ROOT, "football_scraper")
sys.path.insert(0, SCRAPER)

_spec = importlib.util.spec_from_file_location(
    "run", os.path.join(SCRAPER, "run.py"))
run = importlib.util.module_from_spec(_spec)
sys.modules["run"] = run
_spec.loader.exec_module(run)

from scraper.cache import FileCache                                # noqa: E402
from scraper.pageviews import WikimediaBudget, WikiPagePropsClient  # noqa: E402
from scraper.wikidata import WikidataEnricher                      # noqa: E402

CATEGORIES = ("club", "club_nickname", "stadium")


def image_key(u):
    """Имя файла без размера и параметров — чтобы сравнивать КАРТИНКИ, а не ссылки.

    ⚠️ Первая версия сравнивала ссылки целиком и объявляла заменой
    `Amkar_FC_logo_2021.png?width=256` → `330px-Amkar_FC_logo_2021.png?utm_source=…`,
    то есть тот же логотип в другом виде. Семь «находок» из семи оказались
    такими; настоящая была одна и потерялась среди них.
    """
    if not u:
        return ""
    name = urllib.parse.unquote(u.split("?")[0].rsplit("/", 1)[-1])
    # Викимедиа отдаёт миниатюры как «330px-Файл.png» — размер к делу не идёт.
    if "px-" in name[:8]:
        name = name.split("px-", 1)[1]
    # У миниатюры svg получает хвост .png: «Logo.svg.png» и «Logo.svg» — одно.
    if name.lower().endswith(".svg.png"):
        name = name[:-4]
    return name.lower()


def sb(url, key, path, method="GET", body=None, params=None):
    full = url.rstrip("/") + "/rest/v1/" + path
    if params:
        full += "?" + urllib.parse.urlencode(params)
    headers = {"apikey": key, "Authorization": "Bearer " + key,
               "Content-Type": "application/json", "Prefer": "return=minimal"}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(full, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as fh:
        raw = fh.read()
    return json.loads(raw) if raw else []


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="сколько карточек (0 — все)")
    ap.add_argument("--all-names", action="store_true",
                    help="не только однословные. Риск подмены там ниже, а "
                         "бюджет Wikimedia общий — по умолчанию только они.")
    ap.add_argument("--tsv-out", default=None,
                    help="выписать замены таблицей — их читают глазами, а "
                         "лог прогона до следующей сессии не доживает")
    args = ap.parse_args()
    apply = os.environ.get("APPLY") == "1"

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY не заданы")

    cards = sb(url, key, "cards", params={
        "select": "id,name,name_en,category,photo_url", "active": "is.true",
        "category": "in.(%s)" % ",".join(CATEGORIES),
        "order": "name", "limit": 2000})
    if not args.all_names:
        # Однословное имя — единственный класс, где подмена вероятна: «Зенит»,
        # «Брест», «Ириски». У «Пари Сен-Жермен» тёзки не бывает.
        cards = [c for c in cards if " " not in (c["name"] or "").strip()]
    if args.limit:
        cards = cards[:args.limit]
    print("Карточек к проверке: %d  (APPLY=%s)"
          % (len(cards), "да" if apply else "нет — сухой прогон"))

    cfg = json.load(io.open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))
    pv = cfg["pageviews"]
    cache = FileCache(os.path.join(SCRAPER, cfg["cache"]["dir"]), cfg["cache"]["enabled"])
    budget = WikimediaBudget(
        cfg.get("photos", {}).get("daily_request_budget", 5000),
        os.path.join(SCRAPER, cfg["cache"]["dir"], "photos_budget.json"))
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget)

    fixes, keep = [], 0
    for i, card in enumerate(cards, 1):
        allow = run.CARD_P31_ALLOW.get(card["category"])

        def validate(qid, _allow=allow):
            return bool(set(wikidata.instance_of_qids(qid)) & _allow) if _allow else True

        titles = run.cards_photos_candidates(card)
        qid, title, _via = run.resolve_card_qid(resolver, card, titles, validate)
        if not qid:
            keep += 1                       # нечем заменить — не трогаем
        else:
            photo = resolver.pageimage_for_title(title, size=256)
            cur = card.get("photo_url") or ""
            if photo and image_key(photo) != image_key(cur):
                fixes.append({"id": card["id"], "name": card["name"],
                              "was": cur.rsplit("/", 1)[-1][:44],
                              "now": photo.rsplit("/", 1)[-1][:44],
                              "photo": photo, "cur": cur, "title": title})
            else:
                keep += 1
        if i % 25 == 0:
            print("  %d/%d, замен %d" % (i, len(cards), len(fixes)), flush=True)

    print("-" * 74)
    print("FIX  (нашлась клубная сущность с другим изображением): %d" % len(fixes))
    print("KEEP (замены нет — карточка не тронута)              : %d" % keep)
    # ⚠️ ПЕЧАТАЮТСЯ ВСЕ, А НЕ ПЕРВЫЕ ДВАДЦАТЬ ПЯТЬ. Этот прогон читают ГЛАЗАМИ
    # — так он и задуман, — и обрезка списка означала, что часть замен
    # применяется непрочитанной. Разница между «прочитал 25 из 30» и
    # «прочитал 30» — это ровно та карточка, где резолв ошибся.
    for f in fixes:
        print("  %-22s %-44s → %s" % (f["name"][:22], f["was"], f["now"]))
    if args.tsv_out:
        rows = ["# Замены фото у карточек клубов, найденные "
                "docs/cards_club_photo_audit.py.",
                "# Читать ГЛАЗАМИ до применения: резолв ошибается молча.",
                "# id\tимя\tбыло\tстанет"]
        rows += ["%s\t%s\t%s\t%s" % (f["id"], f["name"], f["was"], f["now"])
                 for f in fixes]
        io.open(args.tsv_out, "w", encoding="utf-8").write("\n".join(rows) + "\n")
        print("Таблица замен выписана в %s" % args.tsv_out)

    if apply and fixes:
        for f in fixes:
            # Сторож: пишем только если значение всё ещё то, по которому судили.
            params = {"id": "eq." + f["id"]}
            if f["cur"]:
                params["photo_url"] = "eq." + f["cur"]
            else:
                params["photo_url"] = "is.null"
            sb(url, key, "cards", method="PATCH", params=params,
               body={"photo_url": f["photo"]})
        print("Записано: %d" % len(fixes))
    elif fixes:
        print("\nСУХОЙ ПРОГОН — ничего не записано. Повторить с APPLY=1.")


if __name__ == "__main__":
    main()
