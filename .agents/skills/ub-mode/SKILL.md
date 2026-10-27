---
name: ub-mode
description: Follow disciplined software engineering principles when writing or changing code. Every change follows First Make it Work, then Then Make it Right, then Follow Practice. Use when the user runs /ub-mode or asks for the reduced principles.
---

# ub-mode

Every time you are asked to make a change follow:
- First Make it Work.
- Then Make it Right.
- Follow Practice.

## First Make it Work

### Laziness Protocol
- One decision lives in one place.
- Ship the smallest edit that solves the problem.

### Foundational Thinking
- Get the data shape right before you write the logic.
- Do first whatever helps every later phase.
- If a concurrent writer would matter, do not share state.

### TDD
- Write the failing test before you change the code.
- See it fail for the reason you expect.
- Make the smallest change that makes it pass.
- If an honest test is impractical, do not write a bad one.

### Redesign From First Principles
- Do not bolt a new requirement onto the old design.
- Ask what you would have built if it had been there from the start, think that through, and deliver it in pieces.

### Attack the Premise
- When two fixes that share one premise fail the same gate, write that premise in one sentence and count which actors hold the imbalance.
- Remove the assignment.
- Do not start another fix until you have done that.

### Subtract Before You Add
- Take complexity out before you add anything.

### Outcome-Oriented Execution
- Aim at the end state you can check.
- A break in the middle is allowed when you planned it and can undo it.

### Build the Lever
- If the work is not obvious at a glance, build the tool that does it.
- Do one unit by hand, then make the tool match that unit.

### Architecture
- Model the domain so illegal states are difficult or impossible to represent.
- Maintain a glossary of domain terms.
- If the code is already clear and local, leave it.
- Validate data at system boundaries; keep business logic in pure functions.
- Parse external data once at ingress and do not silence the compiler.
- Make operations idempotent: retries and partial restarts should converge to the same state.
- Separate mutable state unless writers truly need to share it; then enforce a single writer.

## Then Make it Right

### Fix Root Causes
- Reproduce the defect.
- Fix the cause, not just the symptom.
- A guard that only hides the crash is not a fix.

### Sequence work into verifiable units
- Finish one small unit and check it before starting the next.

### Test Behavior, Not Implementation
- Test through the same interface a user or caller uses and assert the observable result.
- Reject tests that would still pass if the implementation returned nothing.

### Quality tools
- Use Crapper to keep each function's CRAP score below 10.
- Use Dryer to eliminate structural duplication with similarity at or above 0.8.
- Use Mutator to cover uncovered behavior, kill surviving mutants, and remove dead code.
- Do not claim these tools ran unless their output was observed. If unavailable in this repository or environment, report that limitation rather than weakening project gates.

### Refactoring
- Pin current behavior with tests.
- Change structure.
- Prove behavior did not change.

## Practice

### Keep a Log
- Keep a concise action log with the reason for each meaningful action.
- Report the log when completing the task.

### Guard the Context Window
- Keep the main thread small; summarize work and delegate independent scopes only when available.

### Worktree Cleanup
- Identify what is safe to remove and confirm it is unused.
- Never discard uncommitted work without a decision.

### Commit and Push
- Commit in small ordered changes.
- Each commit should state why, what changed, and how it was verified.
- Do not push directly to the protected main branch; use a focused branch and pull request, following this repository's rules.
