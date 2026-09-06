"""titles_for_qid отдаёт ВСЕ языковые разделы (offline, без сети).

Раньше он возвращал ровно два — ru и en, — и это была не мелочь: колода
меряла украинца, турка и шведа русской статьёй или ничем. Теперь возвращаются
все, а ru и en остаются ключами, чтобы прежние вызовы не сломались.

⚠️ Сеть не трогаем: `_api` подменяется, проверяется РАЗБОР ответа. Форма
ответа снята с боевого (Q615, 196 разделов), а не придумана.

    python3 tests/test_sitelinks_all_editions.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper.wikidata import WikidataEnricher, NOT_A_LANGUAGE_EDITION  # noqa: E402

FAILURES = []


def check(name, got, want):
    if got != want:
        FAILURES.append("%s\n    ожидалось: %r\n    получено : %r" % (name, want, got))


class FakeCache:
    def __init__(self):
        self.store = {}

    def get(self, ns, key):
        return self.store.get((ns, key))

    def set(self, ns, key, value):
        self.store[(ns, key)] = value


ANSWER = {"entities": {"Q615": {"sitelinks": {
    "ruwiki":   {"title": "Месси, Лионель"},
    "enwiki":   {"title": "Lionel Messi"},
    "svwiki":   {"title": "Lionel Messi"},
    "ukwiki":   {"title": "Ліонель Мессі"},
    "be_x_oldwiki": {"title": "Ліянэль Мэсі"},
    "commonswiki":  {"title": "Category:Lionel Messi"},
    "abstractwiki": {"title": "Messi"},
    "enwikiquote":  {"title": "Lionel Messi"},
    "nowhere":      {"title": "junk"},
}}}}

cfg = {"base_url": "x", "user_agent": "x", "min_pause_seconds": 0,
       "footballer_qid": "Q937857"}
wd = WikidataEnricher(cfg, FakeCache())
wd._api = lambda params: ANSWER

got = wd.titles_for_qid("Q615")

check("все языковые разделы вернулись", len(got), 5)
check("русский на месте (прежние вызовы не сломаны)", got.get("ruwiki"), "Месси, Лионель")
check("английский на месте", got.get("enwiki"), "Lionel Messi")
check("шведский появился — раньше его не было ВООБЩЕ", got.get("svwiki"), "Lionel Messi")
check("украинский появился", got.get("ukwiki"), "Ліонель Мессі")
check("раздел с подчёркиванием — тоже раздел", "be_x_oldwiki" in got, True)
check("Викисклад отсеян", "commonswiki" in got, False)
check("abstractwiki отсеян (встречался в боевом ответе)", "abstractwiki" in got, False)
check("викицитатник отсеян", "enwikiquote" in got, False)
check("мусорный ключ отсеян", "nowhere" in got, False)

# ⚠️ КЕШ ОТДЕЛЬНЫМ ПРОСТРАНСТВОМ. FileCache без TTL: запись старой,
# двухъязычной версии отвечала бы «шведской статьи нет» ВЕЧНО, и расширение
# молча не сработало бы.
cache = FakeCache()
cache.set("wikidata_sitelinks", "Q615", {"ruwiki": "старое", "enwiki": "старое"})
wd2 = WikidataEnricher(cfg, cache)
wd2._api = lambda params: ANSWER
got2 = wd2.titles_for_qid("Q615")
check("старый кеш не подменяет новый ответ", got2.get("svwiki"), "Lionel Messi")

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: вернуть прежнее поведение — и проверка обязана
# покраснеть. Не покраснела бы — значит она ничего не проверяет.
_real = wd.titles_for_qid
try:
    wd.titles_for_qid = lambda qid: {
        "ruwiki": ANSWER["entities"]["Q615"]["sitelinks"]["ruwiki"]["title"],
        "enwiki": ANSWER["entities"]["Q615"]["sitelinks"]["enwiki"]["title"]}
    old = wd.titles_for_qid("Q615")
    check("контроль: со старым поведением шведского НЕТ", old.get("svwiki"), None)
    check("контроль: и разделов ровно два", len(old), 2)
finally:
    wd.titles_for_qid = _real

check("после контроля снова все разделы", len(wd.titles_for_qid("Q615")), 5)

if FAILURES:
    print("ПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("test_sitelinks_all_editions: OK")
