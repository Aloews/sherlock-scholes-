#!/usr/bin/env python3
"""Resolve missing women's-card identities through Wikidata and Transfermarkt IDs."""
from __future__ import annotations

import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb import all_rows, sb  # noqa: E402

API = "https://www.wikidata.org/w/api.php"
USER_AGENT = "SherlockScholesBot/1.0 (+https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)"
FOOTBALLER_QID = "Q937857"
TM_ID_PROPERTY = "P2020"
PAUSE = 1.0
BATCH_SIZE = 50


def normalize_name(value: str | None) -> str:
    folded = unicodedata.normalize("NFKD", str(value or ""))
    ascii_value = folded.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "", ascii_value)


def claim_values(entity: dict[str, Any], property_id: str) -> list[Any]:
    values = []
    for statement in (entity.get("claims") or {}).get(property_id, []):
        snak = statement.get("mainsnak") or {}
        data = snak.get("datavalue") or {}
        if data.get("value") is not None:
            values.append(data["value"])
    return values


def transfermarkt_id(entity: dict[str, Any]) -> str | None:
    for value in claim_values(entity, TM_ID_PROPERTY):
        candidate = str(value.get("id") if isinstance(value, dict) else value).strip()
        if re.fullmatch(r"\d{1,12}", candidate):
            return candidate
    return None


def is_footballer(entity: dict[str, Any]) -> bool:
    occupations = {
        str(value.get("id"))
        for value in claim_values(entity, "P106")
        if isinstance(value, dict) and value.get("id")
    }
    description = str((entity.get("descriptions") or {}).get("en", {}).get("value") or "").lower()
    return FOOTBALLER_QID in occupations or "football" in description or "soccer" in description


def entity_matches_card(card: dict[str, Any], entity: dict[str, Any]) -> bool:
    if card.get("category") not in (None, "woman"):
        return False
    if not is_footballer(entity):
        return False
    card_name = normalize_name(card.get("name_en") or card.get("name"))
    if not card_name:
        return False
    labels = (entity.get("labels") or {}).get("en", {}).get("value", "")
    aliases = [
        alias.get("value", "")
        for alias in (entity.get("aliases") or {}).get("en", [])
    ]
    normalized_names = {normalize_name(labels), *(normalize_name(alias) for alias in aliases)}
    return card_name in normalized_names


def request_json(params: dict[str, str]) -> dict[str, Any]:
    url = API + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("Unexpected Wikidata response")
    return payload


def search_qids(name: str) -> list[str]:
    payload = request_json({
        "action": "wbsearchentities", "search": name, "language": "en",
        "type": "item", "limit": "10", "format": "json",
    })
    return [
        str(item.get("id")) for item in payload.get("search", [])
        if re.fullmatch(r"Q\d+", str(item.get("id") or ""))
    ]


def fetch_entities(qids: list[str]) -> dict[str, dict[str, Any]]:
    entities: dict[str, dict[str, Any]] = {}
    unique = list(dict.fromkeys(qids))
    for start in range(0, len(unique), BATCH_SIZE):
        batch = unique[start:start + BATCH_SIZE]
        payload = request_json({
            "action": "wbgetentities", "ids": "|".join(batch),
            "props": "labels|aliases|descriptions|claims",
            "languages": "en", "format": "json",
        })
        entities.update({
            qid: entity for qid, entity in (payload.get("entities") or {}).items()
            if isinstance(entity, dict) and entity.get("id") == qid
        })
        time.sleep(0.2)
    return entities


def main() -> int:
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_KEY"):
        print("SUPABASE_URL and SUPABASE_KEY are required", file=sys.stderr)
        return 2
    apply = os.environ.get("APPLY") == "1"
    cards = all_rows("cards", {
        "select": "id,name,name_en,wikidata_qid,transfermarkt_id,active,fame,category",
        "category": "eq.woman", "active": "is.true",
        "transfermarkt_id": "is.null", "name_en": "not.is.null",
        "order": "fame.desc.nullslast,id.asc",
    })
    if not cards:
        print(json.dumps({"status": "skipped", "reason": "no women's cards need Transfermarkt IDs"}))
        return 0

    queries: dict[str, list[str]] = {}
    qids: list[str] = []
    for card in cards:
        qid = str(card.get("wikidata_qid") or "").strip()
        if not re.fullmatch(r"Q\d+", qid):
            name = str(card.get("name_en") or "").strip()
            if not name:
                continue
            try:
                found = search_qids(name)
            except Exception as error:  # noqa: BLE001
                print(f"Wikidata search failed for {name}: {error}", file=sys.stderr)
                continue
            qid_list = found[:10]
            time.sleep(PAUSE)
        else:
            qid_list = [qid]
        queries[str(card["id"])] = qid_list
        qids.extend(qid_list)

    entities = fetch_entities(qids)
    existing = all_rows("cards", {
        "select": "id,transfermarkt_id", "transfermarkt_id": "not.is.null",
        "order": "id.asc",
    })
    assigned = {
        str(row.get("transfermarkt_id")): str(row.get("id"))
        for row in existing if row.get("transfermarkt_id")
    }
    proposed: list[dict[str, Any]] = []
    ambiguous: list[str] = []
    for card in cards:
        matches = [
            entities[qid] for qid in queries.get(str(card["id"]), [])
            if qid in entities and entity_matches_card(card, entities[qid])
        ]
        if len(matches) == 1:
            entity = matches[0]
        else:
            if matches:
                ambiguous.append(str(card.get("name_en") or card.get("name")))
            continue

        qid = str(entity.get("id") or "")
        tm_id = transfermarkt_id(entity)
        if tm_id and tm_id in assigned and assigned[tm_id] != str(card["id"]):
            print(f"Duplicate Transfermarkt ID {tm_id}: {card.get('name_en')}", file=sys.stderr)
            continue
        proposed.append({
            "card_id": str(card["id"]), "name": card.get("name_en") or card.get("name"),
            "wikidata_qid": qid, "transfermarkt_id": tm_id,
        })

    tm_count = sum(1 for item in proposed if item["transfermarkt_id"])
    if apply and len(cards) >= 20 and tm_count < 12:
        print(json.dumps({
            "status": "insufficient_identity_matches",
            "cards_checked": len(cards), "transfermarkt_ids": tm_count,
            "minimum_required": 12,
        }), file=sys.stderr)
        return 1

    written = 0
    for item in proposed:
        print(json.dumps(item, ensure_ascii=False))
        if not apply:
            continue
        payload = {"wikidata_qid": item["wikidata_qid"]}
        if item["transfermarkt_id"]:
            payload["transfermarkt_id"] = item["transfermarkt_id"]
        result = sb("cards", method="PATCH", params={
            "id": "eq." + item["card_id"], "category": "eq.woman",
            "transfermarkt_id": "is.null",
        }, body=payload)
        if result is None:
            print(f"Failed to update card {item['card_id']}", file=sys.stderr)
            continue
        written += 1

    print(json.dumps({
        "status": "applied" if apply else "dry_run",
        "cards_checked": len(cards), "verified_identities": len(proposed),
        "transfermarkt_ids": sum(1 for item in proposed if item["transfermarkt_id"]),
        "written": written, "ambiguous": ambiguous,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
