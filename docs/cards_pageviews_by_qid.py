# -*- coding: utf-8 -*-
"""Просмотры новым карточкам ПО ГОТОВОМУ QID — без резолва по имени.

ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ, КОГДА ЕСТЬ cards_pageviews_i18n. Тот скрипт начинает с
имени карточки и ищет статью: батчами по ру-вики для игроков, резолвером
конвейера для остальных. Это единственный путь для карточки, заведённой
руками, — и он ошибается ровно там, где имя не совпало с титулом. Замер
03.09.2026, четыре первые карточки очереди:

    Гарри Невилл      → не найдено   (в ру-вики «Невилл, Гари»)
    Хын Мин Сон       → не найдено   (в ру-вики «Сон Хын Мин»)
    Расмус Хёйлунн    → не найдено
    Скотт МакТоминэй  → не найдено

Карточкам из docs/clubs_squads_wikidata.py --create-cards угадывать нечего:
их имя ВЗЯТО из Викиданных, и сборщик выписал рядом QID, откуда взял. Здесь
этот QID и используется — сразу sitelinks, сразу просмотры.

ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО. Голая карточка не растит состав: уровень состава в
прогнозах (`fixture_squad_strength`) считает только тех, у кого есть
`cards.fame`, а слава берётся из просмотров. Завести карточки и остановиться
значит добавить в колоду людей без фотографии, ничего не прибавив к тому,
ради чего их заводили.

⚠️ СЛАВА — ПЕРЦЕНТИЛЬ. Пока у новичков нет просмотров, они стоят в самом низу
шкалы и поднимают перцентиль ВСЕХ остальных: замер на 2918 активных игроках —
853 новичка без просмотров двигают медиану с 50 на 61. Поэтому
refresh_card_fame зовут ПОСЛЕ этого скрипта, а не между ним и заведением.

ЗАПУСК (только чтение сети; записи нет — на выходе SQL):
    python docs/cards_pageviews_by_qid.py --from-sql cards.sql --sql-out pv.sql
    python docs/cards_pageviews_by_qid.py --from-sql cards.sql --limit 20
"""
import argparse
import importlib.util
import io
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))

_spec = importlib.util.spec_from_file_location(
    "cards_pageviews_i18n", os.path.join(HERE, "cards_pageviews_i18n.py"))
pvi = importlib.util.module_from_spec(_spec)
sys.modules["cards_pageviews_i18n"] = pvi
_spec.loader.exec_module(pvi)

# Строка вставки карточки, как её пишет clubs_squads_wikidata --sql-out:
#   ('uuid', 'Имя', 'Name', 'player', 'игроки'),  -- Q12345
# Запятая-разделитель стоит ДО комментария (иначе она в него и попадёт).
CARD_RE = re.compile(
    r"^\s*\('([0-9a-f-]{36})',\s*'(.*?)',\s*(?:'(?:.*?)'|null),"
    r"\s*'player',\s*'[^']*'\),?\s*--\s*(Q\d+)\s*$")


def cards_from_sql(path):
    """[(card_id, name, qid)] из выписки сборщика. Имя — для глаз в логе."""
    out = []
    for line in io.open(path, encoding="utf-8"):
        m = CARD_RE.match(line)
        if m:
            out.append((m.group(1), m.group(2).replace("''", "'"), m.group(3)))
    return out


def cards_from_tsv(path):
    """[(card_id, name, qid)] из таблицы card_id\tname_ru\tname_en\tqid.

    Второй вход существует не для удобства: выписка сборщика живёт во временной
    папке прогона и до следующей сессии не доживает, а карточки в базе — да.
    Без сохранённого QID им пришлось бы искать статью резолвом по имени, а он
    промахивается молча.
    """
    out = []
    for line in io.open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 4 and parts[3].startswith("Q"):
            out.append((parts[0], parts[1], parts[3]))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from-sql", default=None,
                    help="файл, выписанный clubs_squads_wikidata --sql-out "
                         "--create-cards: QID берётся из комментария в конце "
                         "строки вставки")
    ap.add_argument("--from-tsv", default=None,
                    help="таблица card_id\tname_ru\tname_en\tqid — тем, у кого "
                         "выписки уже нет под рукой (см. docs/data/)")
    ap.add_argument("--sql-out", default=None,
                    help="куда выписать UPDATE'ы (без него — только показ)")
    ap.add_argument("--limit", type=int, default=0, help="сколько карточек (0 — все)")
    args = ap.parse_args()

    if not (args.from_sql or args.from_tsv):
        raise SystemExit("нужен --from-sql или --from-tsv")
    cards = (cards_from_tsv(args.from_tsv) if args.from_tsv
             else cards_from_sql(args.from_sql))
    if args.limit:
        cards = cards[:args.limit]
    if not cards:
        raise SystemExit("В %s не нашлось ни одной строки вставки карточки с "
                         "QID — не тот файл?" % args.from_sql)
    print("Карточек с QID: %d" % len(cards))

    start, end = pvi.month_window()
    print("Окно: %s..%s (12 полных месяцев)" % (start, end))

    links = {}
    qids = sorted({q for _id, _n, q in cards})
    for i in range(0, len(qids), 50):
        links.update(pvi.sitelinks_for_qids(qids[i:i + 50]))
        print("  sitelinks: %d/%d" % (min(i + 50, len(qids)), len(qids)), flush=True)

    rows, no_article, no_views = [], 0, 0
    for n, (card_id, name, qid) in enumerate(cards, 1):
        titles = links.get(qid) or {}
        if not titles:
            no_article += 1
            continue
        views = {}
        for lang, title in titles.items():
            try:
                v = pvi.views_12m(lang, title, start, end)
            except Exception:                              # noqa: BLE001
                v = None
            if v is not None:
                views[lang] = v
            time.sleep(pvi.PV_PAUSE)
        if not views:
            no_views += 1
            continue
        rows.append((card_id, views))
        if n % 25 == 0 or n == len(cards):
            top = max(views.values())
            print("  %d/%d  %s: максимум %d" % (n, len(cards), name, top),
                  flush=True)

    print("-" * 70)
    print("Просмотры собраны : %d" % len(rows))
    print("Без статьи ни на одном языке : %d" % no_article)
    print("Статья есть, просмотров нет  : %d" % no_views)

    if args.sql_out:
        out = ["-- Просмотры новым карточкам по QID (docs/cards_pageviews_by_qid.py).",
               "-- Строк: %d. Окно %s..%s." % (len(rows), start, end),
               "-- ⚠️ ПОСЛЕ применения обязателен refresh_card_fame(): слава —",
               "-- перцентиль, и без пересчёта новички остаются без неё, а",
               "-- значит и без состава в прогнозах.",
               "begin;"]
        for card_id, views in rows:
            out.append("update cards set pageviews_i18n = '%s'::jsonb where id = '%s';"
                       % (json.dumps(views, ensure_ascii=False).replace("'", "''"),
                          card_id))
        out.append("commit;")
        io.open(args.sql_out, "w", encoding="utf-8").write("\n".join(out) + "\n")
        print("SQL выписан в %s" % args.sql_out)


if __name__ == "__main__":
    main()
