#!/usr/bin/env python3
"""Use Fable 5.2 only after deterministic CI gates fail; re-run all gates after repair."""
import json
import os
import sys
from pathlib import Path

import agent_network
import local_model_agent as base
from quality_gate import run_gates, LOG

def main():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    comment = event.get("comment", {}).get("body", "").strip()
    task = comment[4:].strip() if comment.startswith("/ai ") else comment
    if not LOG.is_file():
        print("::error::Quality-gate log is missing; Fable cannot diagnose an empty report.")
        return 1
    logs = LOG.read_text(encoding="utf-8", errors="replace")[-12000:]
    diff = agent_network.current_diff()
    context = agent_network.task_context(task)
    try:
        result = agent_network.fable_role(
            task,
            "CI failure log:\n" + logs + "\nCurrent diff:\n" + diff + "\nRelevant source:\n" + context,
            "Deterministic CI gates failed. Diagnose the exact failing command and make the smallest verified correction.",
            max_tokens=2600,
        )
        if result.get("decision") != "fix":
            raise agent_network.EscalationError("Fable chose not to patch: " + str(result.get("diagnosis", "no diagnosis")))
        changed = agent_network.apply_role_changes(result)
        print("Fable 5.2 proposed changes: " + ", ".join(changed))
        gate_result = run_gates()
        if gate_result:
            return gate_result
        review = agent_network.ollama_role(
            "post-Fable CI repair reviewer",
            "Review the actual post-Fable diff against the original task. Return JSON keys: decision (approve|reject), "
            "blocking_findings array. Reject unrelated changes and incomplete fixes. CI has actually been rerun; "
            "do not infer anything beyond the supplied task and diff.",
            "Task:\n" + task + "\nFable repair diff:\n" + agent_network.current_diff(), 450,
        )
        if review.get("decision") != "approve" or review.get("blocking_findings"):
            raise agent_network.EscalationError("Qwen post-Fable review blocked the CI repair: " + json.dumps(review, ensure_ascii=False))
        print("Qwen post-Fable review approved the CI repair.")
        return 0
    except (ValueError, OSError, agent_network.EscalationError) as exc:
        print("::error::Fable CI escalation failed: " + str(exc))
        return 1

if __name__ == "__main__":
    sys.exit(main())
