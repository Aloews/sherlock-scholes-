# -*- coding: utf-8 -*-
"""Разбор подписи к снимку Викисклада: имя файла из ссылки и автор из разметки.

⚠️ ЭТОТ ТЕСТ СТЕРЕЖЁТ УСЛОВИЕ ЛИЦЕНЗИИ, А НЕ ФУНКЦИЮ. Снимки с Викисклада
разрешено показывать коммерчески ровно при одном условии: назван автор и
названа лицензия. Замер 22.09.2026: 7072 файла на экране, подпись у нуля.

Проверяется то, на чём эта подпись и ломается:

  1. форм ссылки ТРИ, и последняя — уменьшённая копия, где имя файла стоит
     перед сегментом «256px-…», а не в конце;
  2. `Artist` приходит РАЗМЕТКОЙ: ссылка на профиль, таблица из двух авторов,
     `&amp;` вместо амперсанда. Неразобранная разметка уехала бы в карточку;
  3. «автора нет» (общественное достояние) обязано отличаться от «не
     спрашивали»: первое — законный ответ источника, второе — работа.

    python3 football_scraper/tests/test_photo_credits.py
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_spec = importlib.util.spec_from_file_location(
    "cards_photo_credits", os.path.join(ROOT, "docs", "cards_photo_credits.py"))
cpc = importlib.util.module_from_spec(_spec)
sys.modules["cards_photo_credits"] = cpc
_spec.loader.exec_module(cpc)

FAILED = []


def check(name, cond):
    print(("  ✓ " if cond else "  ✗ ") + name)
    if not cond:
        FAILED.append(name)


def main():
    print("Подписи к снимкам Викисклада")

    # ── 1. Имя файла из всех трёх форм ссылки ───────────────────────────────
    f = cpc.file_title_from_url
    check("Special:FilePath — так пишет наш сборщик фото",
          f("https://commons.wikimedia.org/wiki/Special:FilePath/Helguera.jpg?width=256")
          == "Helguera.jpg")
    check("подчёркивания разворачиваются в пробелы, как их ждёт API",
          f("https://commons.wikimedia.org/wiki/Special:FilePath/Yuri_Gazinskiy_2013.jpg")
          == "Yuri Gazinskiy 2013.jpg")
    check("прямая ссылка на файл",
          f("https://upload.wikimedia.org/wikipedia/commons/a/ab/Test_file.jpg")
          == "Test file.jpg")
    check("УМЕНЬШЕННАЯ КОПИЯ: имя перед сегментом «256px-…», а не последнее",
          f("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Test_file.jpg"
            "/256px-Test_file.jpg") == "Test file.jpg")
    check("процентное кодирование разворачивается",
          f("https://commons.wikimedia.org/wiki/Special:FilePath/%D0%9B%D0%B5%D0%B2.jpg")
          == "Лев.jpg")

    # ── 2. Отрицательный контроль: чужой хост НЕ выдаёт имени ───────────────
    # Без этого разбор «узнавал» бы Transfermarkt и слал бы Викискладу имена
    # чужих файлов — а тот отвечал бы «нет такого» на каждое, и прогон
    # выглядел бы рабочим.
    check("Transfermarkt — не Викисклад, имени нет",
          f("https://img.a.transfermarkt.technology/portrait/big/1-2.png") is None)
    check("ESPN — тоже нет",
          f("https://a.espncdn.com/i/headshots/soccer/players/full/1.png") is None)
    check("пустая ссылка — не падение, а None", f(None) is None and f("") is None)

    # ── 3. Автор: текст, а не разметка ──────────────────────────────────────
    p = cpc.plain
    check("ссылка на профиль превращается в имя",
          p('<a href="/wiki/User:Kto" title="User:Kto">Бекетова Светлана</a>')
          == "Бекетова Светлана")
    check("два автора в таблице не слипаются",
          p("<table><tr><td>Иван Иванов</td><td>Пётр Петров</td></tr></table>")
          == "Иван Иванов Пётр Петров")
    check("сущности разворачиваются", p("Smith &amp; Jones") == "Smith & Jones")
    check("пусто остаётся пустым, а не строкой из пробелов",
          p("<span> </span>") is None and p("") is None and p(None) is None)

    # ── 4. «Автора нет» ≠ «не спрашивали» ───────────────────────────────────
    pd_file = {
        "descriptionurl": "https://commons.wikimedia.org/wiki/File:Old.jpg",
        "extmetadata": {
            "LicenseShortName": {"value": "Public domain"},
            "LicenseUrl": {"value": "https://ru.wikipedia.org/wiki/Public_domain"},
        },
    }
    got = cpc.credit_from_imageinfo(pd_file)
    check("общественное достояние: автора нет, но ЛИЦЕНЗИЯ И ССЫЛКА ЕСТЬ",
          got["author"] is None and got["license"] == "Public domain"
          and got["credit_url"].endswith("File:Old.jpg"))

    full = {
        "descriptionurl": "https://commons.wikimedia.org/wiki/File:X.jpg",
        "extmetadata": {
            "Artist": {"value": '<a href="//commons.wikimedia.org/wiki/User:A">Hossein</a>'},
            "LicenseShortName": {"value": "CC BY 4.0"},
            "LicenseUrl": {"value": "https://creativecommons.org/licenses/by/4.0"},
        },
    }
    got = cpc.credit_from_imageinfo(full)
    check("полная подпись собирается целиком",
          got == {"author": "Hossein", "license": "CC BY 4.0",
                  "license_url": "https://creativecommons.org/licenses/by/4.0",
                  "credit_url": "https://commons.wikimedia.org/wiki/File:X.jpg"})

    # Пустой ответ обязан дать пустую подпись, а не выдумать поля.
    empty = cpc.credit_from_imageinfo({})
    check("пустой ответ источника не выдумывает ни автора, ни лицензии",
          empty == {"author": None, "license": None,
                    "license_url": None, "credit_url": None})

    print()
    if FAILED:
        print("ПРОВАЛ: %d" % len(FAILED))
        for x in FAILED:
            print("  -", x)
        return 1
    print("OK — подпись собирается из всех форм ссылки и не врёт про автора")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
