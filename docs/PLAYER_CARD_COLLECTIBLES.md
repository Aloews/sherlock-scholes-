# Collectible player cards

## Unlock rule

A card becomes a profile collectible after **100 correct answers for that same card in 1v1 games only**. The opponent who is guessing receives progress. Team games never contribute because the current game flow does not identify the individual who said the answer.

The database, not the browser, counts progress from a server-side trigger when a round card changes to `correct`, and only when the room mode is `1v1`. A unique event ledger keyed by round-card and player prevents status toggles or repeated realtime updates from inflating progress. Skipped cards and team-mode answers do not count. The follow-up migration removes any team-mode events and recalculates progress and 100-answer unlocks from qualifying 1v1 history. Unlocking is idempotent.

## Profile experience

The profile shows unlocked cards as a visual collection and up to three cards closest to unlocking, including a progress bar to 100. Cards retain the existing name, photo, category and rarity styling. A signed Telegram Mini App `initData` is validated by the database before the inventory/progress RPC returns anything; the inventory tables have RLS enabled and no direct client table grants.

## Trading — later phase

The inventory schema has a stable collectible row ID and an acquisition source so a later trade system can transfer ownership transactionally. Trading is intentionally not enabled in this change. Before enabling it, add server-side trade offers, explicit acceptance, ownership checks under row locks, a rule for duplicate ownership, cancellation/expiry, audit history, rate limits and tests for simultaneous offers. Never implement trades as direct client-side UPDATEs.

## Validation

`supabase/tests/player_card_collectibles.test.sql` covers skipped cards, 1v1-only attribution, exclusion of team-mode answers, duplicate status transitions, the 100-guess threshold, and client table privileges. The SQL regression workflow runs it against a disposable PostgreSQL 16 database.
