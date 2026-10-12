"""Incrementally enrich cards.facts with a sourced country of birth.

Wikidata P19 (place of birth) -> place entity P17 (country). This never
falls back to cards.country, which represents nationality in this project.
Only cards with a canonical cards.wikidata_qid are eligible; names are not
used to resolve people because namesake collisions have corrupted this deck.

Dry-run by default. Set APPLY=1 to write facts; BIRTH_COUNTRY_BATCH_SIZE
limits each run so the daily enrichment workflow stays within its time budget.
"""
import os
import sys
import json
import requests
from dotenv import load_dotenv


def item_ids(claims, prop):
    """Return item-valued QIDs, preferred rank first, without duplicates."""
    found = []
    for statement in (claims or {}).get(prop, []):
        try:
            value = statement["mainsnak"]["datavalue"]["value"]["id"]
        except (KeyError, TypeError):
            continue
        if isinstance(value, str) and value.startswith("Q") and value not in found:
            found.append(value)
    preferred = []
    for statement in (claims or {}).get(prop, []):
        try:
            value = statement["mainsnak"]["datavalue"]["value"]["id"]
        except (KeyError, TypeError):
            continue
        if statement.get("rank") == "preferred" and value in found and value not in preferred:
            preferred.append(value)
    return preferred + [qid for qid in found if qid not in preferred]


def resolve_birth_country(player_claims, place_entities, country_labels):
    """Return (country label, country QID, place QID, place label) from P19/P17 only."""
    places = item_ids(player_claims, "P19")
    for place_qid in places:
        place = place_entities.get(place_qid) or {}
        claims = place.get("claims") or {}
        countries = item_ids(claims, "P17")
        for country_qid in countries:
            label_row = country_labels.get(country_qid) or {}
            label = label_row.get("ru") or label_row.get("en")
            if not label:
                continue
            labels = place.get("labels") or {}
            place_label = ((labels.get("ru") or {}).get("value")
                           or (labels.get("en") or {}).get("value"))
            return label, country_qid, place_qid, place_label
    return None


