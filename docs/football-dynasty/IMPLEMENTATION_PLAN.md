# Football Dynasty — Repository Integration Plan

**Inspection:** 2026-11-05 · **Inspected main:** `ec159aeb0a7f44bb32a7c462c92de6037b5d175b`

## Verified host facts

- React 18 + Vite + TypeScript + Supabase JS.
- Route registry: `src/app/Router.tsx`; FSD layers: `src/shared`, `src/features`, `src/screens`, `src/app`.
- Feature services use PostgREST/RPC; selected server operations use Supabase Edge Functions. No general-purpose backend is documented.
- Nine locales: ru, en, es, pt, fr, ar, ja, ko, zh.
- Production project `konoavrduynecxblqfvq` had 126 base tables in `public`.
- Existing real football relations include `cards`, `players`, `player_stats`, `player_season_stat`, `player_match_stats`, `football_club`, `club_roster`, `fixtures`, `club_match`, and `league_season`.
- Existing game relations include `rooms`, `room_players`, `teams`, `rounds`, `round_cards`, and `scores`.
- Newest observed production migration: `20261030143452 club_match_refresh_timeout`.
- Security standard requires server-verified Telegram `initData`; exact verifier and trusted identity type must be traced before implementing campaign ownership.

## Release context

Open PRs at inspection included #373, #372, #371, #367, and #366, plus older work. Do not merge or rebase unrelated changes for this feature.

The inspected main commit showed a successful Vercel status. GitHub workflow-run lookup returned no runs for that commit; this audit therefore does not certify all CI workflows passed. Vercel status is not a substitute for test gates.

Supabase advisors reported pre-existing project-wide findings, including RLS-enabled tables without policies and unindexed foreign keys. Compare new findings against this baseline; do not weaken RLS.

## Integration decisions

1. Keep the existing Sherlock Scholes app and Supabase project.
2. Store fictional state in an isolated `fd_` namespace.
3. Never insert fictional players/clubs into real football catalogue tables.
4. Follow FSD, Router, Zustand, design-system, and i18n conventions.
5. Keep authoritative state transitions in transactional Postgres RPCs initially; use Edge Functions only when justified.
6. Reuse the verified Telegram identity contract; do not assume `auth.uid()` is the product identity.
7. Start with single-player campaigns; defer multiplayer and always-on world simulation.
8. No production database writes during discovery.

## First vertical slice

**Founder → club → family → heir → death → succession → continue as heir.**

Screens: campaign setup/origin, campaign overview, character profile, family tree, club ownership/leadership, event decisions, chronicle.

Commands: create campaign/world/character; create family link; acquire club/appoint executive; advance bounded simulation; resolve event; preview/execute succession; load campaign.

Domain rules: separate personal/family/holding/club accounts; explicit ownership and control; deterministic event resolution; immutable journal and chronicle; idempotent commands; campaign-level RLS.

## Work sequence

- **Phase 0:** trace Telegram identity, RPCs, grants, RLS, Edge Function patterns, migrations, and tests; record an ADR.
- **Phase 1:** pure domain types/tests for age, kinship, relationships, ownership, succession, and ledger balancing.
- **Phase 2:** additive migrations on a feature branch; disposable/local Supabase tests for RLS, isolation, idempotency, and atomic succession.
- **Phase 3:** validated transactional server commands with bounded simulation batches.
- **Phase 4:** lazy-loaded frontend route, feature services/screens, all nine locales.
- **Phase 5:** fictional leagues, clubs, players, fixtures, season progression, budget-constrained rival AI.
- **Phase 6:** save/reload, interrupted tick recovery, deterministic replay, cross-user isolation, existing Sherlock regression tests.

## Explicit non-goals

No production schema changes, seed data, real football catalogue changes, public route exposure, Vercel deployment, unrelated PR merges, or LLM-authoritative game state.

## Implementation kickoff gate

Start code only after the exact Telegram identity verifier is documented; RPC/Edge boundary is decided; campaign RLS tests are designed; ownership model is reviewed; tick performance is measured locally; and a disposable Supabase test environment is available.
