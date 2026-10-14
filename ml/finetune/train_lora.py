#!/usr/bin/env python3
"""Train a versioned LoRA adapter on an already time-split JSONL dataset.

This job updates adapter weights for an open-weight model; it does not mutate the
provider's hosted model or overwrite the base checkpoint.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys
from datetime import datetime, timezone

import torch
from datasets import Dataset
from peft import LoraConfig, get_peft_model
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    DataCollatorForLanguageModeling,
    Trainer,
    TrainingArguments,
)


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_records(path: pathlib.Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row.get("messages"), list) or len(row["messages"]) < 2:
                raise ValueError(f"{path}:{number}: invalid messages")
            rows.append(row)
    if not rows:
        raise ValueError(f"{path} has no examples")
    return rows


def git_sha() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return os.environ.get("GITHUB_SHA")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=pathlib.Path, required=True)
    parser.add_argument("--output-dir", type=pathlib.Path, required=True)
    parser.add_argument("--model-id", default=os.environ.get("MODEL_ID", "Qwen/Qwen2.5-3B-Instruct"))
    parser.add_argument("--seed", type=int, default=1729)
    parser.add_argument("--epochs", type=float, default=3.0)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--max-length", type=int, default=2048)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation", type=int, default=8)
    args = parser.parse_args()

    if not torch.cuda.is_available():
        print("Training requires a CUDA GPU runner; validation remains available on CPU.", file=sys.stderr)
        return 2
    if args.epochs <= 0 or args.learning_rate <= 0 or args.max_length < 128:
        parser.error("epochs/lr must be positive and max-length must be >= 128")

    train_path = args.dataset_dir / "train.jsonl"
    validation_path = args.dataset_dir / "validation.jsonl"
    test_path = args.dataset_dir / "test.jsonl"
    manifest_path = args.dataset_dir / "manifest.json"
    for path in (train_path, validation_path, test_path, manifest_path):
        if not path.is_file():
            raise FileNotFoundError(f"required dataset artifact missing: {path}")

    torch.manual_seed(args.seed)
    torch.cuda.manual_seed_all(args.seed)
    tokenizer = AutoTokenizer.from_pretrained(args.model_id, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        args.model_id, torch_dtype=torch.float16, device_map="auto"
    )
    model.config.use_cache = False
    model = get_peft_model(model, LoraConfig(
        r=16, lora_alpha=32, lora_dropout=0.05, bias="none",
        task_type="CAUSAL_LM", target_modules="all-linear",
    ))

    def tokenized(path: pathlib.Path) -> Dataset:
        rows = load_records(path)
        def encode(record):
            ids = tokenizer.apply_chat_template(
                record["messages"], tokenize=True, truncation=True,
                max_length=args.max_length, add_generation_prompt=False,
            )
            return {"input_ids": ids, "attention_mask": [1] * len(ids), "labels": list(ids)}
        dataset = Dataset.from_list(rows).map(encode, remove_columns=list(rows[0].keys()))
        return dataset

    train_dataset = tokenized(train_path)
    validation_dataset = tokenized(validation_path)
    test_dataset = tokenized(test_path)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    training_args = TrainingArguments(
        output_dir=str(args.output_dir / "checkpoints"),
        num_train_epochs=args.epochs,
        learning_rate=args.learning_rate,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation,
        evaluation_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        seed=args.seed,
        data_seed=args.seed,
        fp16=True,
        logging_steps=10,
        report_to=[],
        save_total_limit=2,
    )
    trainer = Trainer(
        model=model, args=training_args, train_dataset=train_dataset,
        eval_dataset=validation_dataset,
        data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
    )
    trainer.train()
    validation_metrics = trainer.evaluate(validation_dataset, metric_key_prefix="validation")
    test_metrics = trainer.evaluate(test_dataset, metric_key_prefix="test")
    model.save_pretrained(args.output_dir / "adapter")
    tokenizer.save_pretrained(args.output_dir / "adapter")
    manifest = {
        "model_id": args.model_id,
        "training_mode": "LoRA adapter; base model unchanged",
        "git_sha": git_sha(),
        "seed": args.seed,
        "epochs": args.epochs,
        "learning_rate": args.learning_rate,
        "max_length": args.max_length,
        "train_sha256": sha256(train_path),
        "validation_sha256": sha256(validation_path),
        "test_sha256": sha256(test_path),
        "source_manifest": json.loads(manifest_path.read_text(encoding="utf-8")),
        "validation_metrics": validation_metrics,
        "test_metrics": test_metrics,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    (args.output_dir / "training_manifest.json").write_text(
        json.dumps(manifest, indent=2, default=str) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
