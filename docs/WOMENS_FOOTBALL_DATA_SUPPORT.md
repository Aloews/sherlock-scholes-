# Women's football data support

## Current implementation boundary

The existing seasonal-stat parser accepts a Transfermarkt player ID and preserves season, competition, and club identifiers from the source response. It does not currently apply a men's-league allowlist in `parse_seasons`. The player collectors query active `cards` whose `category = player`, so women's players can use the same path once their cards and source identifiers exist.

This is **technical compatibility, not proof of coverage**. The current production roster, Transfermarkt endpoints, competition metadata, match-data providers, and photo availability have not yet been audited specifically for women's football.

## Implementation plan

1. **Seed women's player cards from an explicit source.** Import women's teams, squads, and players with stable source IDs. Do not infer a player's gender from their name, portrait, or club.
2. **Reuse the existing generic player identity.** Keep `category = player` for player cards. Preserve source IDs and link season-stat rows to the correct card; do not create a parallel player category that existing game/history queries would silently exclude.
3. **Treat competitions as data, not hard-coded men's lists.** Store source competition IDs and names, season IDs, club IDs, country, and available competition metadata. Do not assume a competition's gender from its display name. Add a source-backed competition classification only when the upstream data provides one or the mapping is curated and reviewed.
4. **Add women's-league discovery and roster ingestion.** A separate seed/configuration of women's leagues should feed the same generic parsers. Keep men's and women's source coverage observable independently, so an empty source response is not mistaken for complete coverage.
5. **Collect portraits with the same safe fallback order.** Prefer a validated player-specific Wikidata portrait where available; then try the Transfermarkt player profile. Reject placeholder images and only write into empty photo fields. Wikimedia files must pass through the existing attribution pipeline.
6. **Add match-level data only after provider coverage is verified.** Season aggregates alone do not create match logs. Audit the provider's women's competitions and coverage before presenting appearances, minutes, goals, or ratings as complete.
7. **Expose provenance and coverage.** Track last attempted, last successful, source, and failure reason per import job (or equivalent job telemetry). Report missing IDs, empty-but-valid profiles, transient failures, photo placeholders, and rejected writes separately.
8. **Validate end to end.** Tests must cover at least one real women's league and player fixture, multiple clubs/seasons, empty seasons, missing photos, duplicate source IDs, and persistence through card details and game history.

## Acceptance criteria

- A women's player with a stable source ID receives a normal player card and can be found by the existing card/profile APIs.
- Seasonal rows preserve competition, club, and season distinctions and do not overwrite each other.
- Photo jobs never replace a real image with a placeholder or overwrite a non-empty portrait.
- A transient upstream failure is reported as a retryable failure, not as a confirmed absence of data.
- Coverage dashboards distinguish men's and women's source coverage without assuming one proves the other.
- Existing men's player, club, and competition imports remain unchanged.

## Current status

This change set adds offline parser regression tests and wires the missing Transfermarkt portrait collector into the scheduled photo pipeline. It does not yet seed women's leagues or claim that women's match-level coverage is available in production.
