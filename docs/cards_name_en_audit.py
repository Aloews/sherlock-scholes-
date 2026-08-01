"""Audit cards.name_en for PEOPLE cards and repair what is provably wrong.

WHY: name_en had no occupation guard, so a one-word card name walked off with
a famous stranger's article and kept his English title:

    «Адриан»  -> Hadrian            (Roman emperor)
    «Данте»   -> Dante Alighieri    (poet)
    «Крис»    -> Kris               (bare transliteration, no such player)
    «Жуан»    -> Zhuan

That value is not cosmetic: the EN language toggle shows it, and the photo /
pageviews steps resolve by it — so one bad name_en pulls an emperor's portrait
and an emperor's popularity into a football deck. run.py now refuses these at
the source (see make_card_qid_validator); this script repairs the rows already
written.

VERDICTS — every one is evidence-based, nothing is guessed:

  FIX      the card's RUSSIAN name resolves (with the footballer guard) to a
           QID whose enwiki sitelink differs from the stored name_en
           -> replace with the sitelink (the article Wikipedia itself links).
  CLEAR    the Russian name does not resolve, AND the stored name_en resolves
           on enwiki to someone who is NOT a footballer by occupation
           -> the value is proven wrong with no correct replacement, so it is
           NULLed. An empty name_en makes the frontend fall back to the
           Russian name, which is right; an emperor is not.
  KEEP     everything else — including "cannot verify". A card is never
           touched on suspicion alone.

DRY-RUN BY DEFAULT. APPLY=1 writes. Both writes are guarded in the request
(`name_en=eq.<the exact value we judged>`), so a value changed by anyone
between the read and the write is left alone instead of clobbered.

  python docs/cards_name_en_audit.py                    # dry-run, all people
  python docs/cards_name_en_audit.py --mononyms-only    # just the risky ones
  APPLY=1 python docs/cards_name_en_audit.py --mononyms-only
"""
import argparse
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import requests
from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.join(os.path.dirname(HERE), "football_scraper")
sys.path.insert(0, SCRAPER)

import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location("run", os.path.join(SCRAPER, "run.py"))
run = importlib.util.module_from_spec(_spec)
sys.modules["run"] = run
_spec.loader.exec_module(run)

from scraper.cache import FileCache  # noqa: E402
from scraper.pageviews import WikimediaBudget, WikiPagePropsClient  # noqa: E402
from scraper.wikidata import WikidataEnricher  # noqa: E402

APPLY = os.environ.get("APPLY") == "1"
PEOPLE_CATEGORIES = ("player", "woman")
SELECT_COLS = "id,name,name_en,category,pageviews,facts,career_stats,legend_career"

FIX, CLEAR, KEEP = "FIX", "CLEAR", "KEEP"


def fetch_people(url, key, mononyms_only, names):
    """Active player/woman cards that HAVE a name_en, most popular first."""
    base = {"select": SELECT_COLS, "active": "eq.true",
            "category": "in.({})".format(",".join(PEOPLE_CATEGORIES)),
            "name_en": "not.is.null",
            "order": "pageviews.desc.nullslast,id.asc"}
    if names:
        base["name"] = "in.({})".format(
            ",".join('"{}"'.format(n.replace('"', "")) for n in names))
    rows, offset = [], 0
    while True:
        resp = requests.get(url.rstrip("/") + "/rest/v1/cards",
                            headers={"apikey": key,
                                     "Authorization": "Bearer " + key},
                            params=dict(base, limit=1000, offset=offset),
                            timeout=60)
        resp.raise_for_status()
        batch = resp.json()
        rows += batch
        if len(batch) < 1000:
            break
        offset += 1000
    if mononyms_only:
        rows = [r for r in rows if run.is_mononym(r.get("name"))]
    return rows


def patch_name_en(url, key, card, new_value):
    """Write name_en, guarded on the value we actually judged — if it changed
    underneath us, the filter matches nothing and the write is a no-op."""
    resp = requests.patch(
        url.rstrip("/") + "/rest/v1/cards",
        headers={"apikey": key, "Authorization": "Bearer " + key,
                 "Content-Type": "application/json", "Prefer": "return=minimal"},
        params={"id": "eq." + str(card["id"]),
                "name_en": "eq." + card["name_en"]},
        json={"name_en": new_value}, timeout=30)
    resp.raise_for_status()


def correct_name_en(card, resolver, wikidata, cache, budget):
    """The name_en Wikipedia itself gives for this card's Russian name, or
    None when the card cannot be resolved to a footballer."""
    titles = run.cards_photos_candidates(card)
    if not titles:
        return None
    validate = run.make_card_qid_validator(card, wikidata, cache, budget)
    qid, _title, _via = run.resolve_card_qid(resolver, card, titles, validate)
    if not qid:
        return None
    enwiki = (wikidata.titles_for_qid(qid) or {}).get("enwiki")
    if enwiki:
        return run.strip_title_parenthetical(enwiki)
    # No English article, but the entity may still carry an English label.
    label = wikidata.label_en_for_qid(qid)
    return run.strip_title_parenthetical(label) if label else None


