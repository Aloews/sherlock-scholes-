# Multi-Agent Product Delivery System

**Status:** architecture and operating contract; runtime rollout is separate and must be verified before calling the team operational.  
**Scope:** reusable across the explicitly configured product repositories. This is a process and role system, not a promise that every role is already running as a separate process.

## Mission

Deliver a working product outcome at any complexity by coordinating specialist agents around one durable task contract, one authoritative project state, isolated implementation work, independent review, and evidence-based release gates.

The human product owner supplies outcomes, business constraints, risk tolerance, and final acceptance. Agents own the engineering cycle within granted permissions. Routine progress narration is suppressed; only decisions, material blockers, and evidence-backed completion are surfaced.

## Team topology

The coordinator creates only the roles required by the task. It does not create agents merely to increase their count.

| Role | Responsibility | Writes product code? | Independent gate |
|---|---|---:|---|
| Product/Delivery Lead | Converts the request into user outcomes, scope, acceptance criteria, dependencies, and a task DAG; owns durable state and task locks | No | Scope and acceptance contract |
| Research/Domain Analyst | Verifies product, domain, data-source, legal, and provider assumptions; records provenance and unknowns | No | Evidence quality |
| Solution Architect | Defines boundaries, contracts, data model, threat model, migration and rollback plan | No | Architecture and risk review |
| Implementation Lead | Owns integration and the single coherent vertical slice; delegates bounded work packages | Yes, in its own branch/worktree | Integration build |
| Specialist Implementers | Frontend, backend, data/ML, infrastructure, content, or platform tasks selected by the architecture | Yes, isolated worktree/branch only | Package-level tests |
| Independent Code Reviewer | Reviews the exact diff and immutable commit; checks correctness, maintainability, regressions, and scope | No | Review verdict: approve / changes requested / reject |
| QA & Test Engineer | Builds risk-based test plan; runs unit, integration, E2E, migration, accessibility, performance, and regression checks as applicable | No by default; files defects as separate tasks | Exact-SHA test evidence |
| Security & Reliability Reviewer | Checks authn/authz, tenant isolation, secrets, injection, supply chain, privacy, failure modes, observability, backup and recovery | No | Security/reliability verdict |
| Release/SRE Agent | Verifies CI, deployment source/commit, rollout, health, telemetry, smoke tests and rollback readiness | Only release/config changes explicitly in scope | Release readiness |
| Product Acceptance Agent | Replays the acceptance criteria from the user's perspective and checks that the delivered behavior solves the stated problem | No | Product acceptance evidence |

The Product/Delivery Lead is accountable for orchestration, but cannot approve its own implementation. The Code Reviewer, QA, and Security reviewers must be independent of the implementation context. The same model provider may be used, but reviewer prompts must be adversarial and reviewer output must be grounded in actual artifacts and test results.

## Scaling by complexity

| Work class | Minimum active roles | Additional roles |
|---|---|---|
| Small, isolated change | Delivery Lead, Implementer, Independent Reviewer/QA | Specialist only if needed |
| Feature / vertical slice | Delivery Lead, Architect, Implementer, Reviewer, QA | UX, Data, Security |
| Multi-service product | Delivery Lead, Research, Architect, 1+ isolated Implementers, Reviewer, QA, Security, Release | Domain and platform specialists |
| High-risk / regulated / data migration | All applicable roles with explicit independent approvals | Privacy, compliance, SRE, migration verifier, rollback operator |

Parallelism is allowed only for non-overlapping work packages with explicit file/API/schema ownership. Tasks that touch the same files, database objects, deployment, or shared state are serialized. More agents do not imply more parallel writers.

## Durable task contract

Every task is persisted before work starts and includes:

- Stable task ID, authenticated requester, source request, product/repository, environment, and permissions.
- User outcome, measurable acceptance criteria, in-scope and out-of-scope behavior.
- Current default branch and immutable base SHA.
- Dependency DAG, role owner, explicit write-set, and conflict/lease key.
- Baseline evidence, relevant architecture, data contracts, tests, CI and deployment state.
- Risk classification, data/security impact, rollback/recovery, and approval requirements.
- Model/provider/model ID, bounded attempts, token/time/compute budgets, and usage where available.
- Per-role handoff artifacts, review verdicts, exact-SHA check runs, deployment ID, smoke-test evidence, and remaining unknowns.

Recommended lifecycle:

`received → scoped → inspected → designed → implementing → locally_verified → independent_review → qa_verified → security_verified → ci_verified → release_approved → deployed → production_verified → completed`

Any gate may transition to `changes_requested`, `blocked`, or `rejected`. A new commit invalidates every review and check tied to an earlier SHA. No status may be skipped to make a dashboard green.

## Handoff contracts

Each role returns a structured artifact, not a conversational status:

