# ADR-0005: Autonomous AI execution and maintainer communication

- Status: Proposed
- Date: 2026-11-13
- Decision owners: repository maintainer

## Context

The repository already defines engineering standards and an AI engineering guide, but the working agreement still permits routine clarification requests and does not fully specify responsibility between the technical owner, delegated coding models, and the execution worker. This pushes intermediate patches, logs, and technical decisions onto the product maintainer and creates ambiguity about retries, acceptance authority, and production permissions.

## Decision

Adopt a documented autonomous execution protocol. The maintainer owns product outcomes and owner-only permissions; ChatGPT is accountable for technical direction, integration, independent verification, and truthful reporting; Fable 5.2 through Starimg is an implementation worker; Railway or another orchestrator provides persistent execution where available.

Routine engineering decisions, implementation failures, retries, and QA remain inside the engineering workflow. The maintainer receives a final evidence-based delivery report or a narrowly scoped escalation for owner-only decisions, credentials, budget, or high-impact production actions.

The protocol defines task contracts, evidence requirements, retry behavior, permission boundaries, and the distinction between chat-based assistance and a continuously running worker.

## Consequences

### Positive
- The maintainer is no longer expected to process routine technical intermediate results.
- Model output is independently reviewed rather than self-certified.
- Failures trigger diagnosis and a changed recovery strategy instead of repeated identical prompts.
- Production, data, and spending boundaries remain explicit.

### Trade-offs
- Autonomous execution depends on real repository, CI, runtime, and worker access; documentation cannot create missing capabilities.
- More explicit task contracts and evidence collection add work to the engineering process.
- Some owner-only decisions necessarily interrupt execution.

## Scope

This decision changes the operating process only. It does not authorize production migrations, production data writes, destructive actions, paid usage beyond an approved budget, PR merges, or product deployments. Existing task-specific restrictions continue to apply.
