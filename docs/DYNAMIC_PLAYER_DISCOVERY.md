# Sherlock Scholes — dynamic football-player discovery

## Implementation brief

Act as Staff Software Engineer, QA Lead, and production owner. Audit the current main branch and the existing Smart Deck flow before changing code. Extend the existing implementation; do not create a parallel player catalog, duplicate parser, duplicate Edge Function, or another disconnected room-creation path.

## Goal

When a user enters a meaningful football-player request during room creation, the app must search beyond the existing cards catalog. If real matching players are missing, discover them from external structured sources, validate the requested constraints, create or enrich canonical game-card rows, and use those exact canonical IDs in the deck for the room being created.

This must work in Quick Game, Online, and Competitive modes anywhere the existing category/deck prompt is available. Do not require the user to know whether a category already exists in the catalog.

Examples:
- «Футболистки России»
- «16-летние игроки Рубина»
- «Вратари России»
- «Легенды Реала 2000-х»
- equivalent requests in English and supported languages.

## Discovery pipeline

1. Authenticate the Telegram user and enforce the existing per-user quota before making external requests.
2. Parse the prompt into explicit constraints: player intent, gender, nationality, exact age or age range, club, playing position, and historical era when stated.
3. Query an external structured football/person source. The initial live source is Wikidata:
   - require an association-football-player occupation claim;
   - resolve named clubs to a real Wikidata club entity before querying;
   - use current club statements for current-roster requests and dated club statements for historical eras;
   - use explicit gender and citizenship claims for constrained requests;
   - require day-precision dates of birth for age-constrained results;
   - cap result counts, use timeouts, and handle upstream throttling/failure.
4. Re-validate every result after retrieval. Never trust the LLM to assert that a player exists, is a particular age, belongs to a club, or has a particular nationality/gender.
5. Match identities by Wikidata QID first. If a legacy card has no QID, link it only when exact name + date of birth + country establish a safe match. Do not merge same-name players without enough evidence.
6. Create or enrich the canonical row through a single service-role-only, idempotent database RPC. Serialize concurrent writes for the same QID. Do not create synthetic IDs or duplicate cards.
7. Store only source-backed fields: canonical name, English name when available, birth date, nationality, position, photo URL and source, QID, tags, and provenance. Missing data stays null. Do not invent stats, club history, ratings, achievements, photos, or market value.
8. Feed the returned canonical IDs into the same request's catalog and deck-building path. The LLM may select from verified canonical records only; it may not create names or IDs.
9. For explicit constraints, selection must remain restricted to the verified result set. Never fill a constrained deck with unrelated cards from the general catalog.
10. If fewer than three verified players exist, return a concise recoverable result without calling the LLM. If an upstream source fails for a constrained query, fail closed with a retryable error. For unconstrained requests, retain the existing catalog behavior.
11. Keep the existing room creation and card dealing flow. No separate temporary IDs, alternate card table, or post-game-only records.

## Canonical card and safety requirements

- Canonical player category is `player`; women's footballers use the same player category plus explicit `women`/`female` tags. Legacy `woman` cards may be accepted only as a compatibility fallback for women's prompts.
- Wikidata QIDs must match `Q[1-9][0-9]*`. Reject malformed entities and malformed external URLs.
- Photos may be stored only when returned from an accepted source; the source is persisted. Do not fabricate photo URLs.
- The RPC must use a fixed search_path, be SECURITY DEFINER only if necessary, and revoke execute from PUBLIC, anon, and authenticated. Grant execute only to service_role.
- Enforce prompt length, request timeout, result limit, and the existing quota. Do not log tokens, Telegram init data, or secrets.
- Treat prompt text as untrusted data. Never splice raw user text into SPARQL; any query clauses must come from validated enums/QIDs.
- External discovery failure must not corrupt an existing room or create a partially validated card.

## Required tests

Unit/regression:
- Russian and English women's-player requests.
- Exact age parsing and UTC boundary dates.
- Reject year-only/low-precision birth dates for age-constrained requests.
- Club resolution and current-roster constraints.
- Historical club-stint overlap with a stated decade.
- Position-only and nationality-only requests.
- Invalid QIDs, missing names, and malformed photo URLs.
- Repeated discovery of the same QID returns the same canonical ID.
- Two concurrent writes cannot create duplicate canonical cards.
- Women's requests reject men's cards; age/club/position requests never select records outside the verified result set.
- Existing Smart Deck category/position tests remain green.

Integration/E2E:
- Verify the migration against disposable PostgreSQL before production.
- Verify the Edge Function with mocked upstream responses and real network responses when available.
- Test Telegram-authenticated room creation in Quick Game, Online, and Competitive modes.
- Test no-match, one/two-match, source timeout, source throttling, duplicate discovery, and retry behavior.
- Confirm canonical cards are available immediately in the room's deck and later in the profile/collection paths that use canonical card IDs.

## Release process

1. Inspect current main, existing PRs, and overlapping changes first.
2. Implement on one feature branch and one PR; do not split the feature into multiple tiny PRs.
3. Run Deno discovery tests, existing Smart Deck regression, edge-function type checks, SQL migration tests, full CI, and build.
4. Inspect Vercel production/preview status and limits before merge. Do not merge while required checks are red or while the deployment state is unverified.
5. After green checks, merge, apply the migration through the normal release process, deploy the updated Supabase Edge Function with all local imports, then verify the live function and actual Telegram room-creation path.
6. Confirm production migration history, function version, logs, and source-backed canonical cards. Do not claim production readiness based only on a merged PR or a READY Vercel deployment.

## Reporting

Do not send progress updates or intermediate messages. Report once all stages are complete and verified. If an external permission or deployment limit blocks a required stage, report that exact blocker and do not claim completion.
