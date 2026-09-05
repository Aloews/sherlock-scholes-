# -*- coding: utf-8 -*-
"""Карта «страна карточки → языковые разделы Википедии, которые там читают».

ЗАЧЕМ. Известность игрока меряется просмотрами, а до 04.09.2026 мерилась по
ДЕВЯТИ языкам интерфейса (ru en es pt fr zh ja ko ar). Турка, поляка, иранца,
серба и нигерийца это меряет языками, на которых их не читает никто: у них
просто нет «своей» колонки. Отсюда вторая ось — известность ДОМА, и ей нужна
карта «страна → язык».

⚠️ КАРТА ВЫВЕДЕНА ИЗ ВИКИДАННЫХ, А НЕ НАПИСАНА ПО ПАМЯТИ, И ВСЁ РАВНО
ПРОЧИТАНА ГЛАЗАМИ. Один запрос к WDQS даёт `P297` (alpha-2) → `P37`
(официальный язык) → `P424` (код языка Викимедиа). Этого мало, и вот чем
именно — каждая строка ниже найдена глазами в выдаче на боевой выборке колоды:

  US  → ch, es, haw, sm      у США НЕТ федерального государственного языка,
                             и P37 перечисляет языки территорий. Без поправки
                             «домашним» языком американца становится
                             ИСПАНСКИЙ — 88 карточек.
  GB-ENG / GB-SCT / GB-WLS   это коды ПОДРАЗДЕЛЕНИЙ, у них P297 нет вовсе;
                             в колоде так записаны 178 карточек.
  UY  → ничего               у Уругвая P37 без кода Викимедиа.
  ME  → ничего               черногорский `cnr` раздела не имеет.
  BF  → mos                  Буркина-Фасо: раздел на море существует, но
                             читают там французский.
  ML  → bm, ff               то же самое у Мали.

⚠️ КОД ЯЗЫКА ≠ КОД РАЗДЕЛА. P424 отдаёт `zh-cn`, а Википедия называется
`zh`; `nb` против `no`. Нормализация здесь, отсев несуществующих разделов —
по живому списку `sitematrix` с meta.wikimedia.org, а не по догадке.

⚠️ ЛИШНИЙ МАЛЕНЬКИЙ РАЗДЕЛ НЕ ВРЕДИТ. Домашняя известность берётся как
МАКСИМУМ по языкам страны, а раздел на языке, которого почти никто не читает,
максимума не даёт. Поэтому список языков страны сознательно широкий: {fr, wo}
у Сенегала, {de, fr, it, rm} у Швейцарии — выбирает не список, а сами
просмотры.

ЗАПУСК (только чтение сети; на выходе SQL, который кладут в миграцию):
    python docs/country_wiki_lang_build.py --sql-out supabase/migrations/country_wiki_lang.sql
"""
import argparse
import collections
import io
import json
import os
import time
import urllib.parse
import urllib.request

