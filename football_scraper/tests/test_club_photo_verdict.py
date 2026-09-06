"""Вердикт ревизии клубных фото (offline, без сети и без базы).

Покрывает verdict() и image_key() из docs/cards_club_photo_audit.py.

⚠️ Проверяется НАСТОЯЩАЯ функция, а не её копия. Копия в тесте проверяет
копию: в test_title_match.py логика уже была переписана рядом, гард в переписи
забыт — и тест был зелёным на поломке.

Все случаи ниже — из БОЕВОЙ выдачи прогона 04.09.2026 на 313 карточках,
который предложил 45 замен, и ни одну из них применять было нельзя.

    python3 tests/test_club_photo_verdict.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.dirname(HERE)
ROOT = os.path.dirname(SCRAPER)

import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "cards_club_photo_audit", os.path.join(ROOT, "docs", "cards_club_photo_audit.py"))
audit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit)

FAILURES = []


def check(label, got, want):
    if got != want:
        FAILURES.append("{}\n    ожидалось: {!r}\n    получено : {!r}".format(
            label, want, got))


ESPN = "https://a.espncdn.com/i/teamlogos/soccer/500/139.png"
ZENITH = ("https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/"
          "Equinox-NO-Zenit-Nadir.jpg/330px-Equinox-NO-Zenit-Nadir.jpg")
ZENITH_OTHER_SIZE = ("https://commons.wikimedia.org/wiki/Special:FilePath/"
                     "Equinox-NO-Zenit-Nadir.jpg?width=256")
CLUB_LOGO = ("https://commons.wikimedia.org/wiki/Special:FilePath/"
             "FC_Zenit_logo.svg?width=256")
AJAX_WIKI = ("https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/"
             "Logo_AFC_Ajax.svg/330px-Logo_AFC_Ajax.svg.png")

# --- image_key: одна картинка в разных видах — это одна картинка -----------
check("миниатюра и Special:FilePath одного файла сходятся",
      audit.image_key(ZENITH), audit.image_key(ZENITH_OTHER_SIZE))
check("«Logo.svg.png» и «Logo.svg» — один файл",
      audit.image_key("x/330px-Logo_FC_Basel.svg.png"),
      audit.image_key("y/Logo_FC_Basel.svg?width=256"))
check("разные файлы не сходятся",
      audit.image_key(ZENITH) == audit.image_key(CLUB_LOGO), False)
check("пустая ссылка не равна непустой",
      audit.image_key("") == audit.image_key(ZENITH), False)

# --- ПРАВИЛО I: обвинение требует улики ------------------------------------
# «Зенит»: голое имя ведёт к астрономическому зениту, гард его отвергает, и
# картинка той статьи РОВНО ТА, что лежит в карточке. Это улика.
check("улика: фото карточки = картинка отвергнутой статьи → FIX",
      audit.verdict(ZENITH, False, ZENITH, ESPN, None)[0], "FIX")

# «Амкар», «Волеренга», «Кайзерслаутерн»: статья своя, данные верные. Первая
# версия ревизии объявила их виновными по отсутствию резолва — здесь нет.
check("статья прошла гард → KEEP, что бы ни лежало в карточке",
      audit.verdict(ZENITH, True, ZENITH, ESPN, CLUB_LOGO)[0], "KEEP")

# ⚠️ Главный случай: гард отверг статью, но картинка в карточке ДРУГАЯ —
# значит фото пришло не оттуда, и улики нет. «Другое» ≠ «чужое».
check("гард отверг статью, но картинка не та → KEEP",
      audit.verdict(CLUB_LOGO, False, ZENITH, ESPN, None)[0], "KEEP")
check("картинки отвергнутой статьи нет вовсе → KEEP",
      audit.verdict(ZENITH, False, None, ESPN, None)[0], "KEEP")
check("в карточке пусто — обвинять не в чем → KEEP",
      audit.verdict("", False, ZENITH, ESPN, None)[0], "KEEP")

# --- ПРАВИЛО II: замена только из источника, который эмблема по построению --
check("замена берётся из справочника ESPN",
      audit.verdict(ZENITH, False, ZENITH, ESPN, CLUB_LOGO)[1], ESPN)
check("и источник назван",
      audit.verdict(ZENITH, False, ZENITH, ESPN, CLUB_LOGO)[2],
      "ESPN (справочник, по card_id)")
check("нет ESPN — берётся P154/P18 Викиданных",
      audit.verdict(ZENITH, False, ZENITH, None, CLUB_LOGO)[1], CLUB_LOGO)

# --- ПРАВИЛО IV: заменить нечем — показать, но не трогать ------------------
check("улика есть, замены нет → SUSPECT",
      audit.verdict(ZENITH, False, ZENITH, None, None)[0], "SUSPECT")
check("SUSPECT ничего не подставляет",
      audit.verdict(ZENITH, False, ZENITH, None, None)[1], None)

# --- ПРАВИЛО III: карточку с эмблемой ESPN ревизия не видит ----------------
# Отбор идёт в main() по ESPN_HOST — здесь проверяется сам признак, потому что
# именно он не дал прежней версии заменить 42 верные эмблемы на картинки
# Википедии («Анже» 7868.png → Angers_logo, «Аякс» 139.png → Logo_AFC_Ajax).
check("ссылка ESPN опознаётся по хосту", audit.ESPN_HOST in ESPN, True)
check("картинка Википедии за ESPN не принимается",
      audit.ESPN_HOST in AJAX_WIKI, False)

# --- ПРАВИЛО II: у стадиона своё изображение, у клуба — логотип ------------
# Три стадиона в карточках клубов («Вардар» → NacionalnaArenaF2Skopje.jpg,
# «Зюлте-Варегем» → Regenboogstadion, «Мидтьюлланд» → MCH_Arena_Herning)
# появились ровно потому, что бралась «первая картинка статьи». Свойство
# зависит от категории, и это записано в таблице, а не угадывается по имени.
check("клубу — P154", audit.MEDIA_PROP["club"], "P154")
check("прозвищу клуба — тоже P154", audit.MEDIA_PROP["club_nickname"], "P154")
check("стадиону — P18", audit.MEDIA_PROP["stadium"], "P18")
check("pageimage в источники замены не входит",
      "pageimage" in (audit.MEDIA_PROP.get("club") or ""), False)

# ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ. Проверка обязана КРАСНЕТЬ на сломанном. Ломаем
# сравнение картинок — тем самым «улика» перестаёт быть уликой и превращается
# обратно в «различие», из-за которого прежняя версия и предложила 45 замен.
_key = audit.image_key
try:
    audit.image_key = lambda _u: "одно и то же"
    check("контроль: со сломанным сравнением «другое» проходит за «чужое»",
          audit.verdict(CLUB_LOGO, False, ZENITH, ESPN, None)[0], "FIX")
finally:
    audit.image_key = _key
check("после контроля правило снова на месте",
      audit.verdict(CLUB_LOGO, False, ZENITH, ESPN, None)[0], "KEEP")

if FAILURES:
    print("ПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("test_club_photo_verdict: OK")
