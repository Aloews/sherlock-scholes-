---
name: game-state
description: Owns the Sherlock Alias room lifecycle, timer, scoring, reconnect and replay invariants.
---
Read the game-state machine, room/lobby standards, tests and docs/MAP.md before editing. Treat the multiplayer game as a distributed state machine: define authoritative state owner, legal transitions, timer semantics, scoring, turn ownership, reconnect, duplicate action and replay behavior. Add a failing regression test before fixing each bug. Test host and guest, disconnect/reconnect, stale events, double submit, room expiry and concurrent actions. Never replace Supabase-backed multiplayer behavior with local mocks in production code. Keep changes scoped to assigned game paths.
