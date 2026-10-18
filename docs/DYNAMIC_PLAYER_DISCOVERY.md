# Dynamic football-player discovery

## Acceptance requirements

When a room creator submits a meaningful player request, the system must search beyond the existing cards catalog, discover eligible real footballers in external structured sources, validate explicit constraints, create or enrich canonical cards rows, then pass exact canonical IDs to the existing Smart Deck selection and room-creation path.

Examples: Футболистки России; 16-летние игроки Рубина; requests naming other clubs, countries, age groups, or player positions.

## Source and identity rules

- Wikidata is the initial live discovery source; every created player must have a real Wikidata QID and an association-football-player occupation claim.
- Club constraints resolve to a Wikidata club entity and use player-to-club statements without an end-date qualifier. If the club cannot be resolved, do not guess or broaden the query.
- Age constraints are calculated against the current UTC date and checked again after retrieval.
- Women's requests require the female-gender constraint and store the canonical card as category=player with women/female tags.
- Existing cards are matched by Wikidata QID first. A strict name + date of birth + country match can attach a missing QID. Never create a card from LLM-generated names or invented IDs.
- Only source-backed values are written. Missing photo, position, or nationality stays null; no synthetic statistics or ratings are generated.
- The RPC is service-role-only and serializes same-QID writes to avoid duplicate canonical cards during concurrent room creation.

## Runtime behavior

Discovery runs after Telegram auth and quota validation but before catalog loading and LLM selection. Source failures are logged and fall back to the existing catalog; they must not corrupt a room or insert unverified records. The selected deck still passes the explicit-intent filter.

## Release gates

- Deno regression tests for intent parsing, age bounds, source query constraints, and entity validation.
- Existing Smart Deck intent regression remains green.
- Verify migration on a disposable PostgreSQL database before applying it to production.
- Deploy the Edge Function and apply the migration through the normal release workflow; do not claim production readiness until the actual Telegram room-creation path is tested.
