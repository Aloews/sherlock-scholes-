# Reproducible language-model fine-tuning

## Scope

The repository's current model named llm is a ridge-style numeric classifier, not a hosted language model. This pipeline adds a separate LoRA/QLoRA experiment for a chat/instruct model. It does not replace the numeric match-outcome model, publish weights, or change production routing.

A model should learn analysis and structured response behavior from curated, evidence-linked football examples. Raw match results alone are not suitable chat fine-tuning examples, and a lower test perplexity score is not proof of better betting performance.

## Data contract

Input is JSONL, one object per example:

    {
      "event_id": "provider-event-or-match-id",
      "event_time": "2026-08-14T18:00:00Z",
      "source_ids": ["fixture:provider-id", "odds-snapshot:hash"],
      "messages": [
        {"role": "system", "content": "Use only supplied evidence; distinguish facts from estimates."},
        {"role": "user", "content": "Analyse this match from the supplied pre-match data."},
        {"role": "assistant", "content": "A source-grounded analysis with uncertainty and missing-data flags."}
      ]
    }

Each example must have an event time with timezone, a stable event ID, non-empty source IDs and a final assistant message. Curated target answers must not contain post-match information if the prompt represents a pre-match decision. Remove secrets and personal data before creating the input file.

## Prepare and split

    python football_scraper/prepare_finetune_dataset.py \
      --input data/curated_football_chats.jsonl \
      --output-dir artifacts/finetune/dataset

The builder deduplicates exact chat payloads, hashes the source and each split, and splits chronologically by event ID. All examples from the same event remain in one partition. Default split is 70% train, 15% validation and 15% test. At least 20 distinct events are required for an initial split; a real evaluation should use substantially more.

## Train an external open-weight base model

    python -m pip install -r football_scraper/requirements-finetune.txt

    python football_scraper/train_external_llm.py \
      --dataset-dir artifacts/finetune/dataset \
      --base-model <approved-instruct-model-id> \
      --output-dir artifacts/finetune/run-001 \
      --epochs 2 --max-length 2048

For a compatible CUDA environment, install the optional quantization dependency and pass --qlora:

    python -m pip install -r football_scraper/requirements-qlora.txt

The trainer saves the best-validation LoRA adapter and a run manifest with dataset hash, split counts, seed, hyperparameters, per-epoch loss, held-out test loss and test perplexity. It never uploads weights or promotes a model automatically.

## Promotion gates

- Keep the test partition untouched until model selection is complete.
- Compare with the base model on the same test examples.
- Review factual grounding, unsupported claims, output schema validity and language consistency.
- For match outcomes, separately evaluate the numeric model with time-based walk-forward tests, Brier score, log loss, calibration and market-relative performance. Chat fine-tuning is not a substitute for this.
- Store the base model, adapter, dataset manifest and metrics in versioned artifact storage. Record run metadata in public.model_training_runs only after the migration has been reviewed and applied.
- A hosted provider's fine-tuning API requires a separate provider adapter and explicit credentials. This code intentionally does not upload examples to a third party.

## Current status

This is a reproducible training harness, not a completed training run. No curated training dataset, GPU runtime, provider job or deployed adapter was supplied or executed in this change. No production model was changed.
