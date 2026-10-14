#!/usr/bin/env python3
"""Validate and time-split conversational examples for reproducible SFT.

Input JSONL schema:
{"match_date":"2025-01-12","fixture_id":"...","messages":[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
Only completed, pre-kickoff-grounded examples should be included by the upstream exporter.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
from datetime import date
from typing import Any

ALLOWED_ROLES = {"system", "user", "assistant"}


def validate_record(record: Any, line_number: int) -> tuple[str, dict[str, Any]]:
    if not isinstance(record, dict):
        raise ValueError(f"line {line_number}: record must be an object")
    match_date = record.get("match_date")
    if not isinstance(match_date, str):
        raise ValueError(f"line {line_number}: match_date is required")
    try:
        parsed_date = date.fromisoformat(match_date[:10])
    except ValueError:
        raise ValueError(f"line {line_number}: invalid match_date {match_date!r}") from None
    messages = record.get("messages")
    if not isinstance(messages, list) or len(messages) < 2:
        raise ValueError(f"line {line_number}: at least two messages are required")
    if messages[-1].get("role") != "assistant":
        raise ValueError(f"line {line_number}: final message must be assistant")
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in ALLOWED_ROLES:
            raise ValueError(f"line {line_number}: invalid message role")
        if not isinstance(message.get("content"), str) or not message["content"].strip():
            raise ValueError(f"line {line_number}: message content must be non-empty text")
    return parsed_date.isoformat(), record


def prepare(input_path: pathlib.Path, output_dir: pathlib.Path,
            train_end: date, validation_end: date) -> dict[str, Any]:
    if validation_end <= train_end:
        raise ValueError("validation end must be later than train end")
    records: list[tuple[str, dict[str, Any]]] = []
    seen = set()
    with input_path.open(encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, start=1):
            if not raw.strip():
                continue
            try:
                record = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"line {line_number}: invalid JSON: {exc.msg}") from None
            day, record = validate_record(record, line_number)
            identity = record.get("fixture_id") or hashlib.sha256(
                json.dumps(record["messages"], sort_keys=True, ensure_ascii=False).encode()
            ).hexdigest()
            dedupe_key = (day, identity)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            records.append((day, record))
    records.sort(key=lambda item: (item[0], str(item[1].get("fixture_id", ""))))
    splits: dict[str, list[dict[str, Any]]] = {"train": [], "validation": [], "test": []}
    for day, record in records:
        parsed = date.fromisoformat(day)
        if parsed <= train_end:
            splits["train"].append(record)
        elif parsed <= validation_end:
            splits["validation"].append(record)
        else:
            splits["test"].append(record)
    if not splits["train"] or not splits["validation"] or not splits["test"]:
        raise ValueError("time split produced an empty train, validation or test set")
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, rows in splits.items():
        target = output_dir / f"{name}.jsonl"
        with target.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    manifest = {
        "input": str(input_path),
        "input_sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
        "train_end": train_end.isoformat(),
        "validation_end": validation_end.isoformat(),
        "counts": {name: len(rows) for name, rows in splits.items()},
        "deduplicated_records": len(records),
        "time_split": True,
        "created_at_utc": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=pathlib.Path)
    parser.add_argument("--output-dir", required=True, type=pathlib.Path)
    parser.add_argument("--train-end", required=True, type=date.fromisoformat)
    parser.add_argument("--validation-end", required=True, type=date.fromisoformat)
    args = parser.parse_args()
    try:
        manifest = prepare(args.input, args.output_dir, args.train_end, args.validation_end)
        print(json.dumps(manifest, indent=2))
        return 0
    except (OSError, ValueError) as exc:
        print(f"dataset preparation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