def stored_is_footballer(card, en_resolver, wikidata, cache, budget):
    """Does the STORED name_en belong to a footballer? Returns True / False /
    None (could not check — no enwiki article, so no evidence either way)."""
    name_en = (card.get("name_en") or "").strip()
    if not name_en:
        return None
    info = en_resolver.qid_for_title(name_en)
    if info.get("disambig") or not info.get("qid"):
        return None
    qid = info["qid"]
    if cache.get("wikidata_p106", qid) is None:
        budget.consume()
    occupations = wikidata.claim_item_ids(qid, "P106")
    if not occupations:
        return None            # entity has no occupation at all — no evidence
    return run.FOOTBALLER_OCCUPATION in occupations


def judge(card, resolver, en_resolver, wikidata, cache, budget):
    """(verdict, new_value, reason)."""
    stored = (card.get("name_en") or "").strip()
    correct = correct_name_en(card, resolver, wikidata, cache, budget)

    if correct:
        if correct != stored:
            return FIX, correct, "ruwiki -> Wikidata -> enwiki: «{}»".format(correct)
        return KEEP, stored, "совпадает с enwiki-статьёй"

    # The Russian name gave us nothing. Is the stored value at least a
    # footballer? Only a definite NO is actionable.
    verdict = stored_is_footballer(card, en_resolver, wikidata, cache, budget)
    if verdict is False:
        return CLEAR, None, "«{}» — статья не про футболиста".format(stored)
    if verdict is None:
        return KEEP, stored, "проверить нечем (нет статьи/профессии)"
    return KEEP, stored, "футболист, но русское имя не резолвится"


def main():
    parser = argparse.ArgumentParser(
        description="Ревизия cards.name_en у карточек-людей (dry-run по "
                    "умолчанию, APPLY=1 — запись).")
    parser.add_argument("--mononyms-only", action="store_true",
                        help="только односложные имена — там, где однофамильцы")
    parser.add_argument("--limit", type=int, default=0,
                        help="обработать только N карточек (0 = все)")
    parser.add_argument("--names", default="",
                        help="конкретные карточки по имени, через запятую")
    args = parser.parse_args()

    load_dotenv(os.path.join(SCRAPER, ".env"))
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("Нужны SUPABASE_URL и SUPABASE_KEY (env или .env).")

    cfg = json.load(open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))
    pv = cfg["pageviews"]
    cache = FileCache(os.path.join(SCRAPER, cfg["cache"]["dir"]),
                      cfg["cache"]["enabled"])
    budget = WikimediaBudget(
        cfg.get("photos", {}).get("daily_request_budget", 5000),
        os.path.join(SCRAPER, cfg["cache"]["dir"], "photos_budget.json"))
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget)
    en_resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget,
        api_url="https://en.wikipedia.org/w/api.php", cache_prefix="enwiki")

    names = [n.strip() for n in args.names.split(",") if n.strip()]
    cards = fetch_people(url, key, args.mononyms_only, names)
    if args.limit > 0:
        cards = cards[:args.limit]

    print("=" * 72)
    print("NAME_EN AUDIT — {}".format(
        "LIVE, запись cards.name_en" if APPLY else "DRY RUN, без записи"))
    print("=" * 72)
    print("Область         : {}{}".format(
        "карточки-люди", ", только мононимы" if args.mononyms_only else ""))
    print("Карточек в работе: {}".format(len(cards)))
    print("Проверка        : русское имя -> QID (гард «футболист») -> enwiki; "
          "если не вышло — профессия сохранённого name_en")
    print("Бюджет Wikimedia : {}/{}".format(budget.used, budget.limit))
    print("-" * 72, flush=True)

    counts = {FIX: 0, CLEAR: 0, KEEP: 0}
    written = 0
    for i, card in enumerate(cards, 1):
        try:
            verdict, new_value, reason = judge(
                card, resolver, en_resolver, wikidata, cache, budget)
        except RuntimeError as exc:
            print("\n!!! {}".format(exc))
            print("!!! Прогресс в кеше, продолжите завтра.", flush=True)
            break
        except requests.RequestException as exc:
            print("[{}/{}] ! {:<26} сетевая ошибка: {}".format(
                i, len(cards), card.get("name"), exc), flush=True)
            continue

        counts[verdict] += 1
        if verdict == KEEP:
            continue

        print("[{}/{}] {} {:<26} {}".format(
            i, len(cards), verdict, card.get("name"), reason))
        print("      БЫЛО : name_en = {!r}".format(card.get("name_en")))
        print("      СТАЛО: name_en = {!r}".format(new_value))
        if APPLY:
            patch_name_en(url, key, card, new_value)
            written += 1
        print(flush=True)

    print("-" * 72)
    print("ИТОГО: исправить {} | обнулить {} | оставить {}{}".format(
        counts[FIX], counts[CLEAR], counts[KEEP],
        " | записано {}".format(written) if APPLY else ""))
    print("Бюджет Wikimedia : {}/{}".format(budget.used, budget.limit))
    if not APPLY:
        print("\nЗапись не выполнялась. Повторите с APPLY=1, чтобы применить.")


if __name__ == "__main__":
    main()
