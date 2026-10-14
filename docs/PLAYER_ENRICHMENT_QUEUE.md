# Player enrichment queue operations

## Enablement gate

The queue migration is deliberately not applied by GitHub Actions. First review and apply the migration to a non-production Supabase project, verify the RPCs and RLS, then apply it to the target project under the normal change process.

The scheduled queue workflow remains disabled unless the GitHub repository variable PLAYER_ENRICHMENT_ENABLED is exactly true. Enable that variable only after the migration is applied and the required SUPABASE_URL and SUPABASE_KEY repository secrets are configured. SUPABASE_KEY must be a server-side service-role key, never an anon/publishable key.

The workflow is serialized with the existing player-profile-data workflow to prevent two collectors from requesting the same missing portrait at once. It processes at most 250 queue tasks per run and uploads before/after audit reports as a workflow artifact.

## Queue semantics

- Transfermarkt photo jobs are created only for active player cards with no photo URL, a Transfermarkt ID, and no Soccer Wiki profile mapping. The existing Wikidata batch continues separately because Wikimedia attribution/credit collection is a required companion step.
- Season-stat jobs are created only for active players with a Transfermarkt ID and no season rows. Unvalued players remain eligible.
- The worker claims jobs atomically with SKIP LOCKED, records attempt count, and verifies the saved row after every task.
- Transient network or database failures become retryable with exponential delay. A successful response with no usable portrait/stat rows becomes no_data rather than a false success. After the configured attempts, a task becomes failed; terminal failures and no_data jobs can be re-queued after 30 days.
- If the existing nightly collectors fill a field before the queue handles its task, the enqueue RPC reconciles the task as succeeded instead of fetching the same data again.
- The queue never overwrites a non-empty photo URL. It does not fabricate a photo for the 84 missing-photo cards with neither a Transfermarkt ID nor a Wikidata QID; those need identity resolution or another trusted source.

## Manual operation

From GitHub Actions, run Player enrichment queue with a limit from 1 to 250. The workflow creates/reconciles jobs, processes one batch, verifies each persisted status, and uploads a before/after profile-coverage report. Re-run to process the next batch. The scheduled run uses 250 tasks.

To produce a local read-only report, run docs/player_data_audit.py with SUPABASE_URL and SUPABASE_KEY configured. Use --skip-match-scan for a faster report that focuses on card/profile and season coverage.
