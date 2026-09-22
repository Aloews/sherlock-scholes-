# -*- coding: utf-8 -*-
"""Подписи к снимкам с Викисклада: автор, лицензия, страница файла.

ЗАЧЕМ. Лицензии Викисклада (CC BY, CC BY-SA всех версий) разрешают показывать
снимок КОММЕРЧЕСКИ и требуют за это одного: НАЗВАТЬ АВТОРА и лицензию. Замер
22.09.2026 на боевой базе: 7278 карточек показывают снимок оттуда, 7072
разных файла, подпись — у нуля. То есть условие, на котором эти файлы
разрешено брать, не выполнялось ни разу.

⚠️ ЭТО НЕ «МЕТКА В БАЗЕ», А ИМЕННО ПОДПИСЬ. Спрятанный в колонке автор
лицензию не удовлетворяет: она требует, чтобы имя видел тот, кто смотрит
снимок. База здесь — только хранилище; показывает подпись экран досье.

ЧТО СОБИРАЕТСЯ. `action=query&prop=imageinfo&iiprop=extmetadata` отдаёт по
файлу поля `Artist`, `LicenseShortName`, `LicenseUrl`, а `url`-свойство —
`descriptionurl`, то есть страницу файла. Ровно это и нужно для подписи вида

    фото: Иван Иванов · CC BY-SA 4.0 · Wikimedia Commons

⚠️ «АВТОРА НЕТ» — ЗАКОННЫЙ ОТВЕТ, А НЕ ПРОБЕЛ. Часть файлов в общественном
достоянии, и `Artist` у них пуст. Поэтому строка в `media_credit` пишется
ВСЕГДА, когда у источника спросили, а `author` внутри неё может быть NULL:
наличие строки значит «спросили», пустой автор — «автора не указано». Без
этого различия повторный прогон вечно переспрашивал бы одни и те же файлы,
а ревизия вечно считала бы их неподписанными.

⚠️ `Artist` ПРИХОДИТ РАЗМЕТКОЙ, А НЕ ТЕКСТОМ. Внутри бывает
`<a href="/wiki/User:Kto">Кто</a>`, таблица с несколькими авторами, перевод
в `<span lang="ru">`. Подпись обязана быть текстом, поэтому разметка
снимается здесь, а не на экране: иначе в карточку уедет HTML.

⚠️ КЛЮЧ — ССЫЛКА, А НЕ КАРТОЧКА. Один и тот же файл лежит в `cards`,
`players_meta` и кэше витрины (7278 + 1844 + 1750 ссылок на 7072 файла).
Подпись принадлежит файлу, и хранится она по ссылке: подписали один раз —
подписаны все три места.

ЗАПУСК (сухой по умолчанию; APPLY=1 пишет):
    python docs/cards_photo_credits.py --limit 20
    APPLY=1 python docs/cards_photo_credits.py --limit 500
    APPLY=1 python docs/cards_photo_credits.py --minutes 25
"""
import argparse
import html
import importlib.util
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

_spec = importlib.util.spec_from_file_location("_sb", os.path.join(HERE, "_sb.py"))
_sb = importlib.util.module_from_spec(_spec)
sys.modules["_sb"] = _sb
_spec.loader.exec_module(_sb)

API = "https://commons.wikimedia.org/w/api.php"
# Викимедиа требует называться. Контакт — не вежливость, а их правило.
UA = "sherlock-scholes-bot/1.0 (+https://github.com/Aloews/sherlock-scholes-)"
# Предел API для обычного клиента. Больше — ответ «too many values».
API_BATCH = 50
# Тот же контракт вежливости, что у остального конвейера.
PAUSE = 1.0
# Пачка записи маленькая: прогон обрывается, и потерять хочется минуту, а не всё.
WRITE_BATCH = 100
PAGE = 1000            # PostgREST режет по db-max-rows