def fetch_all(url, key, table, select, extra=None):
    rows, offset = [], 0
    while True:
        params = {"select": select, "limit": 1000, "offset": offset}
        params.update(extra or {})
        response = requests.get(
            url.rstrip("/") + f"/rest/v1/{table}",
            headers={"apikey": key, "Authorization": "Bearer " + key},
            params=params, timeout=30,
        )
        response.raise_for_status()
        batch = response.json()
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        offset += 1000


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    scraper = os.path.join(here, "..", "football_scraper")
    sys.path.insert(0, scraper)
    import importlib.util
    spec = importlib.util.spec_from_file_location("run", os.path.join(scraper, "run.py"))
    run = importlib.util.module_from_spec(spec)
    sys.modules["run"] = run
    spec.loader.exec_module(run)
    from scraper.cache import FileCache
    from scraper.wikidata import WikidataEnricher

    load_dotenv(os.path.join(scraper, ".env"))
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY are required")

    cfg = json.load(open(os.path.join(scraper, "config.json"), encoding="utf-8"))
    cache = FileCache(os.path.join(scraper, "cache"), True)
    budget = run.WikimediaBudget(
        cfg.get("photos", {}).get("daily_request_budget", 5000),
        os.path.join(scraper, "cache", "photos_budget.json"),
    )
    wd = WikidataEnricher(cfg["wikidata"], cache)
    cards = fetch_all(
        url, key, "cards", "id,name,name_en,wikidata_qid,facts",
        {"category": "eq.player", "active": "eq.true", "order": "id.asc"},
    )
    pending = [
        card for card in cards
        if card.get("wikidata_qid")
        and not (card.get("facts") or {}).get("birth_country_checked")
        and not (card.get("facts") or {}).get("birth_country_qid")
    ]
    limit = max(1, min(500, int(os.environ.get("BIRTH_COUNTRY_BATCH_SIZE", "150"))))
    batch = pending[:limit]
    if not batch:
        print("birth-country: no pending canonical player cards")
        return

    def cached_entities(qids):
        result, missing = {}, []
        for qid in dict.fromkeys(q for q in qids if q):
            value = cache.get("wikidata_entity", "ru,en|" + qid)
            if value is not None:
                result[qid] = value
            else:
                missing.append(qid)
        for start in range(0, len(missing), 50):
            chunk = missing[start:start + 50]
            try:
                budget.consume()
            except RuntimeError:
                print("birth-country: Wikimedia budget exhausted; leaving unresolved cards for a later run")
                break
            try:
                entities = wd._api({
                    "action": "wbgetentities", "ids": "|".join(chunk),
                    "props": "claims|labels", "languages": "ru|en",
                }).get("entities", {})
            except Exception as exc:
                print("birth-country: entity batch failed:", type(exc).__name__)
                continue
            for qid in chunk:
                entity = entities.get(qid) or {}
                cache.set("wikidata_entity", "ru,en|" + qid, entity)
                result[qid] = entity
        return result

    def cached_labels(qids):
        result, missing = {}, []
        for qid in dict.fromkeys(q for q in qids if q):
            value = cache.get("wikidata_labels", qid)
            if value is not None:
                result[qid] = value
            else:
                missing.append(qid)
        for start in range(0, len(missing), 50):
            chunk = missing[start:start + 50]
            try:
                budget.consume()
            except RuntimeError:
                print("birth-country: Wikimedia budget exhausted during country labels")
                break
            try:
                entities = wd._api({
                    "action": "wbgetentities", "ids": "|".join(chunk),
                    "props": "labels", "languages": "ru|en",
                }).get("entities", {})
            except Exception as exc:
                print("birth-country: label batch failed:", type(exc).__name__)
                continue
            for qid in chunk:
                labels = (entities.get(qid) or {}).get("labels") or {}
                row = {lang: (labels.get(lang) or {}).get("value") for lang in ("ru", "en")}
                cache.set("wikidata_labels", qid, row)
                result[qid] = row
        return result

    player_entities = cached_entities([card["wikidata_qid"] for card in batch])
    place_ids = []
    for card in batch:
        entity = player_entities.get(card["wikidata_qid"]) or {}
        place_ids.extend(item_ids(entity.get("claims") or {}, "P19"))
    place_entities = cached_entities(place_ids)
    country_ids = []
    for place in place_entities.values():
        country_ids.extend(item_ids((place.get("claims") or {}), "P17"))
    country_labels = cached_labels(country_ids)

    headers = {
        "apikey": key, "Authorization": "Bearer " + key,
        "Content-Type": "application/json", "Prefer": "return=minimal",
    }
    apply = os.environ.get("APPLY") == "1"
    changed = checked = unresolved = 0
    for card in batch:
        qid = card["wikidata_qid"]
        player_entity = player_entities.get(qid)
        if not player_entity or "claims" not in player_entity:
            unresolved += 1
            continue
        resolved = resolve_birth_country(
            player_entity.get("claims") or {}, place_entities, country_labels,
        )
        facts = dict(card.get("facts") or {})
        facts["birth_country_checked"] = True
        if resolved:
            country, country_qid, place_qid, place_label = resolved
            facts.update({
                "birth_country": country,
                "birth_country_qid": country_qid,
                "birth_country_source": "Wikidata P19→P17",
            })
            if place_label:
                facts["birth_place"] = place_label
                facts["birth_place_qid"] = place_qid
            checked += 1
        else:
            # A successfully read entity with no resolvable P19/P17 is a
            # known absence, not permission to substitute nationality.
            checked += 1
        if apply and facts != (card.get("facts") or {}):
            response = requests.patch(
                url.rstrip("/") + "/rest/v1/cards",
                headers=headers, params={"id": "eq." + str(card["id"])},
                json={"facts": facts}, timeout=30,
            )
            response.raise_for_status()
            changed += 1

    print(
        f"birth-country batch={len(batch)} resolved={checked} unresolved={unresolved} "
        f"updated={changed if apply else 0} mode={'APPLY' if apply else 'DRY-RUN'} "
        f"budget={budget.used}/{budget.limit}"
    )


if __name__ == "__main__":
    main()
