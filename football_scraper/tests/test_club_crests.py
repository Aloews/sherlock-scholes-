"""Offline-тесты сведения гербов — БЕЗ сети.

    python3 -m tests.test_club_crests
    python3 tests/test_club_crests.py

Каждый случай здесь — замеренный, а не выдуманный: так эти пары и вели себя
на живых данных, пока правило не поправили.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from club_crests import (  # noqa: E402
    accept, best_name_score, build_idf, country_conflict, dedupe,
    different_clubs, queries_for, toks, tokset, translit,
)


def check(label, got, want):
    status = "ok " if got == want else "FAIL"
    print("  [{}] {}: got={!r} want={!r}".format(status, label, got, want))
    return got == want


def test_translit_matches_postgres():
    """`club_translit` в базе построена на translate(), а у той строка `to`
    на символ короче — значит `ь` УДАЛЯЕТСЯ. Питоновский порт обязан делать
    то же, иначе ключи разойдутся."""
    ok = True
    ok &= check("мягкий знак пропадает", translit("Зриньски"), "zrinski")
    ok &= check("диграф ж→zh", translit("Жальгирис"), "zhalgiris")
    ok &= check("диграф щ→sch", translit("Щорс"), "schors")
    ok &= check("ц→ts", translit("Цюрих"), "tsyurih")
    return ok


def test_toks_strips_dots_before_split():
    """«F.C.» без этого даёт токены `f` и `c`, и тогда «Aberdeen F.C.»
    и «Manta F.C.» делят два общих слова из трёх. Так и было: «Абердин»
    получал герб эквадорской «Манты»."""
    ok = True
    ok &= check("точки не рождают букв", toks("Aberdeen F.C."), ["aberdeen"])
    ok &= check("год основания не в счёт", toks("Bologna FC 1909"), ["bologna"])
    ok &= check("артикли отброшены", toks("Olympique de Marseille"),
                ["olympique", "marseille"])
    ok &= check("диакритика складывается", toks("1. FC Köln"), ["koln"])
    return ok


def test_best_name_score_uses_single_name():
    """Объединение всех псевдонимов наказывает команду за их обилие:
    «Legia Warsaw» против {legia, warszawa, leg, warsaw} давала 0.67 и
    вылетала по порогу 0.70."""
    teams = [{"names": ["Legia Warszawa", "LEG", "Legia Warsaw"]},
             {"names": ["Lech Poznan"]}, {"names": ["Wisla Krakow"]}]
    idf = build_idf(teams)
    default = max(idf.values())
    club = tokset(["Legia Warsaw"])
    got = best_name_score(club, teams[0]["names"], idf, default)
    ok = check("совпало одно из названий → счёт максимальный", round(got, 2), 1.0)
    ok &= check("чужая команда — ноль",
                best_name_score(club, teams[1]["names"], idf, default), 0.0)
    return ok


def test_best_name_score_fuzzy_fallback():
    """Транслитерация звучит как оригинал, но пишется иначе: общих токенов
    ноль. Порог 0.87 подобран так, чтобы «Сабадель/Sabadell» проходил, а
    «Тунис/Tunisia» — нет."""
    teams = [{"names": ["Sabadell"]}, {"names": ["Tunisia"]}, {"names": ["Orleans"]}]
    idf = build_idf(teams)
    default = max(idf.values())
    ok = True
    ok &= check("Сабадель ↔ Sabadell",
                best_name_score(tokset(["Сабадель"]), ["Sabadell"], idf, default) > 0,
                True)
    ok &= check("Орлеан ↔ Orléans",
                best_name_score(tokset(["Орлеан"]), ["Orléans"], idf, default) > 0,
                True)
    ok &= check("Тунис НЕ Tunisia",
                best_name_score(tokset(["Тунис"]), ["Tunisia"], idf, default), 0.0)
    return ok


def test_accept_sure_score_needs_no_margin():
    """У ESPN «Арсенал», «Барселона», «Аякс» и «Севилья» заведены по два
    раза. Требование отрыва выкидывало ровно самые известные клубы."""
    ok = True
    ok &= check("уверенный счёт без отрыва", accept(0.85, 0.85, False), True)
    ok &= check("серая полоса без отрыва", accept(0.72, 0.71, False), False)
    ok &= check("серая полоса с отрывом", accept(0.72, 0.40, False), True)
    ok &= check("ниже порога", accept(0.69, 0.0, False), False)
    ok &= check("конфликт стран сильнее счёта", accept(1.0, 0.0, True), False)
    return ok


def test_country_conflict_only_when_both_named():
    ok = True
    ok &= check("Тула против Лондона", country_conflict("Россия", "England"), True)
    ok &= check("страна не названа", country_conflict(None, "England"), False)
    ok &= check("источник молчит", country_conflict("Россия", None), False)
    ok &= check("страны нет в карте", country_conflict("Перу", "England"), False)
    ok &= check("совпало", country_conflict("Нидерланды", "The Netherlands"), False)
    return ok


def test_different_clubs():
    """Встречное различающее слово есть — разные клубы; есть только у
    одной стороны — то же имя, записанное подробнее."""
    ok = True
    ok &= check("Локомотивы спорят",
                different_clubs(["Lokomotiv Moscow"], ["Lokomotiv Zagreb"]), True)
    ok &= check("Хапоэль и Маккаби спорят",
                different_clubs(["Hapoel Tel Aviv"], ["Maccabi Tel Aviv"]), True)
    ok &= check("benfica ⊂ sl benfica",
                different_clubs(["Benfica"], ["SL Benfica"]), False)
    ok &= check("два Арсенала не спорят",
                different_clubs(["Arsenal"], ["Arsenal"]), False)
    ok &= check("код штата не различает",
                different_clubs(["Flamengo RJ"], ["CR Flamengo"]), False)
    return ok


def test_dedupe_keeps_variants_drops_strangers():
    pairs = {
        "lokomotiv moscow": {"url": "L.png", "score": 1.04, "source": "espn"},
        "lokomotiv zagreb": {"url": "L.png", "score": 0.77, "source": "espn"},
        "benfica": {"url": "B.png", "score": 1.32, "source": "espn"},
        "sl benfica": {"url": "B.png", "score": 0.86, "source": "espn"},
    }
    kept, dropped = dedupe(pairs, None)
    ok = check("чужой герб снят", "lokomotiv zagreb" in kept, False)
    ok &= check("победитель остался", "lokomotiv moscow" in kept, True)
    ok &= check("оба варианта одного клуба остались",
                sorted(k for k in kept if "benfica" in k),
                ["benfica", "sl benfica"])
    ok &= check("снято ровно одно", len(dropped), 1)
    return ok


def test_queries_prefer_stripped_name():
    """Поиск TheSportsDB ТОЧНЫЙ: «FC Volendam» не находит ничего,
    «Volendam» находит клуб."""
    got = queries_for({"name_en": "FC Volendam", "name": "Волендам"})
    ok = check("первым идёт имя без формы", got[0], "volendam")
    ok &= check("исходное имя тоже спрашивается", "FC Volendam" in got, True)
    return ok


def main():
    tests = [
        ("транслитерация как в Postgres", test_translit_matches_postgres),
        ("точки убираются до разбиения", test_toks_strips_dots_before_split),
        ("счёт по лучшему названию", test_best_name_score_uses_single_name),
        ("посимвольный запас", test_best_name_score_fuzzy_fallback),
        ("уверенный счёт без отрыва", test_accept_sure_score_needs_no_margin),
        ("страна судит, когда названа", test_country_conflict_only_when_both_named),
        ("разные клубы или одно имя", test_different_clubs),
        ("сведение дублей", test_dedupe_keeps_variants_drops_strangers),
        ("запросы к TheSportsDB", test_queries_prefer_stripped_name),
    ]
    ok = True
    for label, fn in tests:
        print(label + ":")
        ok = fn() and ok
    print("\n" + ("ВСЕ ПРОВЕРКИ ПРОШЛИ" if ok else "ЕСТЬ ПАДЕНИЯ"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
