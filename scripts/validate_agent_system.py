#!/usr/bin/env python3
"""Validate repository-local Claude Code agent, skill and command metadata."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
ERRORS = []

def check_markdown(path: Path, expected_name: str | None = None) -> None:
    text = path.read_text(encoding="utf-8")
    if not text.endswith("\n"):
        ERRORS.append(f"{path.relative_to(ROOT)}: missing final newline")
    if expected_name is None:
        return
    match = re.match(r"^---\n(?P<meta>.*?)\n---\n", text, re.DOTALL)
    if not match:
        ERRORS.append(f"{path.relative_to(ROOT)}: missing YAML frontmatter")
        return
    meta = match.group("meta")
    name = re.search(r"^name:\s*([a-z0-9-]+)\s*$", meta, re.MULTILINE)
    description = re.search(r"^description:\s*\S.*$", meta, re.MULTILINE)
    if not name or name.group(1) != expected_name:
        ERRORS.append(f"{path.relative_to(ROOT)}: name must be {expected_name}")
    if not description:
        ERRORS.append(f"{path.relative_to(ROOT)}: missing description")

agents = sorted((ROOT / ".claude/agents").glob("*.md"))
skills = sorted((ROOT / ".claude/skills").glob("*/SKILL.md"))
commands = sorted((ROOT / ".claude/commands").glob("*.md"))
if len(agents) < 9:
    ERRORS.append(f"expected at least 9 agents, found {len(agents)}")
if len(skills) < 3:
    ERRORS.append(f"expected at least 3 skills, found {len(skills)}")
if len(commands) < 3:
    ERRORS.append(f"expected at least 3 commands, found {len(commands)}")
for path in agents:
    check_markdown(path, path.stem)
for path in skills:
    check_markdown(path, path.parent.name)
for path in commands:
    check_markdown(path)
if not (ROOT / "CLAUDE.md").is_file() or not (ROOT / "AGENTS.md").is_file():
    ERRORS.append("expected existing CLAUDE.md and AGENTS.md project entrypoints")
if ERRORS:
    print("\n".join(f"ERROR: {item}" for item in ERRORS))
    sys.exit(1)
print(f"OK: {len(agents)} agents, {len(skills)} skills, {len(commands)} commands; metadata and final newlines valid.")