# ─── Разбор, без сети ───────────────────────────────────────────────────────

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def file_title_from_url(url):
    """Имя файла на Викискладе из ссылки, которую мы храним. None — не оттуда.

    ⚠️ ФОРМ ССЫЛКИ ТРИ, И ОНИ НЕ СВОДЯТСЯ ОДНА К ДРУГОЙ:

      Special:FilePath/Имя.jpg?width=256     — так пишет наш сборщик фото;
      upload…/commons/a/ab/Имя.jpg           — прямая ссылка на файл;
      upload…/commons/thumb/a/ab/Имя.jpg/256px-Имя.jpg
                                             — уменьшённая копия: имя файла
                                               стоит ПЕРЕД последним сегментом,
                                               а последний — это «256px-…».
    """
    if not url:
        return None
    path = urllib.parse.urlsplit(url).path
    m = re.search(r"/Special:FilePath/(.+)$", path)
    if m:
        return urllib.parse.unquote(m.group(1)).replace("_", " ").strip() or None
    m = re.search(r"/commons/thumb/[0-9a-f]/[0-9a-f]{2}/([^/]+)/", path)
    if m:
        return urllib.parse.unquote(m.group(1)).replace("_", " ").strip() or None
    m = re.search(r"/commons/[0-9a-f]/[0-9a-f]{2}/([^/]+)$", path)
    if m:
        return urllib.parse.unquote(m.group(1)).replace("_", " ").strip() or None
    return None


def plain(markup):
    """Текст из размётки `Artist`. Пустая строка → None: пусто и есть пусто."""
    if not markup:
        return None
    txt = _TAG.sub(" ", markup)
    txt = html.unescape(txt)
    txt = _WS.sub(" ", txt).strip()
    return txt or None


def credit_from_imageinfo(info):
    """Подпись из одного элемента `imageinfo`. Возвращает dict без ссылки-ключа."""
    meta = (info or {}).get("extmetadata") or {}

    def val(name):
        v = meta.get(name)
        return (v or {}).get("value")

    return {
        "author": plain(val("Artist")),
        "license": plain(val("LicenseShortName")),
        "license_url": (val("LicenseUrl") or None),
        "credit_url": (info or {}).get("descriptionurl") or None,
    }


# ─── Сеть ───────────────────────────────────────────────────────────────────

