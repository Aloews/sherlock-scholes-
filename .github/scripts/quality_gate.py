#!/usr/bin/env python3
"""Run deterministic repository quality gates and retain concise failure evidence."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOG = Path("/tmp/sherlock-quality-gates.log")
COMMANDS = [
    ["npm", "ci"],
    ["npm", "run", "typecheck"],
    ["npm", "run", "build"],
    ["npm", "test"],
    ["node", "scripts/check-i18n.mjs"],
]

def run_gates():
    LOG.write_text("", encoding="utf-8")
    for command in COMMANDS:
        with LOG.open("a", encoding="utf-8") as output:
            output.write("\n\n$ " + " ".join(command) + "\n")
            output.flush()
            result = subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, text=True)
        if result.returncode:
            tail = LOG.read_text(encoding="utf-8", errors="replace")[-12000:]
            print(tail)
            print("::error::Quality gate failed: " + " ".join(command))
            return result.returncode
    print("All quality gates passed: npm ci, typecheck, build, tests, i18n.")
    return 0

if __name__ == "__main__":
    sys.exit(run_gates())
