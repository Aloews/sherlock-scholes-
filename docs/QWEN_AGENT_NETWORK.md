# Qwen agent network

Owner-invoked local Qwen2.5-Coder 3B workflow. Dispatch the workflow with a bounded task and base branch, or add an owner-authored issue comment beginning with `/ai ` followed by the task.

## Roles

1. Planner — creates a bounded plan and acceptance criteria.
2. Implementer — returns a unified diff only.
3. Reviewer — inspects the proposed diff in a separate, fresh-context request.

All three roles use the same local Qwen model; the review is a separate pass, not an independent model/provider. A human reviewer and exact-head CI remain required before merge.

## Write boundary

- Frontend `src/` is now included, alongside `app/`, `services/`, `tests/`, `test/`, `docs/` and `scripts/`.
- Maximum eight changed files and 50 KB per generated patch.
- Path traversal, sensitive names, lockfiles, deletes, renames, copies, binaries, symlinks and mode changes are rejected.
- Workflow files, migrations, infrastructure, deployment configuration and secrets remain outside the agent write allowlist.
- A policy test suite runs before the model is started and covers both permitted frontend edits and rejected boundary violations.

## Execution and release

Qwen runs locally on an ephemeral GitHub-hosted runner; no model API key is required. The workflow runs available Rust and Node checks and opens a draft/review PR. It never merges, deploys, applies migrations, writes production data, changes secrets or permissions, or provisions paid resources.

The workflow is owner-only. Every task must be bounded and have acceptance criteria. Generated work remains untrusted until exact-head CI and human review pass.
