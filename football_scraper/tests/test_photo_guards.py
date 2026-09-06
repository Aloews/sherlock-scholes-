# -*- coding: utf-8 -*-
"""Гарды двух сборщиков фото: кому можно pageimage и что считать заглушкой.

Оба правила уже стоили этому проекту данных:
  * pageimage подставлял клубам СТАДИОНЫ вместо гербов — отсюда «только
    игрокам», и это гард, а не комментарий;
  * Transfermarkt отдаёт одинаковый серый силуэт `default.jpg` игроку без
    фотографии — записать его значит навсегда потерять различие между «не
    собрали» и «собрали заглушку».
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "docs"))

import importlib.util


def _load(name):
    path = os.path.join(HERE, "..", "..", "docs", name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


qid = _load("cards_photo_from_qid")
tm = _load("cards_photo_transfermarkt")

ok = 0


def check(cond, what):
    global ok
    if cond:
        ok += 1
        return
    print("ПРОВАЛ: %s" % what)
    sys.exit(1)


# --- pageimage: только игрокам --------------------------------------------
check(qid.may_use_pageimage("player") is True, "игроку pageimage разрешён")
# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ, и он здесь главный: проверка «игроку можно»
# прошла бы и у функции, разрешающей всем.
for bad in ("club", "stadium", "referee", "coach", "term", "woman", None, ""):
    check(qid.may_use_pageimage(bad) is False,
          "категории %r pageimage запрещён" % (bad,))

# --- выбор статьи: английская вперёд, неязыковые разделы мимо --------------
check(qid.sitelink_title({"enwiki": {"title": "Bukayo Saka"},
                          "ruwiki": {"title": "Сака, Букайо"}}) == ("enwiki", "Bukayo Saka"),
      "английская статья выбирается первой")
check(qid.sitelink_title({"ruwiki": {"title": "Сака, Букайо"}}) == ("ruwiki", "Сака, Букайо"),
      "без английской берётся первая языковая")
check(qid.sitelink_title({"commonswiki": {"title": "Category:X"},
                          "specieswiki": {"title": "X"}}) == (None, None),
      "Commons и Викивиды статьёй не считаются")
check(qid.sitelink_title({}) == (None, None), "пусто — не выбор")

# --- Transfermarkt: портрет против заглушки --------------------------------
real = ('<meta property="og:image" content="https://img.a.transfermarkt.technology'
        '/portrait/big/574671-1757664768.jpg?lm=4711">')
check(tm.portrait_url(real).endswith("574671-1757664768.jpg?lm=4711"),
      "настоящий портрет берётся")

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: заглушка обязана быть отвергнута. Замер на живых
# профилях 06.09.2026 — 11 портретов и одна такая на двенадцать игроков.
stub = ('<meta property="og:image" content="https://img.a.transfermarkt.technology'
        '/portrait/big/default.jpg?lm=4711">')
check(tm.portrait_url(stub) is None, "заглушка default.jpg отвергается")
check(tm.portrait_url('<html>без og:image</html>') is None, "нет картинки — нет адреса")
check(tm.portrait_url("") is None and tm.portrait_url(None) is None, "пусто — не адрес")
# «default» в середине пути картинку не отменяет: проверяется имя файла.
mid = ('<meta property="og:image" content="https://img.a.transfermarkt.technology'
       '/default/portrait/big/9999-1700000000.jpg">')
check(tm.portrait_url(mid) is not None, "слово default в пути не отменяет портрет")

print("test_photo_guards: OK (%d проверок)" % ok)
