# -*- coding: utf-8 -*-
"""Ревизия чужих снимков: разбор ссылки, P18 и приговор. Без сети."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "docs"))
from cards_photo_qid_audit import (  # noqa: E402
    file_of, lead_images, p18_of, verdict)

FAILED = []


def check(name, got, want):
    if got != want:
        FAILED.append("%s: ожидалось %r, получено %r" % (name, want, got))
        print("✗ %s" % name)
    else:
        print("✓ %s" % name)


# --- разбор ссылки ---------------------------------------------------------
check("имя файла из ссылки Commons",
      file_of("https://commons.wikimedia.org/wiki/Special:FilePath/"
              "Mohamed_Salah_2018.jpg?width=256"),
      "Mohamed Salah 2018.jpg")
check("проценты раскодированы",
      file_of("https://commons.wikimedia.org/wiki/Special:FilePath/"
              "John_F._Kennedy%2C_White_House_color_photo_portrait.jpg"),
      "John F. Kennedy, White House color photo portrait.jpg")
# ⚠️ СНИМКИ С TRANSFERMARKT НЕ ТРОГАЕМ: они привязаны к id игрока, а не к
# имени, и подменить лицо там нечему.
check("снимок с Transfermarkt — не наше дело",
      file_of("https://img.a.transfermarkt.technology/portrait/big/148455-1.jpg"), None)
check("пусто — None", file_of(None), None)
check("не ссылка на файл — None",
      file_of("https://commons.wikimedia.org/wiki/Category:Football"), None)

# --- P18 -------------------------------------------------------------------
def claim(v):
    return {"mainsnak": {"datavalue": {"value": v}}}

payload = {"entities": {
    "Q1": {"claims": {"P18": [claim("Salah 2018.jpg")]}},
    "Q2": {"claims": {}},
    "Q3": {"claims": {"P18": [{"mainsnak": {}}]}},
}}
got = p18_of(payload)
check("P18 разобран", got["Q1"], "Salah 2018.jpg")
check("нет P18 — None", got["Q2"], None)
check("битый клейм — None", got["Q3"], None)
check("мусор не роняет разбор", p18_of(None), {})

# --- приговор --------------------------------------------------------------
check("совпало — ok", verdict("Salah 2018.jpg", "Salah 2018.jpg"), "ok")
check("регистр не важен", verdict("salah 2018.JPG", "Salah 2018.jpg"), "ok")

# ⚠️ ГЛАВНАЯ ПРОВЕРКА ЭТОГО ФАЙЛА, И ОНА ПО ЖИВОЙ ОШИБКЕ. У карточки «Джон
# Кеннеди» (бразильский нападающий, Q105393903) стоял снимок президента США.
# Имя карточки в имени файла ЕСТЬ — «John F. Kennedy…», — поэтому похожесть
# строк тут не доказывает ничего. Доказывает только несовпадение с P18.
check("чужой снимок пойман, хотя имя в файле похоже",
      verdict("John F. Kennedy, White House color photo portrait.jpg",
              "John Kennedy Fluminense 2023.jpg"),
      "wrong")

# ⚠️ ТРИ ИСХОДА, А НЕ ДВА. «У QID нет P18» ≠ «есть, и он другой». Склеить их
# значит снять верные снимки у всех, кому в Викиданных снимок не проставили.
check("нет P18 — «не знаем», а не «чужой»", verdict("что-угодно.jpg", None), "unknown")
check("нет снимка — «не знаем»", verdict(None, "Salah.jpg"), "unknown")

# --- вторая опора: главная картинка статьи ---------------------------------
# ⚠️ ОНА ПОЯВИЛАСЬ ПО ЖИВОМУ ПРОМАХУ. Первый прогон проверял только P18 и не
# поймал НИ Кеннеди, НИ Алькараса: у Q105393903 (Джон Кеннеди, футболист) P18
# нет вовсе, и карточка получила «не знаем», оставшись с президентом США.
# Проверка, пропускающая оба случая, ради которых её писали, бесполезна.
check("главная картинка статьи разобрана",
      lead_images({"query": {"pages": {"1": {"title": "John Kennedy (footballer)",
                                             "pageimage": "John_Kennedy_2023.jpg"}}}}),
      {"John Kennedy (footballer)": "John Kennedy 2023.jpg"})
check("страница без картинки пропускается",
      lead_images({"query": {"pages": {"1": {"title": "X"}}}}), {})
check("мусор не роняет разбор", lead_images(None), {})

check("нет P18, но снимок из статьи — ok",
      verdict("John Kennedy 2023.jpg", None, "John Kennedy 2023.jpg"), "ok")
check("нет P18, снимок НЕ из статьи — чужой",
      verdict("John F. Kennedy, White House color photo portrait.jpg", None,
              "John Kennedy 2023.jpg"),
      "wrong")
check("ни одной опоры — «не знаем», а не «чужой»",
      verdict("что-угодно.jpg", None, None), "unknown")

# ⚠️ СОВПАДЕНИЕ С ЛЮБОЙ ИЗ ОПОР — УЖЕ ok. Редакторы статьи и Викиданных часто
# выбирают разные снимки ОДНОГО человека; объявлять чужаком того, кто стоит в
# его же статье, — это churn, а не починка. Первый прогон так и заменил 122
# портрета на матчевые кадры тех же самых людей.
check("снимок из статьи не считается чужим при другом P18",
      verdict("Ronaldo article.jpg", "Ronaldo wikidata.jpg", "Ronaldo article.jpg"), "ok")

print()
if FAILED:
    print("ПРОВАЛЕНО: %d" % len(FAILED))
    for f in FAILED:
        print(" ", f)
    sys.exit(1)
print("test_photo_qid_audit: OK")
