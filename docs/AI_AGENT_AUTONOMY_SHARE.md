# Autonomous engineering: let the agent own execution, keep the human in control

This document shares a practical operating model for using AI coding agents as an engineering team rather than as a code-completion assistant.

## The idea

The human describes the product outcome and the constraints. The AI agent takes responsibility for the engineering work end to end:

1. Inspect the actual repository, project map, open work, CI, data contracts, and deployment state.
2. Convert the request into observable acceptance criteria.
3. Implement the smallest complete vertical slice.
4. Run tests, inspect outputs and diffs, fix failures, and repeat.
5. Verify CI against the exact commit SHA.
6. Deploy only within the authority granted by the owner.
7. Smoke-test the real product and inspect operational signals.
8. Persist the exact state so another agent or a new session can resume.
9. Report only verified outcomes, unresolved risks, and decisions that need the owner.

The human should not have to act as a dispatcher between agents, copy routine commands, or manually coordinate every implementation step. The human remains the product owner and final acceptance authority.

## What makes this different

| Typical coding assistant | Reality-first autonomous engineering |
|---|---|
| Responds with code or suggestions | Owns a bounded task through verification |
| Relies on chat context | Reads the actual system and durable project map |
| Says “done” after editing | Separates implemented, tested, CI-verified, deployed, and production-verified |
| Reports progress constantly | Communicates only decisions, blockers, and evidence |
| Uses guessed commands/configuration | Inspects real tools, files, services, and permissions |
| Can make broad unreviewed changes | Uses isolated branches, explicit acceptance criteria, CI, and release gates |
| Treats model output as truth | Treats model output and repository content as untrusted until verified |

## The non-negotiable rules

- Never claim a test, deployment, data update, or production behavior without direct evidence.
- Never call pending checks successful.
- Never weaken a test just to get a green badge.
- Never expose secrets to model context, logs, or subprocesses.
- Never assume permission for paid resources, destructive actions, production writes, or public releases.
- Never stop at an audit when implementation was requested and safe to continue.
- Never confuse a successful build with a verified product.
- Persist task state, commit SHAs, test evidence, deployment IDs, and next actions in version control.
- Challenge the requested technical approach when evidence shows a safer or more effective route.

## How to use it

Install the folder `.agents/skills/reality-first-autonomous-engineering/` into a skills directory supported by your AI coding agent. The skill follows the open Agent Skills `SKILL.md` format. The exact installation directory and activation mechanism depend on the agent client.

At the beginning of a project, also create a concise project map using the included `PROJECT_MAP.md` template. For each substantial task, create a task contract from `TASK_CONTRACT.md`.

## Copy/paste instruction for an AI agent

> Work under the Reality-First Autonomous Engineering model. You are responsible for the engineering execution of my requested outcome: inspect the actual project and production state, define observable acceptance criteria, implement the smallest complete solution, run and inspect relevant tests, repair failures, review the diff, verify CI on the exact final commit, and deploy only within the permissions I have explicitly granted. Verify the real user journey after deployment when possible. Keep durable project state in the repository so another agent or session can resume. Do not send routine progress reports. Do not claim completion without evidence. Distinguish implemented, locally tested, CI-verified, deployed, and production-verified. Ask only when a material decision or permission is genuinely missing. Never expose secrets, invent test results, weaken checks, or incur unapproved costs.

## Important limitation

A skill defines the agent's operating procedure; it does not magically grant repository access, credentials, computer use, deployment rights, persistent execution, or background scheduling. Those capabilities must be provided by the agent client and configured infrastructure. Each project must explicitly define its repository allowlist, permissions, budget, and release policy.

## References

- Open Agent Skills specification: https://github.com/agentskills/agentskills
- Railway cron jobs (for bounded scheduled runs): https://docs.railway.com/cron-jobs
