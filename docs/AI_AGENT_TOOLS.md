# AI agent tools

This repository contains repository-scoped agent skills for disciplined implementation and evidence-led reverse engineering.

## ub-mode

Skill: `.agents/skills/ub-mode/SKILL.md`

Use for code changes: reproduce defects, prefer regression-first tests, make the smallest verified change, preserve idempotency and boundaries, and report only checks actually run. This skill supplements rather than overrides `AGENTS.md`, `CLAUDE.md`, `docs/ENGINEERING_CONSTITUTION.md`, and project quality gates.

Upstream source: https://github.com/unclebob/ub-mode

## REA

Skill: `.agents/skills/rea/SKILL.md`

REA is a separate CLI/MCP integration. The repository can store its workflow instructions, but a GitHub commit cannot install a package or register MCP in a developer's local agent. Follow the REA skill to inspect a dry-run plan, approve a scoped setup, restart the client, and verify the live tools.

Official setup: https://rea.tools/get-started/

## Scope and safety

- No secrets, tokens, or machine-specific MCP configuration belong in this repository.
- Do not install optional native analysis engines merely because REA is available.
- Existing project standards and CI gates remain authoritative.
- Treat tool output as evidence; never claim a check or installation succeeded without observing its result.
