# -*- coding: utf-8 -*-
"""Ревизия фото у карточек клубов, стадионов и прозвищ — по УЛИКЕ, а не по различию.

ЗАЧЕМ. Владелец прислал скриншот коллекции: карточка «Зенит» с диаграммой
астрономического зенита. Однословное название клуба в вики почти всегда занято
НЕ клубом: «Зенит» — это зенит и надир, «Брест» — город, «Ириски» — конфеты,
«Астана» — столица. P31-гард (`run.CARD_P31_ALLOW`) это ловит НА ВХОДЕ, но
появился он позже, чем записаны те строки, и старые никто не перепроверял.

⚠️ ЭТОТ ФАЙЛ ПЕРЕПИСАН 04.09.2026 ЦЕЛИКОМ. Прежняя версия сделала прогон на
313 карточек и предложила 45 замен, из которых применять было нельзя НИ ОДНОЙ.
Три её ошибки — это три правила ниже, и каждая видна в той выдаче:

  1. Она заменяла эмблемы ESPN на картинки из Википедии. «Анже» 7868.png →
     Angers_Sporting_Club_logo, «Аякс» 139.png → Logo_AFC_Ajax, «Милан»
     103.png → Logo_of_AC_Milan. А владелец сказал прямо: «эмблемы клубов
     бери с ESPN и его сделай основным», и `sync_club_card_crests` их туда
     как раз перенёс. Ревизия откатывала бы это каждую ночь.

  2. Она подставляла НЕ ЭМБЛЕМЫ. «Вардар» → NacionalnaArenaF2Skopje.jpg,
     «Зюлте-Варегем» → Regenboogstadion_2.0.jpg, «Мидтьюлланд» →
     MCH_Arena_Herning.JPG — фотографии СТАДИОНОВ на карточки клубов. Ровно
     тот класс ошибки, ради которого ревизию и писали («Астана» с фото
     города), только теперь его творила сама ревизия.

  3. Она считала уликой РАЗЛИЧИЕ: «нашлась клубная сущность, и её изображение
     не то, что в карточке» → менять. Но «другое» и «чужое» — разные вещи. У
     клуба бывает пять верных логотипов разных лет, и ни один из них не
     улика против остальных.

ПРАВИЛА, КОТОРЫМИ ЭТО ЛЕЧИТСЯ

  I. ОБВИНЕНИЕ ТРЕБУЕТ УЛИКИ. Карточка виновна, только если доказано, что её
     фото — это картинка ЧУЖОЙ сущности. Доказательство одно и оно прямое:
     резолв по голому имени приводит к статье, которую P31-гард отвергает
     (это не клуб и не стадион), И картинка той статьи СОВПАДАЕТ с тем, что
     лежит в карточке. Тогда видно не «отличается», а «вот откуда взялось».
     Совпадения нет — карточка не трогается, как бы подозрительно ни
     выглядела: первая версия ревизии ровно так оболгала «Амкар»,
     «Волеренгу» и «Кайзерслаутерн», у которых данные были верные.

 II. ЗАМЕНА БЕРЁТСЯ ТОЛЬКО ИЗ ИСТОЧНИКА, КОТОРЫЙ ЭМБЛЕМА ПО ПОСТРОЕНИЮ:
     * `football_club.crest_url` клуба, связанного с карточкой по `card_id`
       (это ESPN — основной источник по решению владельца), и связь тут по
       идентификатору, а не по имени;
     * `P154` («логотип») проверенной клубной сущности Викиданных.
     У стадиона эмблемы не бывает — там `P18` («изображение») проверенной
     сущности стадиона, и это тоже картинка ЕГО по построению.
     ⚠️ `pageimage` статьи НЕ ГОДИТСЯ и больше не используется: это «первая
     картинка статьи», а не «герб клуба», и именно она принесла три стадиона.

III. КАРТОЧКА С ЭМБЛЕМОЙ ESPN НЕ ТРОГАЕТСЯ ВОВСЕ. Она уже из основного
     источника, и спорить с ним ревизии не о чем.

 IV. НЕТ ЗАМЕНЫ — НЕТ ЗАПИСИ, НО ЕСТЬ ОТЧЁТ. Карточка с доказанно чужим фото,
     которой нечем помочь, печатается как SUSPECT. Молча оставить её значит
     потерять единственный случай, ради которого всё писалось.

ВЕРДИКТЫ
  FIX      улика есть, и есть эмблема по построению → меняем.
  SUSPECT  улика есть, замены нет → показываем человеку, не трогаем.
  KEEP     улики нет.

СУХОЙ ПРОГОН ПО УМОЛЧАНИЮ. APPLY=1 пишет, и запись сторожится текущим
значением: строка, изменённая кем-то между чтением и записью, остаётся как
есть. Запись идёт по одной карточке, и это НЕ «пачка по кускам»: каждая
строка сторожится своим прежним значением, поэтому повтор после обрыва
просто доделывает остаток.

    python docs/cards_club_photo_audit.py --tsv-out fixes.tsv
    APPLY=1 python docs/cards_club_photo_audit.py
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

from scraper.cache import FileCache                                 # noqa: E402
from scraper.pageviews import WikimediaBudget, WikiPagePropsClient   # noqa: E402
from scraper.wikidata import WikidataEnricher, commons_filepath_url  # noqa: E402

CATEGORIES = ("club", "club_nickname", "stadium")
# Хост, с которого приходят эмблемы ESPN. Карточка с такой ссылкой — уже из
# основного источника (правило III).
ESPN_HOST = "a.espncdn.com"
# Какая картинка «своя» для этой категории: у клуба — логотип, у стадиона —
# его собственное изображение. Свойство, а не догадка по имени файла.
MEDIA_PROP = {"club": "P154", "club_nickname": "P154", "stadium": "P18"}
PAGE = 1000


def image_key(u):
    """Имя файла без размера и параметров — чтобы сравнивать КАРТИНКИ, а не ссылки.

    ⚠️ Сравнение ссылок целиком объявляло заменой
    `Amkar_FC_logo_2021.png?width=256` → `330px-Amkar_FC_logo_2021.png?utm_source=…`,
    то есть тот же логотип в другом виде. Семь «находок» из семи были такими.
    Здесь же оно работает в обратную сторону — доказывает СОВПАДЕНИЕ картинки
    карточки с картинкой чужой статьи, — и потому обязано быть точным.
    """
    if not u:
        return ""
    name = urllib.parse.unquote(u.split("?")[0].rsplit("/", 1)[-1])
    if "px-" in name[:8]:              # миниатюра Викимедиа: «330px-Файл.png»
        name = name.split("px-", 1)[1]
    if name.lower().endswith(".svg.png"):   # «Logo.svg.png» и «Logo.svg» — одно
        name = name[:-4]
    return name.lower()


def verdict(current_photo, article_is_ours, foreign_image, crest, wd_media):
    """Вердикт по одной карточке. ЧИСТАЯ функция — её и зовёт тест.

    Копия правила в тесте проверяет копию: в test_title_match.py логика уже
    была переписана рядом, гард в переписи забыт — и тест был зелёным на
    поломке. Поэтому решение живёт здесь, а main() только собирает для него
    входные данные.

    Аргументы — это ровно четыре факта, каждый добывается отдельно:
      current_photo     что лежит в карточке сейчас;
      article_is_ours   прошла ли статья, куда ведёт голое имя, P31-гард;
      foreign_image     картинка той статьи (когда гард её отверг);
      crest             эмблема из справочника по card_id (ESPN);
      wd_media          P154/P18 проверенной сущности Викиданных.

    Возвращает (вердикт, ссылка_или_None, источник).
    """
    # Правило I: обвинение требует УЛИКИ, а не различия. Статья своя —
    # обвинять не в чем; картинки чужой статьи нет — доказательства нет;
    # картинка есть, но другая — значит фото карточки пришло не оттуда.
    if article_is_ours or not current_photo or not foreign_image:
        return "KEEP", None, "—"
    if image_key(foreign_image) != image_key(current_photo):
        return "KEEP", None, "—"

    # Правило II: замена — только из источника, который эмблема по построению.
    # Порядок не «что первое нашлось», а решение владельца: ESPN основной.
    if crest:
        return "FIX", crest, "ESPN (справочник, по card_id)"
    if wd_media:
        return "FIX", wd_media, "Викиданные"
    # Правило IV: заменить нечем — показать, но не трогать.
    return "SUSPECT", None, "—"


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


def read_all(url, key, path, params):
    """Страницами: PostgREST режет ответ по db-max-rows, и одна страница на
    тысячу строк молча выглядит как «столько и есть»."""
    out, offset = [], 0
    while True:
        page = sb(url, key, path,
                  params=dict(params, limit=PAGE, offset=offset))
        out.extend(page)
        if len(page) < PAGE:
            return out
        offset += PAGE


def espn_crest_by_card(url, key):
    """{card_id: crest_url} из справочника — связь по ИДЕНТИФИКАТОРУ.

    ⚠️ Не по имени. Сопоставление клубов по имени в этом проекте уже связывало
    «Крузейро» с `cruz azul` и выдавало «Vitória S.C.» герб бразильского
    EC Vitória. `football_club.card_id` — прямая ссылка, и ошибиться ей нечем.
    """
    rows = read_all(url, key, "football_club",
                    {"select": "card_id,crest_url", "card_id": "not.is.null",
                     "crest_url": "not.is.null", "order": "club_key"})
    return {r["card_id"]: r["crest_url"] for r in rows}


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="сколько карточек (0 — все)")
    ap.add_argument("--all-names", action="store_true",
                    help="не только однословные. Подмена вероятна именно у "
                         "однословных, а бюджет Wikimedia общий.")
    ap.add_argument("--tsv-out", default=None,
                    help="выписать вердикты таблицей: их читают глазами, а лог "
                         "прогона до следующей сессии не доживает")
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY не заданы")

    cards = read_all(url, key, "cards", {
        "select": "id,name,name_en,category,photo_url", "active": "is.true",
        "category": "in.(%s)" % ",".join(CATEGORIES), "order": "name,id"})
    if not args.all_names:
        # Однословное имя — единственный класс, где подмена вероятна: «Зенит»,
        # «Брест», «Ириски». У «Пари Сен-Жермен» тёзки не бывает.
        cards = [c for c in cards if " " not in (c["name"] or "").strip()]

    crest_of = espn_crest_by_card(url, key)

    # Правило III: карточка с эмблемой ESPN уже из основного источника.
    from_espn = [c for c in cards if ESPN_HOST in (c.get("photo_url") or "")]
    cards = [c for c in cards if ESPN_HOST not in (c.get("photo_url") or "")]
    if args.limit:
        cards = cards[:args.limit]

    print("Карточек к проверке : %d  (APPLY=%s)"
          % (len(cards), "да" if apply_ else "нет — сухой прогон"))
    print("Пропущено с ESPN    : %d — основной источник, ревизии не о чем "
          "с ним спорить" % len(from_espn))

    cfg = json.load(io.open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))
    pv = cfg["pageviews"]
    cache = FileCache(os.path.join(SCRAPER, cfg["cache"]["dir"]), cfg["cache"]["enabled"])
    budget = WikimediaBudget(
        cfg.get("photos", {}).get("daily_request_budget", 5000),
        os.path.join(SCRAPER, cfg["cache"]["dir"], "photos_budget.json"))
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget)
    filepath_base = cfg.get("photos", {}).get(
        "filepath_base", "https://commons.wikimedia.org/wiki/Special:FilePath")

    fixes, suspects, keep = [], [], 0
    for i, card in enumerate(cards, 1):
        cur = card.get("photo_url") or ""
        allow = run.CARD_P31_ALLOW.get(card["category"])
        titles = run.cards_photos_candidates(card)

        # --- УЛИКА (правило I) -------------------------------------------
        # Резолв БЕЗ гарда: нам нужна та статья, куда голое имя приводит на
        # самом деле, — включая ту, которую гард отверг бы.
        raw_qid, raw_title, _via = run.resolve_card_qid(
            resolver, card, titles, validate=lambda _q: True)
        is_ours = True
        foreign = None
        if raw_qid and cur and allow:
            is_ours = bool(set(wikidata.instance_of_qids(raw_qid)) & allow)
            if not is_ours:
                # Гард отверг статью. Улика — совпадение её картинки с той,
                # что лежит в карточке: тогда видно не «отличается», а
                # «вот откуда взялось».
                foreign = resolver.pageimage_for_title(raw_title, size=256)

        # Замена добывается только когда есть на что её тратить — то есть
        # когда улика уже налицо. Иначе прогон жёг бы бюджет на невиновных.
        wd_media = None
        if not is_ours and foreign and image_key(foreign) == image_key(cur):
            def validate(qid, _allow=allow):
                return bool(set(wikidata.instance_of_qids(qid)) & _allow)
            good_qid, _t, _v = run.resolve_card_qid(resolver, card, titles, validate)
            prop = MEDIA_PROP.get(card["category"], "P154")
            fname = wikidata.media_filename_for_qid(good_qid, prop) if good_qid else None
            if fname:
                wd_media = commons_filepath_url(fname, width=256, base=filepath_base)

        what, photo, src = verdict(cur, is_ours, foreign,
                                   crest_of.get(card["id"]), wd_media)
        if what == "KEEP":
            keep += 1
            if i % 25 == 0:
                print("  %d/%d, улик %d" % (i, len(cards), len(fixes) + len(suspects)),
                      flush=True)
            continue

        row = {"id": card["id"], "name": card["name"], "category": card["category"],
               "was": cur.rsplit("/", 1)[-1][:46], "cur": cur,
               "foreign_title": raw_title,
               "now": (photo or "").rsplit("/", 1)[-1][:46],
               "photo": photo, "src": src}
        (fixes if what == "FIX" else suspects).append(row)
        if i % 25 == 0:
            print("  %d/%d, улик %d" % (i, len(cards), len(fixes) + len(suspects)),
                  flush=True)

    print("-" * 78)
    print("FIX      улика есть, эмблема по построению найдена : %d" % len(fixes))
    print("SUSPECT  улика есть, заменить НЕЧЕМ                : %d" % len(suspects))
    print("KEEP     улики нет — карточка не тронута           : %d" % keep)

    # ⚠️ ПЕЧАТАЮТСЯ ВСЕ, А НЕ ПЕРВЫЕ ДВАДЦАТЬ ПЯТЬ. Этот прогон читают ГЛАЗАМИ
    # — так он и задуман. Разница между «прочитал 25 из 45» и «прочитал 45» —
    # это ровно та карточка, где резолв ошибся.
    for f in fixes:
        print("  FIX     %-20s %-30s → %-30s [%s; чужая статья: %s]"
              % (f["name"][:20], f["was"], f["now"], f["src"], f["foreign_title"]))
    for f in suspects:
        print("  SUSPECT %-20s %-30s  замены нет [чужая статья: %s]"
              % (f["name"][:20], f["was"], f["foreign_title"]))

    if args.tsv_out:
        rows = ["# Вердикты ревизии фото (docs/cards_club_photo_audit.py).",
                "# FIX применяется, SUSPECT — только показ: заменить нечем.",
                "# Читать ГЛАЗАМИ до применения.",
                "# вердикт\tid\tимя\tкатегория\tбыло\tстанет\tисточник\tчужая статья"]
        # ⚠️ НЕ `verdict`: имя переменной цикла затенило БЫ функцию verdict()
        # на всю область main() — Python считает имя локальным во всей
        # функции, и обращение к нему ВЫШЕ по коду падает UnboundLocalError.
        # Тот же класс, что записан в карте про plpgsql: имя, безупречное по
        # смыслу, ломает то, что написано верно.
        for label, lst in (("FIX", fixes), ("SUSPECT", suspects)):
            rows += ["%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s"
                     % (label, f["id"], f["name"], f["category"], f["was"],
                        f["now"], f["src"], f["foreign_title"]) for f in lst]
        io.open(args.tsv_out, "w", encoding="utf-8").write("\n".join(rows) + "\n")
        print("Таблица вердиктов выписана в %s" % args.tsv_out)

    if apply_ and fixes:
        for f in fixes:
            # Сторож: пишем только если значение всё ещё то, по которому судили.
            params = {"id": "eq." + f["id"]}
            params["photo_url"] = ("eq." + f["cur"]) if f["cur"] else "is.null"
            sb(url, key, "cards", method="PATCH", params=params,
               body={"photo_url": f["photo"]})
        print("Записано: %d" % len(fixes))
    elif fixes:
        print("\nСУХОЙ ПРОГОН — ничего не записано. Повторить с APPLY=1.")


if __name__ == "__main__":
    main()
