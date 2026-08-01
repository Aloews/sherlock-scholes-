"""Offline tests for the on-disk cache's "never persist a miss" rule.

The cache has no TTL and survives between CI runs, so one negative entry
written by a bad run would suppress that lookup forever. These pin down which
payloads are misses (not stored, retried next run) and which are real answers
(stored, never re-fetched).

    python3 tests/test_cache.py
"""
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from scraper.cache import FileCache, _is_empty  # noqa: E402

FAILURES = []


def check(label, got, want):
    if got != want:
        FAILURES.append("{}\n    ожидалось: {!r}\n    получено : {!r}".format(
            label, want, got))
        print("FAIL  {}".format(label))
    else:
        print("ok    {}".format(label))


def miss(label, payload):
    check("промах не кешируется: " + label, _is_empty(payload), True)


def answer(label, payload):
    check("ответ кешируется: " + label, _is_empty(payload), False)


# --------------------------------------------------------------------------
# misses — every shape the scrapers write when they found nothing
# --------------------------------------------------------------------------
# The important one: qid_for_title's "no such article". Judged by its
# disambig flag alone this looks like an answer, which is how a whole nightly
# pass could run on stale misses and spend 0 budget.
miss("нет статьи ruwiki", {"qid": None, "disambig": False})
miss("нет статьи enwiki", {"qid": None, "disambig": False})
miss("пустая преамбула", {"extract": ""})
miss("поиск ничего не нашёл", {"titles": []})
miss("нет P106/P31", {"ids": []})
miss("нет классов P31", {"classes": []})
miss("нет фото", {"url": None})
miss("нет сайтлинков", {"ruwiki": None, "enwiki": None})
miss("пустой словарь", {})
miss("пустой список", [])
miss("None", None)
miss("пустая строка", "")
miss("вложенная пустота", {"a": {"b": []}, "c": None, "d": False})

# --------------------------------------------------------------------------
# answers — must stay cached, or every run re-fetches them
# --------------------------------------------------------------------------
answer("найденный QID", {"qid": "Q7156", "disambig": False})
answer("страница значений", {"qid": "Q1", "disambig": True})
answer("преамбула", {"extract": "Испанский профессиональный футбольный клуб"})
answer("результаты поиска", {"titles": ["Мане, Садио"]})
answer("профессия найдена", {"ids": ["Q937857"]})
answer("ссылка на фото", {"url": "https://upload.wikimedia.org/x.jpg"})
answer("сайтлинки", {"ruwiki": "Барселона (футбольный клуб)", "enwiki": None})
# A 404 from the Pageviews API is a real answer — the article exists in our
# question and genuinely has no data. project/article make it non-blank.
answer("pageviews 404", {"views": 0, "found": False,
                         "project": "ru.wikipedia.org", "article": "Барселона"})
answer("pageviews с данными", {"views": 377463, "found": True,
                               "project": "ru.wikipedia.org", "article": "X"})
# A bare scalar handed to the cache keeps its plain meaning.
answer("голый False — реальный ответ", False)
answer("голый 0 — реальный ответ", 0)

# --------------------------------------------------------------------------
# end-to-end: a miss must not create a file, an answer must round-trip
# --------------------------------------------------------------------------
root = tempfile.mkdtemp(prefix="sherlock-cache-test-")
try:
    cache = FileCache(root, True)

    cache.set("ruwiki_pageprops", "Канониры", {"qid": None, "disambig": False})
    check("промах не сохранён на диск",
          cache.get("ruwiki_pageprops", "Канониры"), None)

    payload = {"qid": "Q7156", "disambig": False}
    cache.set("ruwiki_pageprops", "Барселона (футбольный клуб)", payload)
    check("ответ прочитан обратно",
          cache.get("ruwiki_pageprops", "Барселона (футбольный клуб)"), payload)

    # A miss followed by a real answer must land — the miss left nothing behind.
    cache.set("enwiki_extract", "Hearts", {"extract": ""})
    cache.set("enwiki_extract", "Hearts", {"extract": "Scottish club"})
    check("после промаха ответ всё равно записывается",
          cache.get("enwiki_extract", "Hearts"), {"extract": "Scottish club"})

    disabled = FileCache(root, False)
    check("выключенный кеш ничего не отдаёт",
          disabled.get("ruwiki_pageprops", "Барселона (футбольный клуб)"), None)
finally:
    shutil.rmtree(root, ignore_errors=True)

# --------------------------------------------------------------------------
print("-" * 60)
if FAILURES:
    print("ПРОВАЛЕНО {} проверок:".format(len(FAILURES)))
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("Все проверки пройдены.")
