---
name: release-gate
description: Sherlock-specific pre-merge and release acceptance gates.
---
1. Map each requested outcome to observable acceptance and regression tests.
2. Inspect full diff, project map, architecture, migrations and secrets.
3. Run typecheck, lint, build, unit/property/component/data-integrity tests and relevant mutation gates.
4. Verify all nine locales and Arabic RTL for user-visible changes.
5. Verify Telegram identity, Supabase RLS/RPC authorization and persistence for affected flows.
6. Exercise real game journeys: create/join, host/guest, timer, scoring, reconnect and replay as applicable.
7. Verify content provenance, licensing and source freshness for data changes.
8. Require exact-final-HEAD CI green; inspect skipped and failed steps.
9. Update docs/MAP.md and relevant standards when architecture or ownership changes.
10. Record commit, run IDs, commands, results, runtime evidence and residual risks.
Missing critical evidence means PARTIAL/BLOCKED. Do not merge or deploy without explicit authorization.
