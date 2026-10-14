# Reproducible football LLM fine-tuning

## Scope

This pipeline fine-tunes an open-weight instruction model with a LoRA adapter. It does not mutate
a hosted provider's model weights and does not replace the base checkpoint. It is separate from the
numerical match-outcome model and from the application runtime.

## Dataset contract

Each JSONL line must contain:
- `match_date` in ISO format
- `fixture_id`
- `messages`: at least one user and one assistant message, with the assistant as the final turn

Build examples only from information available before kickoff. Keep the final result as evaluation
ground truth, never as a feature visible to the model. Split chronologically to prevent future-match
leakage. Deduplication and input SHA-256 are recorded in a manifest.

```bash
python ml/finetune/prepare_dataset.py \
  --input ml/data/forecast_training.jsonl \
  --output-dir artifacts/finetune-dataset \
  --train-end 2024-12-31 \
  --validation-end 2025-12-31
```

The train, validation and test sets must all be non-empty. The test set is evaluated once after training
and must not be used for checkpoint selection.

## GPU training

Install only in an isolated GPU environment:

```bash
python -m venv .venv-finetune
. .venv-finetune/bin/activate
pip install -r ml/finetune/requirements.txt
python ml/finetune/train_lora.py \
  --dataset-dir artifacts/finetune-dataset \
  --output-dir artifacts/football-llm-lora \
  --model-id Qwen/Qwen2.5-3B-Instruct \
  --seed 1729
```

The run saves an adapter, tokenizer, checkpoint files, dataset hashes, model identifier, git SHA,
seed, hyperparameters and validation/test loss in `training_manifest.json`. Training requires a CUDA
GPU; the app and normal CI do not install these dependencies.

## Promotion gate

Do not promote an adapter because training loss fell. Require:
- temporal holdout metrics versus the base model,
- no leakage from post-kickoff odds/results,
- a human-reviewed sample for factuality and schema compliance,
- regression tests for Russian/English prompts and unsupported markets,
- versioned artifacts and a rollback path.

Hosted fine-tuning APIs are provider-specific and depend on account eligibility; this repo pipeline is
the reproducible self-hosted adapter path. Forecast probabilities remain the responsibility of the
numerical model and must be evaluated separately with Brier score, log loss and calibration.
