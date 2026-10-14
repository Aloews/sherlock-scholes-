# Fine-tuning datasets

Keep reviewed training exports here only if they are approved for repository storage. Do not commit
API keys, private user conversations, personally identifying information, or provider data whose
license does not permit redistribution.

Expected file for the manual workflow: `forecast_training.jsonl`.

Each record must follow the schema in `docs/LLM_FINETUNING.md` and use only pre-kickoff features in
the user prompt. The assistant response is the supervised target. Include completed-match outcomes
only as labels/targets, never as prompt features. Keep a source manifest and verify licensing before
committing a dataset.

No generated or synthetic training examples are included by default. If a curated dataset is absent,
the fine-tuning workflow should fail at dataset validation rather than train on invented examples.
