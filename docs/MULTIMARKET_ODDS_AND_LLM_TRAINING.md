# Multi-market odds and reproducible LLM fine-tuning

## Market storage and settlement

The existing fixture_odds table remains the compatibility store for 1X2. The generic fixture_market_quotes ledger supports h2h, spreads, totals and btts. Each quote is keyed by fixture, observation time, provider, bookmaker, region, market, outcome and line point. These tables remain internal: RLS is enabled, no client policies are created, and anon/authenticated receive no grants.

Settlement uses final scores on fixtures, only after the fixture is completed and kickoff has passed. Results are won, lost, push, half_won, half_lost or void. Quarter-line totals and handicaps are split into adjacent half-lines. Settlement is per quote outcome, not per market as a whole.

The default rotation is quota-neutral: each sport request uses one market; h2h runs in two of every three collection cycles, while spreads, totals and btts rotate through the remaining cycle. With ten leagues and the existing every-other-day schedule this is about the same number of credits as the prior h2h-only collector, while building slower history for all four markets. Set ODDS_MARKETS to a comma-separated subset of h2h,spreads,totals,btts to override the rotation; multi-market requests cost one credit per market and region. The Edge Function and database reserve an 80-credit floor before each request, and the existing monthly 500-credit hard ceiling remains authoritative. Do not enable all four markets across every league daily without calculating monthly usage.

## Profile backfill queue

profile_backfill_jobs tracks one task per card and source. The worker claims rows with FOR UPDATE SKIP LOCKED, increments attempts, and uses a lease so crashed tasks can be reclaimed. A task becomes succeeded only after a separate read-after-write check. A clean source response with no usable record becomes no_data; transport and parse failures retry up to the configured maximum. Workflow is manual-only until migration approval and application.

## Fine-tuning lifecycle

1. The database captures pre-kickoff features and odds when an llm forecast is inserted.
2. The export RPC returns only settled fixtures with feature and odds timestamps before kickoff and settlement after kickoff.
3. prepare_dataset.py validates labels, timestamps, duplicates and non-empty context; it splits chronologically 70/15/15 and hashes the input into manifest.json.
4. Provider submission defaults to dry-run. Only train and validation files are uploaded; holdout stays local.
5. External submission requires explicit workflow dispatch and FT_BASE_URL, FT_API_KEY and FT_MODEL. The endpoint must support OpenAI-compatible /files and /fine_tuning/jobs endpoints.

Fine-tuning does not replace probability calibration or walk-forward testing. Do not promote a model unless it beats the baseline on a later unseen holdout. No external job starts automatically.