UA = ("sherlock-scholes-country-lang/1.0 "
      "(https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
WDQS = "https://query.wikidata.org/sparql"
SITEMATRIX = ("https://meta.wikimedia.org/w/api.php?action=sitematrix"
              "&format=json&smtype=language&smlangprop=code|site")

QUERY = """SELECT ?iso ?code WHERE {
  ?country wdt:P297 ?iso .
  ?country wdt:P37 ?lang .
  ?lang wdt:P424 ?code .
}"""

# Код языка у Викиданных и код РАЗДЕЛА Википедии — разные словари.
NORMALIZE = {"zh-cn": "zh", "zh-tw": "zh", "pt-br": "pt", "nb": "no",
             "als": "gsw"}

# ⚠️ ПОПРАВКИ, ПРОЧИТАННЫЕ ГЛАЗАМИ. Причина у каждой — в шапке файла.
# Это НЕ «дополнить на всякий случай»: без них восемь стран и 178 карточек
# получают чужой домашний язык или не получают никакого.
OVERRIDES = {
    "US":     ["en"],
    "GB-ENG": ["en"],
    "GB-SCT": ["en", "gd", "sco"],
    "GB-WLS": ["en", "cy"],
    "UY":     ["es"],
    "ME":     ["sr", "bs", "hr"],
    "BF":     ["fr"],
    "ML":     ["fr"],
}


# WDQS при лимитировании прямо пишет «Aggressively rate-limiting to 1 req/min».
# Откат короче заявленного лимита — это ОТСУТСТВИЕ отката: три попытки сгорают
# за двенадцать секунд, и прогон отчитывается ошибкой там, где хватило бы
# подождать минуту. Этот проект уже наступал на это в сборщике составов.
RATE_LIMIT_PAUSE = 65.0
RETRIES = 5


def fetch(url, params=None, data=None):
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    for attempt in range(RETRIES):
        req = urllib.request.Request(
            url, data=data,
            headers={"User-Agent": UA,
                     "Accept": "application/sparql-results+json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as fh:
                return json.load(fh)
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 503) or attempt + 1 == RETRIES:
                raise
            wait = exc.headers.get("Retry-After")
            delay = (min(float(wait), 300) if wait and str(wait).isdigit()
                     else RATE_LIMIT_PAUSE)
            print("  %d от %s, жду %.0fс (попытка %d из %d)…"
                  % (exc.code, urllib.parse.urlparse(url).netloc, delay,
                     attempt + 2, RETRIES), flush=True)
            time.sleep(delay)
    raise RuntimeError("недостижимо")


def live_wikipedias():
    """Коды ЖИВЫХ языковых Википедий по sitematrix — не по догадке."""
    d = fetch(SITEMATRIX)
    out = set()
    for k, v in (d.get("sitematrix") or {}).items():
        if not k.isdigit():
            continue
        for s in v.get("site") or []:
            if s.get("code") == "wiki" and not s.get("closed"):
                out.add(v["code"])
    return out


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sql-out", default=None)
    ap.add_argument("--wdqs-cache", default=None,
                    help="файл с ответом WDQS: читается, если есть, иначе "
                         "пишется. При лимите 1 запрос в минуту повтор прогона "
                         "иначе снова упирается в него и теряет тот же ответ")
    args = ap.parse_args()

    wikis = live_wikipedias()
    print("Живых языковых Википедий: %d" % len(wikis))

    if args.wdqs_cache and os.path.exists(args.wdqs_cache):
        res = json.load(io.open(args.wdqs_cache, encoding="utf-8"))
        print("Ответ WDQS взят из %s" % args.wdqs_cache)
    else:
        time.sleep(1.0)
        res = fetch(WDQS, data=urllib.parse.urlencode({"query": QUERY}).encode())
        if args.wdqs_cache:
            json.dump(res, io.open(args.wdqs_cache, "w", encoding="utf-8"))
    rows = res["results"]["bindings"]
    print("Пар «страна — язык» у Викиданных: %d" % len(rows))

    m = collections.defaultdict(set)
    for r in rows:
        code = NORMALIZE.get(r["code"]["value"].lower(), r["code"]["value"].lower())
        if code in wikis:
            m[r["iso"]["value"].upper()].add(code)

    added = 0
    for iso, langs in OVERRIDES.items():
        for lang in langs:
            if lang in wikis and lang not in m[iso]:
                m[iso].add(lang)
                added += 1
    print("Стран после отсева и поправок: %d (поправками добавлено %d языков)"
          % (len(m), added))

    pairs = sorted((iso, lang) for iso, langs in m.items() for lang in langs)
    print("Строк карты: %d" % len(pairs))

    if args.sql_out:
        out = [
            "-- =========================================================================",
            "-- country_wiki_lang — какие языковые разделы Википедии читают в стране.",
            "--",
            "-- СГЕНЕРИРОВАНО docs/country_wiki_lang_build.py. Не править руками:",
            "-- поправки, прочитанные глазами, живут в OVERRIDES того файла, вместе",
            "-- с причиной каждой. Полное обоснование — в его шапке.",
            "--",
            "-- Источник: Викиданные P297 (alpha-2) → P37 (офиц. язык) → P424 (код",
            "-- языка Викимедиа), отсеяно по живому sitematrix, плюс %d поправки." % added,
            "-- Строк: %d, стран: %d." % (len(pairs), len(m)),
            "--",
            "-- ⚠️ ШИРОКИЙ СПИСОК — ЭТО НЕ НЕБРЕЖНОСТЬ. Домашняя известность берётся",
            "-- как МАКСИМУМ по языкам страны, и раздел, которого никто не читает,",
            "-- максимума не даёт. Выбирает не список, а просмотры.",
            "-- =========================================================================",
            "create table if not exists public.country_wiki_lang (",
            "  country_code text not null,",
            "  lang         text not null,",
            "  primary key (country_code, lang)",
            ");",
            "",
            "comment on table public.country_wiki_lang is",
            "  'Страна карточки (alpha-2 или код подразделения, как в cards.country) '",
            "  '-> языковые разделы Википедии, которые там читают. Генерируется '",
            "  'docs/country_wiki_lang_build.py из Викиданных.';",
            "",
            "-- Полная перезаливка одной транзакцией: карта — производная, и",
            "-- «дописать поверх» оставило бы строки, которых у источника уже нет.",
            "begin;",
            "delete from public.country_wiki_lang;",
            "insert into public.country_wiki_lang (country_code, lang) values",
        ]
        out.append(",\n".join("  ('%s', '%s')" % p for p in pairs) + ";")
        out += [
            "commit;",
            "",
            "-- Грант перечислен явно: политика без гранта роняла этот проект дважды.",
            "alter table public.country_wiki_lang enable row level security;",
            "drop policy if exists country_wiki_lang_read on public.country_wiki_lang;",
            "create policy country_wiki_lang_read on public.country_wiki_lang",
            "  for select to anon, authenticated, service_role using (true);",
            "grant select on public.country_wiki_lang to anon, authenticated;",
            "-- Конвейер эту карту ПЕРЕЗАЛИВАЕТ, поэтому ему мало select.",
            "-- Грант на UPDATE забывали здесь уже дважды, и отказ был тихим:",
            "-- «75 прочитано, 0 записано», оба числа правдоподобны.",
            "grant select, insert, update, delete on public.country_wiki_lang",
            "  to service_role;",
            "",
            "NOTIFY pgrst, 'reload schema';",
        ]
        io.open(args.sql_out, "w", encoding="utf-8").write("\n".join(out) + "\n")
        print("SQL выписан в %s" % args.sql_out)


if __name__ == "__main__":
    main()
