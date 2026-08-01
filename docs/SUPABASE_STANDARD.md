# Supabase Standard

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md). Postgres
> + RLS + Realtime + Edge Functions. Related: `supabase/migrations/`,
> `supabase/functions/tg-pay/`, `src/shared/lib/supabase.ts`.

## 1. Migrations

- **Every schema change is a migration** in `supabase/migrations/`, checked into
  git. No manual changes in the dashboard that aren't captured as a migration.
- Migrations are **forward-only and idempotent** where possible (`create ... if
  not exists`, guarded `alter`). Name them descriptively (the repo already does:
  `rls_lockdown.sql`, `pick_random_cards_tags.sql`, …).
- A migration that changes an RPC signature MUST keep the app working during
  rollout — the client already tolerates a missing parameter (`PGRST202` →
  graceful degrade in `cardRandomizer.ts`). Preserve that contract or bump
  deliberately with an ADR.
- Destructive migrations (drop/rename column, data backfill) require: a preview
  script (`docs/*_preview.py` pattern), a review, and a rollback plan.

## 2. Row-Level Security (RLS) — MUST

- **RLS is ON for every table with user-reachable data.** The anon key is public
  (it ships in the client); RLS is the actual access control. `rls_lockdown.sql`
  is the baseline — never regress it.
- MUST NOT disable RLS to "make a query work". If a legitimate read is blocked,
  write a correct policy.
- Policies are least-privilege: anon may read only what the game needs (active
  cards), and write only through vetted paths. Writes that must be trusted
  (payments, pro status) go through the **edge function / service role**, never a
  direct anon write.
- Every new table ships **with its policies in the same migration**, plus tests
  or a documented manual check that anon cannot read/write beyond intent.

## 3. RPC (PostgREST functions)

- Randomness and fair category distribution happen **server-side** in
  `pick_random_cards()` (`ORDER BY random()`), not in the client — keep it there.
- RPC parameters are **additive and optional** so old clients keep working
  (`p_continents`, `p_tags`, `p_init_data`, `p_difficulty`, `p_boost_countries`,
  `p_lang`). Adding one MUST NOT break a client that doesn't send it.
- Server-enforced authorisation (e.g. pro decks) is done inside the RPC using the
  verified `p_init_data`, not by trusting the client.
- PostgREST caps response rows (max-rows = 1000 here); callers wanting the whole
  deck paginate and dedupe by id (see `useTraining`). Document such caps.

## 4. Indexes & query performance

- Every column used in a `where`/`order`/join on a large table MUST be indexed.
  Player search by name uses trigram (`cards_name_trgm.sql`) — keep search paths
  index-backed as the deck grows to tens/hundreds of thousands.
- MUST NOT ship an unbounded `select *` over a large table to the client; select
  needed columns, filter and paginate server-side.
- Validate query plans (`explain analyze`) for new hot queries; note the plan in
  the PR for anything on the search/deck path.

## 5. Realtime

- Subscriptions are scoped to the specific room/channel, not global.
- Every subscription is cleaned up on unmount (no leaked channels).
- The client MUST tolerate reconnects and missed events: room state is
  reconciled from the DB on resubscribe, not assumed from the event stream alone
  (the state machine already has `round_active → game_end` to catch a missed
  final event — preserve that resilience).

## 6. Edge functions

- `tg-pay` (and any future function) MUST verify `initData` server-side before
  acting, validate all inputs, and never leak secrets.
- Secrets come from function env/config, never from the client or the repo.
- Functions are deployed via the checked-in script (`deploy_tg_pay.sh`) /
  migration flow, and their behaviour is covered by tests where feasible.

## 7. SQL style

- Lowercase keywords or consistent-with-file; snake_case identifiers.
- Explicit column lists (no `select *` in shipped code paths).
- Comment non-obvious logic (the migrations already do — match it).
- One logical change per migration file.

## 8. Prohibitions (MUST NOT)

- MUST NOT disable or weaken RLS.
- MUST NOT allow direct anon writes to trust-sensitive tables (payments, pro).
- MUST NOT change/remove an RPC parameter in a way that breaks older clients
  without an ADR + rollout plan.
- MUST NOT ship unindexed hot queries or unbounded selects to the client.
- MUST NOT put secrets in migrations, functions source, or the repo.