1. **Delivery brief:** outcome, acceptance criteria, scope, risk, dependencies, owners.
2. **Research dossier:** source URLs/revisions, observed facts, confidence, disagreements, unknowns.
3. **Architecture decision:** components, contracts, data ownership, threat model, migration/rollback.
4. **Implementation packet:** branch, base/head SHA, write-set, complete diff, tests actually run, known gaps.
5. **Review report:** exact SHA, file/line findings, severity, reproducible evidence, verdict.
6. **QA report:** exact SHA, environment, commands, test IDs, pass/fail/blocked, logs/artifacts, coverage gaps.
7. **Security report:** threat/control matrix, findings, exploitability, remediation and residual risk.
8. **Release record:** approved revision, workflow IDs, deployment ID, health checks, smoke tests, rollback state.
9. **Acceptance record:** criterion-by-criterion outcome with direct evidence.

A role may not claim work another role performed. A green workflow is evidence only for the checks it actually ran.

## Implementation and review protocol

1. Inspect the actual repository, project map, open PRs, code, schema/migrations, CI, runtime and production evidence relevant to the task.
2. Write the task contract and acceptance tests before implementation.
3. Create one isolated branch/worktree per implementation owner; bind it to the exact base SHA.
4. Divide work by bounded package and non-overlapping write-set. Use leases/idempotency keys to prevent duplicate work.
5. Implement the smallest complete vertical slice; never substitute mocks/placeholders for required real integrations.
6. Run targeted tests, formatting, lint, type checks, builds, integration tests and migrations checks. Inspect output and full diff.
7. Freeze the candidate commit. Independent reviewer, QA and security reviewer inspect that exact SHA without changing it.
8. Findings become explicit correction tasks. Implementation owner fixes them; all affected checks and reviews rerun on the new SHA.
9. Require all mandatory CI checks to pass on the exact final head SHA. Pending, skipped, stale, or infrastructure-failed checks are not green.
10. Release only within explicit authorization and repository policy. Verify the intended commit is deployed, exercise critical real user journeys, inspect logs/metrics/data impact, and verify rollback readiness.
11. Update the canonical project map and task ledger with evidence. Report only final outcome or a material blocker.

## Defect severity and gate policy

- **P0 / Critical:** data loss, cross-tenant access, credential exposure, payment/security compromise, production outage. Stop release; incident handling and explicit approval required.
- **P1 / High:** core acceptance criterion broken, authorization bypass, incorrect financial/critical data, migration cannot safely roll back. Block release.
- **P2 / Medium:** significant degraded path or regression with workaround. Block release unless an explicit risk acceptance is recorded.
- **P3 / Low:** non-critical polish or minor defect. May be deferred only with an owner and tracked issue.

No reviewer can waive a failed security control or required CI gate. The product owner may accept product trade-offs, but cannot convert an unverified technical claim into evidence.

## Retry, failure and cost controls

- Discover model IDs from the configured provider catalog; never guess them.
- Keep Starimg as the configured model gateway where the project requires it. A provider/model change is a configuration decision, not an automatic fallback.
- Set per-task limits for model calls, tokens, elapsed time, compute and correction attempts.
- Default to at most two corrective attempts per distinct deterministic failure. A retry requires new evidence or a materially changed approach.
- Stop on repeated quota/auth failures, malformed output loops, stale-context patch failures, or exhausted budget. Preserve diagnostics without secrets.
- Never launch duplicate agents to retry the same task while a lease is active.
- Use smaller models for bounded classification and stronger models for architecture/complex implementation/review only when catalog and cost evidence support the choice.

## Permission matrix

| Operation | Default authority |
|---|---|
| Read repository, CI, logs, docs, and non-sensitive operational state | Allowed within connected access |
| Create isolated branch, tests, commits and draft PR | Allowed within repository policy |
| Modify application code and tests in the task write-set | Allowed |
| Review PR and request changes | Allowed |
| Read production data/schema | Read-only, least privilege, when needed |
| Apply production migration or write/delete production data | Explicit approval required |
| Merge PR, publish package, public release, production deploy | Explicit approval unless a written project release policy already grants it |
| Change secrets, billing, DNS, access controls, or infrastructure with irreversible impact | Explicit approval required |

## Definition of done

A product delivery is complete only when:

- The user-visible outcome and all required acceptance criteria are satisfied.
- The implementation is integrated and the complete diff reviewed.
- Independent QA and applicable security/reliability reviews pass.
- All required checks pass on the exact final SHA.
- The authorized release is deployed from that SHA, if release was in scope.
- Critical user journeys and external integrations work in the real target environment.
- Data integrity, operational telemetry, and rollback/recovery are verified.
- Documentation and project state match the actual shipped product.
- Every remaining limitation is explicit and does not violate a required criterion.

Otherwise report the precise state: implemented, CI-verified, deployed, production-verified, blocked, or incomplete. Never collapse these states into “done”.
