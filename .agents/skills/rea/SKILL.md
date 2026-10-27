---
name: rea
description: Use REA for evidence-led reverse engineering when findings depend on shipped artifacts, packaged application behavior, decompilation, or runtime observation not established by source. Do not use it as a substitute for ordinary source-repository analysis.
---

# REA workflow for Sherlock Scholes

Use REA only when the question requires evidence from a built or packaged artifact, a live runtime, or behavior not established by the repository source. For normal React/TypeScript/Supabase source analysis, follow `AGENTS.md`, `CLAUDE.md`, `docs/MAP.md`, and the relevant engineering standards instead.

## Connect the local agent

This repository file does not install REA on the developer's computer and does not register an MCP server. To connect a supported local coding agent:

1. Check Node.js/npm are already available.
2. Review a read-only setup plan for the intended client. For Codex:
   ```bash
   npx -y rea-agents@latest setup --client codex --dry-run --json
   ```
   Replace `codex` with the documented client ID for the agent actually in use.
3. Review the paths, backup behavior, skill replacement, and exact changes in the plan.
4. After the operator approves the plan, apply only that client scope:
   ```bash
   npx -y rea-agents@latest setup --client codex --yes
   ```
5. Restart/reconnect the agent and verify REA tools are present in the active session. If tools are missing, diagnose the observed MCP launch/approval issue rather than repeating setup blindly.

Do not add secrets to commands, commit machine-specific MCP configuration, or install optional native analysis engines unless they are needed and separately approved. REA setup does not install Node.js or unrelated analysis prerequisites.

Official documentation:
- Setup: https://rea.tools/get-started/
- Installation guide: https://github.com/morluto/rea/blob/main/docs/installation.md
- Canonical skill and workflows: https://github.com/morluto/rea/blob/main/.agents/skills/reverse-engineer-anything/SKILL.md

## Evidence rules

- Distinguish observed facts, inferences, and unknowns.
- Keep artifact identity and limitations with conclusions.
- Static analysis does not prove runtime behavior.
- Do not repeat an identical failed analysis without a changed input or resolved blocker.
- Close REA-owned native sessions when the investigation is complete.
