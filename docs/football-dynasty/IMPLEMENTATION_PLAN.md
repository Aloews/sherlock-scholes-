# Football Dynasty — Repository Integration Plan

**Inspection date:** 2026-11-05  
**Inspected main commit:** `ec159aeb0a7f44bb32a7c462c92de6037b5d175b`

## Verified repository and production facts

- Repository: `Aloews/sherlock-scholes-`; default branch: `main`.
- App: React 18, Vite, TypeScript, Supabase JS.
- Route registry: `src/app/Router.tsx`.
- Architecture: FSD with `src/shared`, `src/features`, `src/screens`, and `src/app`.
- Supabase access: feature services use PostgREST/RPC; Edge Functions handle selected server-side operations. No general-purpose backend service is documented.
- Supported locales: ru, en, es, pt, fr, ar, ja, ko, zh.
- Connected production Supabase project: `konoavrduynecxblqfvq`.
- Production `public` schema: 126 base tables at inspection.
- Existing football data includes `cards`, `players`, `player_stats`, `player_season_stat`, `player_match_stats`, `football_club`, `club_roster`, `fixtures`, `club_match`, `league_season`.
- Existing room game data includes `rooms`, `room_players`, `teams`, `rounds`, `round_cards`, `scores`.
- Newest observed production migration: `20261030143452 club_match_refresh_timeout`.
- Security standard requires server-verified Telegram `initData`; the exact identity verifier and trusted ID type must be traced before campaign ownership is implemented.

## Release context

Open PRs at inspection included #373 (parser-history audit), #372 (production audit), #371 (team tournament refresh), #367 and #366 (market/forecast and team-refresh work), plus older work. Do not merge or rebase unrelated work for this feature.

The inspected main commit had a successful Vercel status. The GitHub workflow-run lookup returned no runs for that commit, so this audit does not certify all CI workflows passed. The queried combined statuses for PR heads #373, #372, and #371 showed Vercel success only. Vercel success is not proof of passing tests.

Supabase advisors reported existing project-wide findings, including RLS-enabled relations without policies and unindexed foreign keys. Treat them as baseline findings; compare new Football Dynasty findings separately and do not weaken security to clear warnings.

## Integration decisions

1. Use the existing Sherlock Scholes app and Supabase project.
2. Put fictional state in a dedicated `fd_` namespace.
3. Never insert fictional players/clubs into real football catalogue tables.
4. Follow current FSD, router, Zustand, design-system, and i18n rules.
5. Keep authoritative transitions in transactional Postgres RPCs initially; use Edge Functions only when justified.
6. Reuse the verified Telegram identity contract; do not assume `auth.uid()` is the product identity.
7. Start with single-player campaigns. Multiplayer and always-on global simulation are deferred.
8. No production DB writes during discovery.

## First vertical slice

**Founder → club → family → heir → death → succession → continue as heir.**

Screens: campaign setup/origin, campaign overview, character profile, family tree, club ownership/leadership, event decisions, chronicle.

Server command candidates: create campaign/world/character; create family link; acquire club/appoint executive; advance bounded simulation; resolve event; preview/execute succession; load campaign.

Domain rules: separate personal/family/holding/club accounts; explicit ownership and control; deterministic event resolution; immutable journal and chronicle; idempotent commands; campaign-level RLS.

## Work sequence

### Phase 0 — identity and access trace
Inspect Telegram initData verification, current RPCs, grants, RLS conventions, Edge Function patterns, migrations, and tests. Record an ADR for identity and execution boundary.

### Phase 1 — pure domain kernel
Implement typed rules and tests for age, kinship, relationships, ownership shares, succession preview, and ledger balancing. No database writes.

### Phase 2 — database contract
Create additive migrations on a feature branch and test against disposable/local Supabase. Verify cross-user RLS, composite campaign isolation, idempotency, and succession atomicity. Do not apply to production before review and green gates.

### Phase 3 — server commands
Implement narrowly scoped RPCs with verified identity, strict validation, transaction boundaries, idempotency, and regression tests. Keep simulation batches bounded.

### Phase 4 — frontend vertical slice
Add lazy-loaded route, feature services/screens, and all nine locale keys. Reuse current UI primitives and design tokens.

### Phase 5 — fictional football and rival AI
Add leagues, clubs, players, fixtures, match outcomes, season progression, and budget-constrained rival decisions. Profile at target MVP scale.

### Phase 6 — persistence and release hardening
Test save/reload, interrupted tick recovery, deterministic replay, cross-user isolation, and existing Sherlock regression journeys. Release only after all required gates pass.

## Non-goals of the discovery PR

No production schema changes, seed data, real football catalogue changes, public route exposure, Vercel deployment, unrelated PR merges, or LLM-authoritative state.

## Implementation kickoff gate

Start code only after exact Telegram identity is documented; RPC/Edge boundary is decided; campaign RLS tests are designed; ownership model is reviewed; bounded tick performance is measured locally; and a disposable Supabase test environment is available.
