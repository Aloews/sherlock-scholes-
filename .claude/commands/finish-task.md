# Finish Sherlock task

- Confirm the final diff matches the request and contains no unrelated edits.
- Confirm regression tests reproduce the old defect and pass after the fix.
- Verify typecheck, lint, build, relevant test suites and exact-head CI.
- Verify nine-locale coverage and RTL for user-facing changes.
- Verify real Supabase/RLS/game behavior for affected user journeys.
- Verify content provenance and licensing for data changes.
- Update docs/MAP.md and relevant standards.
- Record commit SHA, PR, CI run IDs, commands, exit codes, runtime evidence and limitations.
- Do not merge or deploy without explicit authorization.
