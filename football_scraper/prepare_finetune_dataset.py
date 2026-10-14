#!/usr/bin/env python3
"""Validate and chronologically split curated football-analysis chats for fine-tuning."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def parse_time(value: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("event_time must be a non-empty ISO-8601 timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("invalid event_time: " + value) from exc
    if parsed.tzinfo is None:
        raise ValueError("event_time must include timezone")
    return parsed.astimezone(timezone.utc)


def canonical_messages(messages) -> str:
    return json.dumps(messages, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def validate_records(records):
    clean, seen = [], set()
    allowed = {"system", "user", "assistant"}
    for index, record in enumerate(records, 1):
        if not isinstance(record, dict):
            raise ValueError("line %d must be a JSON object" % index)
        event_id = str(record.get("event_id") or "").strip()
        if not event_id:
            raise ValueError("line %d is missing event_id" % index)
        event_time = parse_time(record.get("event_time"))
        source_ids = record.get("source_ids")
        if not isinstance(source_ids, list) or not source_ids or not all(
            isinstance(x, str) and x.strip() for x in source_ids
        ):
            raise ValueError("line %d requires non-empty source_ids for provenance" % index)
        messages = record.get("messages")
        if not isinstance(messages, list) or len(messages) < 2:
            raise ValueError("line %d requires at least two chat messages" % index)
        for message in messages:
            if not isinstance(message, dict) or message.get("role") not in allowed:
                raise ValueError("line %d contains an unsupported message role" % index)
            if not isinstance(message.get("content"), str) or not message["content"].strip():
                raise ValueError("line %d contains empty message content" % index)
        if messages[-1]["role"] != "assistant":
            raise ValueError("line %d must end with an assistant answer" % index)
        fingerprint = hashlib.sha256(canonical_messages(messages).encode("utf-8")).hexdigest()
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        clean.append({
            "event_id": event_id,
            "event_time": event_time.isoformat(),
            "source_ids": sorted(set(source_ids)),
            "messages": messages,
            "fingerprint": fingerprint,
        })
    if len({row["event_id"] for row in clean}) < 20:
        raise ValueError("at least 20 distinct event_id values are required for a time-based split")
    return clean


def split_records(records, train_fraction=0.70, validation_fraction=0.15):
    if not 0.5 <= train_fraction <= 0.85:
        raise ValueError("train_fraction must be in [0.50, 0.85]")
    if not 0.05 <= validation_fraction <= 0.25:
        raise ValueError("validation_fraction must be in [0.05, 0.25]")
    if train_fraction + validation_fraction >= 1:
        raise ValueError("test split must remain non-empty")
    event_times = {}
    for row in records:
        event_times[row["event_id"]] = min(
            event_times.get(row["event_id"], row["event_time"]), row["event_time"]
        )
    events = sorted(event_times, key=lambda key: (event_times[key], key))
    n = len(events)
    train_end = max(1, int(n * train_fraction))
    validation_end = max(train_end + 1, int(n * (train_fraction + validation_fraction)))
    validation_end = min(validation_end, n - 1)
    assignments = {}
    for i, event_id in enumerate(events):
        assignments[event_id] = "train" if i < train_end else (
            "validation" if i < validation_end else "test"
        )
    output = {"train": [], "validation": [], "test": []}
    for row in records:
        output[assignments[row["event_id"]]].append(row)
    if not output["train"] or not output["validation"] or not output["test"]:
        raise ValueError("chronological split produced an empty partition")
    event_sets = {name: {r["event_id"] for r in rows} for name, rows in output.items()}
    if event_sets["train"] & event_sets["validation"] or event_sets["train"] & event_sets["test"] or event_sets["validation"] & event_sets["test"]:
        raise AssertionError("event leakage across partitions")
    return output


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="curated JSONL with event_id/event_time/source_ids/messages")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--train-fraction", type=float, default=0.70)
    parser.add_argument("--validation-fraction", type=float, default=0.15)
    args = parser.parse_args()
    source = Path(args.input)
    outdir = Path(args.output_dir)
    records = []
    with source.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if line.strip():
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError as exc:
                    raise SystemExit("invalid JSON on line %d: %s" % (line_number, exc))
    clean = validate_records(records)
    splits = split_records(clean, args.train_fraction, args.validation_fraction)
    outdir.mkdir(parents=True, exist_ok=True)
    split_manifest = {}
    for name, rows in splits.items():
        path = outdir / (name + ".jsonl")
        with path.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        split_manifest[name] = {
            "examples": len(rows),
            "events": len({r["event_id"] for r in rows}),
            "sha256": sha256_file(path),
            "first_event_time": min(r["event_time"] for r in rows),
            "last_event_time": max(r["event_time"] for r in rows),
        }
    manifest = {
        "schema_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_file": source.name,
        "source_sha256": sha256_file(source),
        "deduplicated_examples": len(clean),
        "distinct_events": len({r["event_id"] for r in clean}),
        "splits": split_manifest,
        "policy": "chronological by event_time; all examples for one event stay in one partition",
    }
    (outdir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
