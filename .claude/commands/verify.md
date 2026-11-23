# Verify Sherlock task

1. Read CLAUDE.md, AGENTS.md, docs/MAP.md and relevant engineering standards.
2. Record branch, exact HEAD, dirty state, PRs and changed paths.
3. Map acceptance to regression, unit, property, data-integrity and E2E tests.
4. Run typecheck, lint, build and relevant quality/mutation gates.
5. Check all nine locale files and Arabic RTL for UI changes.
6. Verify RLS/RPC/auth and real persistence for data or game changes.
7. Exercise actual host/guest and reconnect journeys where multiplayer is affected.
8. Inspect raw CI logs and exact-head status; fix failures and rerun.
9. Report PASS only with evidence; otherwise PARTIAL/BLOCKED.
Never weaken gates or mutate production without explicit authorization.
