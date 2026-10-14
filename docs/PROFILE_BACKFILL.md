# Player profile data backfill

## Current contract

The profile catalogue is sourced from `public.cards`; season aggregates are stored in
`public.player_season_stat`, and match-level data in `public.player_match_stats`.
A populated URL/row is not proof of correctness, so every queue item must end in one of:

- `succeeded`: source operation completed and the stored result was read back and validated.
- `no_source_data`: eligible sources responded successfully but have no usable data.
- `retry`: a timeout, source failure, write/read-back mismatch or incomplete payload occurred.
- `failed`: retry budget exhausted.

Transport failures must never be reported as missing source data.

## Report (read-only by default)

Run with repository secrets available:

```bash
python docs/profile_gap_report.py --output-dir artifacts/profile-data
```

Creates `profile_gap_report.md` and `profile_gap_report.json`. Reads all PostgREST pages,
not only the first 1,000 rows. It counts missing portraits, missing season-stat coverage,
missing Transfermarkt identifiers and empty `career_stats` JSON. A season-stat job is queued
only when the player has no linked season rows; this is not a claim that every season is complete.

## Queue and per-job verification

Apply the reviewed migration `20261014130000_profile_backfill_market_expansion.sql` in a
non-production environment first. After validation, create idempotent jobs:

```bash
python docs/profile_gap_report.py --enqueue --enqueue-limit 100
```

Omit `--enqueue-limit` to enqueue every candidate. Do not enqueue until the migration exists.
The queue is protected by RLS and is writable only with the service key. Jobs are claimed with
`FOR UPDATE SKIP LOCKED`, a bounded lease, retry count and idempotency key.

Inspect queue counts without changing jobs:

```bash
python docs/profile_backfill_worker.py
```

Run a small batch explicitly:

```bash
python docs/profile_backfill_worker.py --run --limit 5
```

The worker uses existing source collectors, reads the row back, checks photo URLs for HTTP
success and image content type, and checks season rows for IDs and non-negative statistics before
marking success. Source-specific scripts still retain their own conservative write guards.
Start with small batches; increase only after reviewing failed and `no_source_data` outcomes.

## Operational limits

- Never overwrite an existing photo with a candidate unless the card's `photo_url` is still null.
- Preserve source attribution in `photo_source`.
- Do not infer a missing value from a failed request.
- A single season row is not full career coverage; add season-range completeness checks once the
  expected competition/season universe is available.
- Use service-role credentials only in CI/server jobs, never in browser code.
