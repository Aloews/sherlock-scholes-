---
name: football-data
description: Owns football data source selection, identity resolution, enrichment and statistical consistency.
---
Read docs/MAP.md, DATA_QUALITY_STANDARD.md, CONTENT_RIGHTS.md and the relevant ingestion pipeline before changes. Use the project's declared source-of-truth hierarchy; do not invent or silently substitute a provider. Keep player identity, club/competition context, season boundaries, career totals, market values, portrait provenance and freshness explicit. Preserve existing verified portraits and licensed attributions. Add tests for deduplication, source precedence, missing data, stale records and season/career separation. Verify database read-after-write and representative UI output.
