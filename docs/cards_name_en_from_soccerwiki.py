# -*- coding: utf-8 -*-
"""Backfill empty cards.name_en from an already-linked Soccer Wiki player profile."""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _sb import all_rows, sb  # noqa: E402

_LATIN = re.compile(r"[A-Za-z]")
_SPACE = re.compile(r"\s+")


def clean_name(value):
    if not isinstance(value, str):
        return None
    name = _SPACE.sub(" ", value).strip()
    if len(name) < 3 or not _LATIN.search(name):
        return None
    if name.casefold() in {"unknown", "n/a", "none", "player"}:
        return None
    return name


def candidate(card, profile):
    if not card or not profile or card.get("id") != profile.get("card_id"):
        return None
    if (card.get("name_en") or "").strip():
        return None
    card_born = (card.get("born_on") or "")[:10]
    profile_born = (profile.get("born_on") or "")[:10]
    if card_born and profile_born and card_born != profile_born:
        return None
    return clean_name(profile.get("full_name"))


def main():
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_KEY"):
        raise SystemExit("Нужны SUPABASE_URL и SUPABASE_KEY")
    apply = os.environ.get("APPLY") == "1"
    cards = all_rows("cards", {
        "select": "id,name,name_en,born_on", "active": "is.true",
        "category": "eq.player", "or": "(name_en.is.null,name_en.eq.)",
        "order": "id.asc",
    })
    linked = all_rows("soccerwiki_player", {
        "select": "card_id,full_name,born_on", "card_id": "not.is.null",
        "full_name": "not.is.null", "order": "card_id.asc",
    })
    by_card = {}
    ambiguous = set()
    for row in linked:
        cid = row.get("card_id")
        if not cid or not clean_name(row.get("full_name")):
            continue
        old = by_card.get(cid)
        if old and old.get("full_name") != row.get("full_name"):
            ambiguous.add(cid)
        else:
            by_card[cid] = row
    work = [(c, candidate(c, by_card.get(c.get("id"))))
            for c in cards if c.get("id") not in ambiguous]
    work = [(c, name) for c, name in work if name]
    print("Пустых name_en: %d; подтверждено по card_id: %d; APPLY=%s"
          % (len(cards), len(work), "1" if apply else "0 (dry-run)"))
    for card, name in work:
        print("%s -> %s" % (card.get("name") or card["id"], name))
        if apply:
            result = sb("cards", method="PATCH", params={
                "id": "eq." + card["id"],
                "or": "(name_en.is.null,name_en.eq.)",
            }, body={"name_en": name})
            if result is None:
                raise SystemExit("Ошибка записи name_en для card_id=%s" % card["id"])


if __name__ == "__main__":
    main()
