# One-off: audit + force-fix photos of ALL stadium cards.
#
# --cards-photos only touches photo_url IS NULL, so a stadium that got the
# WRONG photo (the person/common noun its bare name resolves to — "Сантьяго
# Бернабеу", "Велодром") never heals on re-runs. This script re-resolves
# every stadium card with the fixed candidate order ("(стадион)" first) and
# the P31 venue guard, then PATCHes photo_url whenever the correct URL
# differs from the stored one. Cards the new chain cannot resolve keep their
# current photo and are flagged for manual review.
#
# For the audit ("стадион -> чьё фото") the CURRENT photo is attributed by
# resolving the bare card name (the old chain's first candidate) and
# comparing its P18 URL with the stored one; a P31 containing Q5 marks it
# as a PERSON's photo.
#
# Usage:  python stadium_photo_audit.py [--dry-run]

import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from run import (  # noqa: E402
    BASE_DIR, cards_photos_candidates, load_config,
    make_stadium_qid_validator, require_env, resolve_card_qid,
)
from scraper.cache import FileCache  # noqa: E402
from scraper.pageviews import WikimediaBudget, WikiPagePropsClient  # noqa: E402
from scraper.supabase_writer import CardsClient  # noqa: E402
from scraper.wikidata import WikidataEnricher, commons_filepath_url  # noqa: E402

import requests  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

HUMAN_QID = "Q5"


def main():
    dry_run = "--dry-run" in sys.argv
    load_dotenv(os.path.join(BASE_DIR, ".env"))
    cfg = load_config(os.path.join(BASE_DIR, "config.json"))
    photos_cfg = cfg.get("photos", {})
    width = int(photos_cfg.get("width", 256))
    pv = cfg["pageviews"]

    supa_url = require_env("SUPABASE_URL")
    supa_key = require_env("SUPABASE_KEY")

    cache = FileCache(
        os.path.join(BASE_DIR, cfg["cache"]["dir"]), cfg["cache"]["enabled"])
    budget = WikimediaBudget(
        photos_cfg.get("daily_request_budget", 5000),
        os.path.join(BASE_DIR, cfg["cache"]["dir"], "photos_budget.json"))
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget)
    cards_client = CardsClient(supa_url, supa_key)

    # All stadium cards, photo present or not — forced re-check.
    rows = []
    resp = requests.get(
        cards_client.endpoint, headers=cards_client.read_headers,
        params={"select": "id,name,name_en,category,photo_url",
                "category": "eq.stadium", "order": "name.asc",
                "limit": 1000},
        timeout=30)
    resp.raise_for_status()
    rows = resp.json()

    def url_for_qid(qid):
        if cache.get("wikidata_p18", qid) is None:
            budget.consume()
        filename = wikidata.media_filename_for_qid(qid, "P18")
        if not filename:
            return None
        return commons_filepath_url(filename, width, photos_cfg.get(
            "filepath_base",
            "https://commons.wikimedia.org/wiki/Special:FilePath"))

    print("=" * 72)
    print("STADIUM PHOTO AUDIT ({}) — {} карточек".format(
        "DRY RUN" if dry_run else "LIVE: перезапись при расхождении",
        len(rows)))
    print("=" * 72)

    fixed = 0
    ok = 0
    unresolved = 0
    person_photos = 0
    for card in rows:
        name = card["name"]
        current = card.get("photo_url")
        validate = make_stadium_qid_validator(card, wikidata, cache, budget)
        qid, title, _search = resolve_card_qid(
            resolver, card, cards_photos_candidates(card), validate=validate)

        correct = url_for_qid(qid) if qid else None

        # Attribute the CURRENT photo: the old chain took the bare name first.
        owner = ""
        if current and current != correct:
            info = resolver.qid_for_title(name)
            old_qid = info.get("qid")
            if old_qid and url_for_qid(old_qid) == current:
                if cache.get("wikidata_p31", old_qid) is None:
                    budget.consume()
                p31 = wikidata.instance_of_qids(old_qid)
                kind = "ЧЕЛОВЕК" if HUMAN_QID in p31 else "не стадион"
                owner = "фото от статьи «{}» ({}, {})".format(
                    name, old_qid, kind)
                if HUMAN_QID in p31:
                    person_photos += 1
            else:
                owner = "источник старого фото не определён"

        if not qid:
            unresolved += 1
            status = "НЕ РАЗРЕШЕНО (P31-гард/нет статьи) — фото не трогаю"
        elif correct is None:
            unresolved += 1
            status = "QID {} ({}) без P18 — фото не трогаю".format(qid, title)
        elif current == correct:
            ok += 1
            status = "OK ({}, «{}»)".format(qid, title)
        else:
            fixed += 1
            status = "ПЕРЕЗАПИСЬ -> {} ({}, «{}»)".format(
                correct.split("/FilePath/")[-1].split("?")[0], qid, title)
            if not dry_run:
                cards_client.set_card_photo(card["id"], correct)
        print("- {:<28} {} {}".format(name, status,
                                      "| " + owner if owner else ""))

    print("=" * 72)
    print("ИТОГ: OK {}, перезаписано {}, не разрешено (без изменений) {}, "
          "из перезаписанных было фото человека: {}".format(
              ok, fixed, unresolved, person_photos))
    print("Бюджет: {}/{} (UTC {})".format(
        budget.used, budget.limit, budget.date))


if __name__ == "__main__":
    main()
