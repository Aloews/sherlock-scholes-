# Architecture Decision Records (ADR)

An ADR captures **one significant decision**: its context, the choice, and its
consequences. ADRs are how this project's standards evolve — see the
[Engineering Constitution](../ENGINEERING_CONSTITUTION.md) § 5 and the
[Roadmap](../ROADMAP.md).

## When to write one

- Introducing/replacing a pattern, library, or paradigm (state manager, test
  framework, data-fetching approach…).
- Changing a quality gate (coverage, mutation, lint, RLS).
- Any decision a future reader would ask "why did they do it this way?" about.

## How

1. Copy [`0000-template.md`](./0000-template.md) to `NNNN-short-title.md`
   (next number).
2. Fill it in. Keep it short and honest — including the downsides.
3. Open it in the PR that implements the decision. Status starts `Proposed`,
   becomes `Accepted` on merge.
4. Superseded decisions are not deleted — mark them `Superseded by NNNN`.

## Index

| # | Title | Status |
| --- | --- | --- |
| [0001](./0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](./0002-adopt-engineering-constitution.md) | Adopt the Engineering Constitution | Accepted |
| [0003](./0003-bootstrap-testing-strategy.md) | Bootstrap testing: Vitest/Stryker + pytest/mutmut, gates, defect locks | Accepted |
