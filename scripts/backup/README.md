# Production backup

Workflow: `.github/workflows/supabase-production-backup.yml`

- Runs daily at 03:15 UTC and can be started manually.
- Dumps the PostgreSQL database in custom format using PostgreSQL 17, preserves ACL/GRANT statements while omitting object ownership, verifies the archive table-of-contents, and uploads the archive plus SHA-256 checksum to an external S3-compatible bucket.
- Copies every Supabase Storage bucket to a separate prefix in the external backup bucket and runs a size comparison.
- Uses immutable date/run prefixes. It never deletes or overwrites previous backups; configure retention with the destination bucket's lifecycle policy.
- A watchdog job makes a failed or cancelled backup workflow fail visibly.

## Required GitHub Actions secrets

Database:
- `SUPABASE_DB_URL`: PostgreSQL connection URI. Use the Supabase Session Pooler on port 5432 when direct IPv6 connectivity is unavailable; do not use the transaction pooler on port 6543 for `pg_dump`.

Supabase Storage source:
- `SUPABASE_STORAGE_S3_ENDPOINT`
- `SUPABASE_STORAGE_S3_REGION`
- `SUPABASE_STORAGE_S3_ACCESS_KEY_ID`
- `SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY`

External backup destination:
- `BACKUP_S3_ENDPOINT`
- `BACKUP_S3_REGION`
- `BACKUP_S3_BUCKET`
- `BACKUP_S3_ACCESS_KEY_ID`
- `BACKUP_S3_SECRET_ACCESS_KEY`

Enable Supabase Storage's S3 protocol and create an access key under Storage → Configuration → S3. Treat this key as high-privilege unless the dashboard explicitly offers a read-only scope. Create a separate bucket (name only, no path prefix) with ListBucket/GetObject access for verification and PutObject access for the backup destination. Do not use the production Storage bucket as the destination. Enable encryption at rest and configure lifecycle retention on the destination bucket.

## Backup layout

`sherlock-scholes/YYYY/MM/DD/RUN_ID-RUN_ATTEMPT/`

- `database.dump` — custom-format PostgreSQL dump, including accessible schemas and table data.
- `database.dump.sha256` — SHA-256 checksum.
- `storage/<bucket>/...` — object bytes from each Supabase Storage bucket.
- `storage-buckets.txt` — source bucket names.
- `manifest.txt` — project, timestamp, source commit, checksum, and verification scope.

The database dump includes Storage metadata in PostgreSQL; the separate Storage copy preserves the actual object bytes. The workflow verifies the database archive index and remote dump checksum. Storage objects are checked by size; this is not a full restore test. PostgreSQL global role definitions are not included: recreate custom roles from migrations and set runtime login passwords separately. ACL/GRANT statements are preserved.

## Restore validation

No restore is claimed by this workflow. Before any destructive production operation:

1. Create a separate, isolated Supabase project.
2. Restore `database.dump` into that project using a PostgreSQL 17 client and a documented Supabase-compatible restore procedure. Do not point restore commands at production.
3. Copy the backed-up Storage objects into the isolated project's Storage S3 endpoint.
4. Compare critical row counts, migration ledger, RLS/grants, bucket/object counts, and representative object downloads.
5. Record the isolated project's reference, restore timestamp, command versions, and test results.

The current connected Supabase tools do not expose the production DB URI or Storage S3 credentials. The workflow will fail closed until the account owner adds the secrets above. No backup has yet been run by this PR.
