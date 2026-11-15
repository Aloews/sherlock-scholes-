# Qwen agent network

Owner-invoked local Qwen2.5-Coder 3B workflow. Dispatch the Qwen agent network with a bounded task and base branch, or add an owner-authored issue comment beginning with /ai followed by the task.

Roles: planner, implementer, independent reviewer. The workflow applies a strict source/test/docs allowlist, rejects deletions and renames, runs available Rust and Node checks, and opens a review PR. It never merges, deploys, changes secrets, or applies database migrations.

Qwen runs locally on an ephemeral GitHub-hosted runner. No model API key is required. Workflow timeout is 50 minutes.
