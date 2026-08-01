# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-07
- **Deciders:** Repository maintainer
- **Related:** [Engineering Constitution](../ENGINEERING_CONSTITUTION.md)

## Context

The project is developed by humans and multiple AI agents. Without a written
record of *why* decisions were made, both re-litigate settled choices and drift
apart. Agents in particular start cold each session and need durable context.

## Decision

We will record every significant engineering decision as an ADR in `docs/ADR/`,
using [`0000-template.md`](./0000-template.md). ADRs are immutable once accepted;
changes come as new ADRs that supersede old ones.

## Alternatives considered

- **No formal record** — decisions live in PR threads and memory. Rejected: not
  discoverable, lost over time, invisible to agents.
- **A single CHANGELOG of decisions** — rejected: one file becomes unsearchable
  and merge-conflict-prone; per-decision files are cleaner.

## Consequences

- **Positive:** durable, searchable rationale; agents and new contributors can
  read *why* before changing *what*.
- **Negative:** small overhead per significant decision.
- **Follow-ups:** link ADRs from the relevant standard and from the PR.

## Compliance

The Code Review Standard requires an ADR for gate changes and new patterns; the
PR template asks whether an ADR is needed.
