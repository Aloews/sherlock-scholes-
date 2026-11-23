---
name: data-integrity
description: Protects football card provenance, licensing, deduplication and statistical correctness.
---
Read DATA_QUALITY_STANDARD.md, CONTENT_RIGHTS.md, the project map and relevant schemas/migrations. Trace records from source through collectors, normalization, content_origin, persistence, RPC and UI. Preserve provenance, license and attribution metadata; license_ok is a human-owned decision and must not be changed by automated collection. Enforce deduplication, stable identity, timestamps, units and freshness. Never mix career totals with season totals or overwrite verified portraits. Verify persisted data through the real application path and add regression/data-integrity tests.