def api_extmetadata(titles, timeout=60):
    """{имя файла: imageinfo} для пачки имён. Отсутствующий файл не попадает."""
    params = {
        "action": "query", "format": "json", "formatversion": "2",
        "prop": "imageinfo", "iiprop": "extmetadata|url",
        "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl|Credit",
        "titles": "|".join("File:" + t for t in titles),
    }
    req = urllib.request.Request(
        API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as fh:
        data = json.loads(fh.read())
    out = {}
    for page in (data.get("query") or {}).get("pages") or []:
        if page.get("missing"):
            continue
        ii = page.get("imageinfo") or []
        if not ii:
            continue
        title = re.sub(r"^File:", "", page.get("title") or "")
        out[title] = ii[0]
    return out


def commons_photos_without_credit():
    """Ссылки на снимки Викисклада БЕЗ подписи — из всех таблиц, где они лежат.

    ⚠️ ОДНИМИ КАРТОЧКАМИ НЕ ОБОЙТИСЬ, И ЭТО ПОКАЗАЛА РЕВИЗИЯ. Первая версия
    читала только `cards`, отработала — и ревизия осталась красной: 777
    снимков в `players_meta` и 20 в кэше витрины были с Викисклада, но в
    колоду не попали. На экране они показываются так же, и подпись им нужна
    так же.

    ⚠️ ОТБОР ПО ХОСТУ, А НЕ ПО `photo_source`. Колонка происхождения есть
    только у `cards`; хост есть у всех, и он и ЕСТЬ определение «это с
    Викисклада».
    """
    hosts = ("commons.wikimedia.org", "upload.wikimedia.org", "thumb.wikimedia.org")
    where = "or=(" + ",".join("photo_url.like.https://%s/*" % h for h in hosts) + ")"

    urls = []
    for table in ("cards", "players_meta", "player_spotlight_cache"):
        offset = 0
        while True:
            # ⚠️ СТРАНИЦАМИ. PostgREST режет ответ по db-max-rows (тысяча), и
            # по обрезку этот скрипт «закончил бы» на седьмой части колоды.
            got = _sb.sb(table + "?" + where, params={
                "select": "photo_url", "limit": PAGE, "offset": offset})
            if got is None:
                raise SystemExit(
                    "не смогли прочитать %s — считать было бы по обрезку" % table)
            urls.extend(r["photo_url"] for r in got if r.get("photo_url"))
            if len(got) < PAGE:
                break
            offset += PAGE

    done, offset = set(), 0
    while True:
        got = _sb.sb("media_credit", params={
            "select": "url", "limit": PAGE, "offset": offset})
        if got is None:
            raise SystemExit("не смогли прочитать media_credit")
        done.update(r["url"] for r in got)
        if len(got) < PAGE:
            break
        offset += PAGE

    # dict.fromkeys, а не set: порядок повторяемый, и прогон воспроизводим.
    return [u for u in dict.fromkeys(urls) if u not in done]


def write(rows):
    """Пачка подписей одним upsert'ом."""
    return _sb.sb("media_credit", method="POST", body=rows,
                  params={"on_conflict": "url"}) is not None


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="сколько файлов спросить")
    ap.add_argument("--minutes", type=int, default=0,
                    help="срок: дописать собранное и выйти")
    args = ap.parse_args()
    apply_ = os.environ.get("APPLY") == "1"

    todo = commons_photos_without_credit()
    print("Снимков Викисклада без подписи: %d" % len(todo), flush=True)
    if args.limit:
        todo = todo[:args.limit]
    if not todo:
        print("Подписаны все. Ничего делать не нужно.")
        return 0

    by_title = {}
    skipped = []
    for url in todo:
        t = file_title_from_url(url)
        if t:
            by_title.setdefault(t, []).append(url)
        else:
            skipped.append(url)
    if skipped:
        print("⚠️ Имя файла не разобрано у %d ссылок, например: %s"
              % (len(skipped), skipped[0]), flush=True)

    titles = list(by_title)
    deadline = time.time() + args.minutes * 60 if args.minutes else None
    pending, asked, authored, wrote, missed = [], 0, 0, 0, 0

    for i in range(0, len(titles), API_BATCH):
        if deadline and time.time() > deadline:
            print("\n⏱ Срок %d мин вышел на %d из %d файлов — дописываю и выхожу"
                  % (args.minutes, asked, len(titles)), flush=True)
            break
        chunk = titles[i:i + API_BATCH]
        # ⚠️ 429 — ЭТО «ПОДОЖДИ», А НЕ «НЕТ», И ПАЧКУ НАДО ПОВТОРИТЬ.
        # Первый прогон 22.09.2026 просто пропускал такую пачку и уходил
        # дальше: пятьдесят файлов оставались неподписанными, а счётчик
        # «спрошено» их даже не считал — то есть прогон выглядел полным,
        # не будучи им. Ждём дольше с каждым разом и только потом сдаёмся.
        got, why = None, ""
        for attempt in range(3):
            try:
                got = api_extmetadata(chunk)
                break
            except Exception as e:                               # noqa: BLE001
                why = str(e)[:120]
                time.sleep(PAUSE * 5 * (attempt + 1))
        if got is None:
            print("  ⚠️ Викисклад не ответил на пачку %d трижды: %s — эти %d файлов "
                  "останутся на следующий прогон" % (i // API_BATCH, why, len(chunk)),
                  flush=True)
            missed += len(chunk)
            continue
        asked += len(chunk)

        for title in chunk:
            info = got.get(title)
            if info is None:
                # Файла нет (переименован, удалён). Строку НЕ пишем: спросить
                # ещё будет что, а пустая строка навсегда объявила бы его
                # подписанным.
                continue
            credit = credit_from_imageinfo(info)
            if credit["author"]:
                authored += 1
            for url in by_title[title]:
                pending.append(dict(credit, url=url, source_key="wikimedia_commons"))

        if apply_ and len(pending) >= WRITE_BATCH:
            if write(pending):
                wrote += len(pending)
            pending = []
        print("  %d/%d файлов, подписей готово %d" % (asked, len(titles), wrote + len(pending)),
              flush=True)
        time.sleep(PAUSE)

    if apply_ and pending:
        if write(pending):
            wrote += len(pending)
        pending = []

    print("\nСпрошено файлов: %d из %d, с автором: %d" % (asked, len(titles), authored))
    if missed:
        print("⚠️ Не спрошено из-за отказов источника: %d — повторный прогон доберёт"
              % missed)
    if apply_:
        print("Записано подписей (по ссылкам): %d" % wrote)
    else:
        print("Сухой прогон: записалось бы %d подписей. APPLY=1 — записать."
              % len(pending))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
