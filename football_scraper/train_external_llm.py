#!/usr/bin/env python3
"""Reproducible LoRA/QLoRA fine-tuning for an externally published causal LM."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


def load_jsonl(path: Path):
    rows = []
    with path.open(encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row.get("messages"), list) or not row.get("event_id"):
                raise ValueError("%s:%d is not a prepared training row" % (path, number))
            rows.append(row)
    if not rows:
        raise ValueError("empty dataset: " + str(path))
    return rows


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def set_seed(seed: int):
    random.seed(seed)
    np.random.seed(seed)
    import torch
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", required=True)
    parser.add_argument("--base-model", required=True, help="Hugging Face model ID or local model directory")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--max-length", type=int, default=2048)
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=0.0002)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--target-modules", default="q_proj,k_proj,v_proj,o_proj,gate_proj,up_proj,down_proj")
    parser.add_argument("--seed", type=int, default=20261014)
    parser.add_argument("--qlora", action="store_true", help="4-bit base weights; requires bitsandbytes and supported CUDA")
    args = parser.parse_args()
    if args.max_length < 128 or args.epochs < 1 or args.batch_size < 1:
        raise SystemExit("max-length >= 128, epochs >= 1 and batch-size >= 1 are required")
    dataset_dir, output_dir = Path(args.dataset_dir), Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    train_rows = load_jsonl(dataset_dir / "train.jsonl")
    validation_rows = load_jsonl(dataset_dir / "validation.jsonl")
    test_rows = load_jsonl(dataset_dir / "test.jsonl")

    train_events = {r["event_id"] for r in train_rows}
    validation_events = {r["event_id"] for r in validation_rows}
    test_events = {r["event_id"] for r in test_rows}
    if train_events & validation_events or train_events & test_events or validation_events & test_events:
        raise SystemExit("event leakage detected across dataset partitions")

    try:
        import torch
        from torch.utils.data import DataLoader, Dataset
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from peft import LoraConfig, TaskType, get_peft_model
    except ImportError as exc:
        raise SystemExit("Install football_scraper/requirements-finetune.txt first: %s" % exc)

    set_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, use_fast=True)
    if not getattr(tokenizer, "chat_template", None):
        raise SystemExit("base model tokenizer has no chat_template; select an instruct/chat checkpoint")
    if tokenizer.pad_token_id is None:
        if tokenizer.eos_token is None:
            raise SystemExit("tokenizer must define eos_token or pad_token")
        tokenizer.pad_token = tokenizer.eos_token

    model_kwargs = {}
    if args.qlora:
        if not torch.cuda.is_available():
            raise SystemExit("QLoRA requires CUDA in this implementation")
        try:
            from transformers import BitsAndBytesConfig
            from peft import prepare_model_for_kbit_training
        except ImportError as exc:
            raise SystemExit("QLoRA needs bitsandbytes and a compatible transformers build: %s" % exc)
        compute_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        model_kwargs = {
            "quantization_config": BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=compute_dtype,
            ),
            "device_map": "auto",
        }
    model = AutoModelForCausalLM.from_pretrained(args.base_model, **model_kwargs)
    if args.qlora:
        model = prepare_model_for_kbit_training(model)
    else:
        model.to(device)
    model.config.use_cache = False
    model = get_peft_model(model, LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        target_modules=[x.strip() for x in args.target_modules.split(",") if x.strip()],
        bias="none",
    ))
    model.print_trainable_parameters()

    class ChatDataset(Dataset):
        def __init__(self, rows):
            self.items = []
            for row in rows:
                text = tokenizer.apply_chat_template(
                    row["messages"], tokenize=False, add_generation_prompt=False
                )
                encoded = tokenizer(text, truncation=True, max_length=args.max_length)
                if len(encoded["input_ids"]) < 2:
                    continue
                self.items.append({
                    "input_ids": encoded["input_ids"],
                    "attention_mask": encoded["attention_mask"],
                })
            if not self.items:
                raise ValueError("no usable tokenized examples")

        def __len__(self):
            return len(self.items)

        def __getitem__(self, index):
            return self.items[index]

    def collate(rows):
        batch = tokenizer.pad(rows, padding=True, return_tensors="pt")
        labels = batch["input_ids"].clone()
        labels[batch["attention_mask"] == 0] = -100
        batch["labels"] = labels
        return batch

    train_data = ChatDataset(train_rows)
    validation_data = ChatDataset(validation_rows)
    test_data = ChatDataset(test_rows)
    train_loader = DataLoader(
        train_data, batch_size=args.batch_size, shuffle=True, collate_fn=collate,
        generator=torch.Generator().manual_seed(args.seed)
    )
    validation_loader = DataLoader(validation_data, batch_size=args.batch_size,
                                   shuffle=False, collate_fn=collate)
    test_loader = DataLoader(test_data, batch_size=args.batch_size,
                             shuffle=False, collate_fn=collate)
    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=args.learning_rate, weight_decay=0.01
    )
    scaler = torch.amp.GradScaler("cuda", enabled=(device.type == "cuda" and not args.qlora))
    best_val = math.inf
    best_epoch = 0
    history = []

    def evaluate(loader):
        model.eval()
        losses = []
        with torch.no_grad():
            for batch in loader:
                batch = {k: v.to(model.device) for k, v in batch.items()}
                result = model(**batch)
                if torch.isfinite(result.loss):
                    losses.append(float(result.loss.detach().cpu()))
        if not losses:
            raise RuntimeError("evaluation produced no finite losses")
        return sum(losses) / len(losses)

    for epoch in range(1, args.epochs + 1):
        model.train()
        losses = []
        for batch in train_loader:
            batch = {k: v.to(model.device) for k, v in batch.items()}
            optimizer.zero_grad(set_to_none=True)
            result = model(**batch)
            if not torch.isfinite(result.loss):
                raise RuntimeError("non-finite training loss; aborting run")
            scaler.scale(result.loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(
                [p for p in model.parameters() if p.requires_grad], max_norm=1.0
            )
            scaler.step(optimizer)
            scaler.update()
            losses.append(float(result.loss.detach().cpu()))
        val_loss = evaluate(validation_loader)
        epoch_metrics = {
            "epoch": epoch,
            "train_loss": sum(losses) / max(1, len(losses)),
            "validation_loss": val_loss,
        }
        history.append(epoch_metrics)
        print(json.dumps(epoch_metrics), flush=True)
        if val_loss < best_val:
            best_val, best_epoch = val_loss, epoch
            model.save_pretrained(output_dir / "adapter")
            tokenizer.save_pretrained(output_dir / "adapter")

    # Evaluate the selected adapter only once against the untouched temporal test set.
    final_test_loss = evaluate(test_loader)
    metrics = {
        "status": "evaluated_not_automatically_promoted",
        "base_model": args.base_model,
        "method": "qlora" if args.qlora else "lora",
        "seed": args.seed,
        "max_length": args.max_length,
        "epochs_requested": args.epochs,
        "best_epoch": best_epoch,
        "best_validation_loss": best_val,
        "test_loss": final_test_loss,
        "test_perplexity": math.exp(min(20.0, final_test_loss)),
        "examples": {
            "train": len(train_rows), "validation": len(validation_rows), "test": len(test_rows)
        },
        "event_counts": {
            "train": len(train_events), "validation": len(validation_events), "test": len(test_events)
        },
        "dataset_manifest_sha256": sha256_file(dataset_dir / "manifest.json"),
        "train_history": history,
        "git_sha": os.environ.get("GITHUB_SHA"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "note": "This adapter is an experiment; it is not deployed and does not replace the numeric match-outcome model.",
    }
    (output_dir / "run-manifest.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
