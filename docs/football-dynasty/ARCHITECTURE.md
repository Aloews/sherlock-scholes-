# Football Dynasty — Integration Architecture

**Baseline:** v1.0 · **Inspection date:** 2026-11-05.

## Verified host architecture

The inspected default branch is a React 18 + Vite + TypeScript application using Feature-Sliced Design. `src/app/Router.tsx` owns routes and lazy-loads screens. Feature services call Supabase PostgREST/RPC. Edge Functions are used for specific server-side operations. The documented architecture has no general-purpose custom backend.

FSD dependency direction is `app → screens → features → shared`. Existing engineering rules require feature services, typed results, i18n, design tokens, and tests. Nine locales are supported: ru, en, es, pt, fr, ar, ja, ko, zh.

The connected production Supabase project currently has 126 base tables in `public`. Existing real football data includes `cards`, `players`, `player_stats`, `player_season_stat`, `player_match_stats`, `football_club`, `club_roster`, `fixtures`, `club_match`, and `league_season`. Existing multiplayer game tables include `rooms`, `room_players`, `teams`, `rounds`, `round_cards`, and `scores`.

The security standard requires server-verified Telegram Mini App `initData`; client-supplied identity and UI-only access controls are not trusted. Do not assume `auth.uid()` is the product identity.

## Architectural decision

Football Dynasty is a bounded context inside the existing Sherlock Scholes application and Supabase project. It is not a second app, auth system, database project, or football catalogue.

- Keep real catalogue tables unchanged.
- Store fictional campaign state in dedicated `fd_` relations.
- Add a dedicated FSD feature and lazy-loaded screens.
- Reuse app shell, router, Zustand conventions, UI primitives, design tokens, and i18n.
- Keep authoritative transitions in narrowly scoped transactional Postgres RPCs initially.
- Use Edge Functions only when orchestration, secrets, external calls, or bounded background work require them.
- Do not introduce a standalone backend, Redis queue, microservices, or a second state-management paradigm without measured need and an ADR.

## Fictional data boundary

Existing real-world tables remain the source of truth for Sherlock Scholes. Fictional clubs and players live only in `fd_*` tables. Campaign actions must never insert fictional rows into or mutate real football catalogue tables. Any future read-only cross-reference must be explicit and separately reviewed.

## Command boundary

Proposed commands (not existing functions):
- `fd_create_campaign`
- `fd_create_world`
- `fd_create_character`
- `fd_acquire_club`
- `fd_appoint_staff`
- `fd_advance_campaign`
- `fd_resolve_event`
- `fd_preview_succession`
- `fd_execute_succession`
- `fd_load_campaign`

Each command validates campaign ownership through the existing verified Telegram identity contract, checks preconditions, and commits related state atomically. Never trust client-provided Telegram IDs, balances, ownership shares, heirs, or simulation results.

## Simulation execution

Do not simulate years in the browser. A client requests a bounded advance. Persist campaign time, pause state, seed, ruleset version, simulation version, tick cursor, status, and idempotency key. Process bounded batches and make long advances resumable.

Initially, catch up offline progress when the player returns rather than creating a cron job per campaign. A scheduled global worker is a later decision after concurrency and cost measurement.

Determinism requires stable seed derivation from campaign/tick/entity keys. Repeating a command with the same idempotency key returns the original result. Record simulation version so old saves can be migrated or replayed intentionally.

## Security

Follow `docs/SECURITY_STANDARD.md` and `docs/SUPABASE_STANDARD.md`:
- RLS on every exposed campaign table;
- policies scoped to verified campaign owner or explicitly authorised participant;
- no client writes to balances, shareholding, transfers, succession, campaign clock, or AI decisions;
- narrowly granted RPCs with explicit identity validation;
- no service-role key in client code;
- no copying permissive public write policies from legacy game tables;
- cross-user and forged-identity tests.

The `fd_` prefix is naming isolation, not security isolation. Decide public/private schema and Data API exposure only after inspecting current Supabase settings and testing the chosen access model.

## Frontend placement

Proposed route: `/dynasty`, registered only in `src/app/Router.tsx`, lazy-loaded.

Suggested feature:
```
src/features/football-dynasty/
  api/
  model/
  services/
  hooks/
  types/
  lib/
src/screens/football-dynasty/
  DynastyHomeScreen.tsx
  CampaignSetupScreen.tsx
  CharacterScreen.tsx
  DynastyScreen.tsx
  ClubScreen.tsx
  ChronicleScreen.tsx
```

This is a target layout, not a claim about existing directories. Align with the actual FSD layout before implementation. All visible strings go into all nine locales. Keep current navigation unchanged until the feature has a complete entry/exit flow.

## Persistence invariants

Use relational tables for authoritative state and append-only journals for consequential changes. JSONB is for versioned configuration/event payloads, not a substitute for ownership relations or ledgers.

Every campaign-owned row carries `campaign_id`; composite foreign keys should prevent cross-campaign references. Account balances reconcile to journal entries. Succession transfers are atomic and non-repeatable. Campaign time advances monotonically. Chronicle events are immutable. Snapshots carry schema and simulation versions.

## Release

No production schema change during discovery. Test additive migrations on a disposable/local Supabase database, compare migration versions with the production ledger, run advisors, require green CI, and verify existing Sherlock smoke paths. A route flag alone is not security; access must be enforced server-side.
