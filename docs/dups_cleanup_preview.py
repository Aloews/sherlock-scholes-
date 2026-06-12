# READ-ONLY helper: find probable duplicate cards (same fuzzy matching as
# `run.py --find-dups`) and write docs/dups_cleanup.sql with UPDATE ... SET
# active = false statements for the duplicate of each pair. Never touches the
# database itself.
#
# Why deactivation, not DELETE: round_cards.card_id REFERENCES cards(id)
# without ON DELETE CASCADE — deleting a card that was ever played would
# violate the FK. active = false removes it from the game just as well and
# is reversible.
#
# Keep-rule per pair (same category only; cross-category pairs are emitted
# as comments for manual review): keep the card with a photo, then with
# pageviews, then with name_en, then the one created earlier. The loser is
# deactivated.
#
# Run from anywhere: python docs/dups_cleanup_preview.py
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import os

DOCS_DIR = os.path.dirname(os.path.abspath(__file__))
SCRAPER_DIR = os.path.join(os.path.dirname(DOCS_DIR), "football_scraper")
sys.path.insert(0, SCRAPER_DIR)

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(SCRAPER_DIR, ".env"))

from scraper.dedup import find_duplicate_pairs  # noqa: E402

SUPA_URL = os.environ["SUPABASE_URL"].rstrip("/")
HEADERS = {
    "apikey": os.environ["SUPABASE_KEY"],
    "Authorization": "Bearer " + os.environ["SUPABASE_KEY"],
}


def fetch_cards():
    rows = []
    offset = 0
    while True:
        resp = requests.get(
            SUPA_URL + "/rest/v1/cards",
            headers=HEADERS,
            params={
                "select": "id,name,name_en,category,photo_url,pageviews,"
                          "active,created_at",
                "order": "id.asc",
                "limit": 1000,
                "offset": offset,
            },
            timeout=30,
        )
        resp.raise_for_status()
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def richness(card):
    """Higher = keep. Photo, then the pageviews VALUE (a stale pv=1 card
    must lose to its pv=15000 twin), then name_en."""
    pv = card.get("pageviews")
    return (
        1 if (card.get("photo_url") or "").strip() else 0,
        pv if pv is not None else -1,
        1 if (card.get("name_en") or "").strip() else 0,
    )


def pick(a, b):
    """(keep, drop) for a same-category pair."""
    ra, rb = richness(a), richness(b)
    if ra != rb:
        return (a, b) if ra > rb else (b, a)
    # Equal data richness: keep the older (manual) card.
    ca = a.get("created_at") or ""
    cb = b.get("created_at") or ""
    return (a, b) if ca <= cb else (b, a)


def q(text):
    return "'" + str(text).replace("'", "''") + "'"


def main():
    print("Читаю cards (read-only)...", flush=True)
    cards = [c for c in fetch_cards() if c.get("active") is not False]
    print("Активных карточек: {}".format(len(cards)), flush=True)
    pairs = find_duplicate_pairs(cards)
    print("Найдено пар: {}".format(len(pairs)), flush=True)

    auto = []      # same category, identical canonical key -> active UPDATE
    maybe = []     # same category, score < 1.0 -> commented-out UPDATE
    review = []    # cross-category -> comment block
    dropped = set()  # don't deactivate the same card twice
    for a, b, score in pairs:
        if a["id"] in dropped or b["id"] in dropped:
            continue  # already handled via a previous (higher-score) pair
        if a.get("category") != b.get("category"):
            review.append((a, b, score))
            continue
        keep, drop = pick(a, b)
        # Only an IDENTICAL canonical key (score 1.0 — same letters modulo
        # spelling/punctuation/ё/word order) is a safe automatic dup. Below
        # that the list mixes real dups ("Рэмзи"/"Рэмси") with genuinely
        # different people ("Кака"/"Какау", "Нико"/"Неко Уильямс") — those
        # become commented-out statements for a human to confirm.
        if score >= 0.999:
            dropped.add(drop["id"])
            auto.append((keep, drop, score))
        else:
            maybe.append((keep, drop, score))

    def pair_comment(keep, drop, score):
        return ("-- score {:.2f}: keep «{}» [{} | pv={} | photo={}] — "
                "drop «{}» [pv={} | photo={}]".format(
                    score, keep["name"], keep["category"],
                    keep.get("pageviews"),
                    "y" if keep.get("photo_url") else "n",
                    drop["name"], drop.get("pageviews"),
                    "y" if drop.get("photo_url") else "n"))

    lines = []
    lines.append("-- Duplicate cards cleanup ({} pairs from --find-dups, "
                 "ratio >= 0.85).".format(len(pairs)))
    lines.append("-- Deactivation instead of DELETE: round_cards.card_id "
                 "references cards(id),")
    lines.append("-- so deleting a card that was ever played would break "
                 "the FK. active=false")
    lines.append("-- removes it from the game and is reversible.")
    lines.append("-- Keep-rule: photo > higher pageviews > name_en > older "
                 "card.")
    lines.append("")
    lines.append("-- ============ 1. SAFE: identical canonical key "
                 "(same name modulo spelling) ============")
    for keep, drop, score in auto:
        lines.append(pair_comment(keep, drop, score))
        lines.append(
            "UPDATE cards SET active = false WHERE id = {};  -- «{}»".format(
                q(drop["id"]), drop["name"]))
    lines.append("")
    lines.append("-- ============ 2. REVIEW: close but NOT identical — "
                 "uncomment only confirmed dups ============")
    lines.append("-- (the list mixes real dups like «Рэмзи»/«Рэмси» with "
                 "different people like «Кака»/«Какау»)")
    for keep, drop, score in maybe:
        lines.append(pair_comment(keep, drop, score))
        lines.append(
            "-- UPDATE cards SET active = false WHERE id = {};  -- «{}»"
            .format(q(drop["id"]), drop["name"]))
    if review:
        lines.append("")
        lines.append("-- ============ 3. CROSS-CATEGORY pairs — almost "
                     "certainly different entities ============")
        for a, b, score in review:
            lines.append("--   score {:.2f}: «{}» [{}] {}  <->  «{}» [{}] {}"
                         .format(score, a["name"], a["category"], a["id"],
                                 b["name"], b["category"], b["id"]))
    sql = "\n".join(lines) + "\n"

    out_path = os.path.join(DOCS_DIR, "dups_cleanup.sql")
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(sql)
    print()
    print(sql)
    print("SQL сохранён в docs/dups_cleanup.sql (НЕ выполнялся).")


if __name__ == "__main__":
    main()
