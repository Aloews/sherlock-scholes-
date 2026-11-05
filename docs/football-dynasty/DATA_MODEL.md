# Football Dynasty — Logical Data Model

**Status:** design only. No database migration has been applied.

## Naming and isolation

Use the private `fd` PostgreSQL schema in the existing Supabase project. Relations inside it use unprefixed names (for example, `fd.campaigns`, `fd.characters`, `fd.journal_entries`). The schema is not exposed through PostgREST. Every campaign-owned relation carries `campaign_id`. Use composite foreign keys where practical to prevent cross-campaign references. Do not create production tables until identity, schema placement, grants, RLS, indexes, and test strategy are approved.

## Proposed relations

| Relation | Responsibility |
|---|---|
| `fd.campaigns` | Owner, mode, seed, game time, ruleset and simulation versions |
| `fd.worlds` | Generated world and generation version |
| `fd.countries`, `fd.regions` | Fictional geography |
| `fd.dynasties` | Family house, head, reputation and succession rules |
| `fd.characters` | Player and NPC characters |
| `fd.character_traits` | Skills and traits |
| `fd.family_relations` | Parentage, marriage, adoption, guardianship |
| `fd.relationships` | Trust, affection, respect, loyalty, fear, envy, rivalry |
| `fd.wills`, `fd.will_allocations` | Versioned wills and allocations |
| `fd.clubs`, `fd.players`, `fd.staff` | Fictional football entities |
| `fd.club_roles` | Executive and coaching appointments |
| `fd.holdings`, `fd.club_ownership` | Holdings, ownership and control |
| `fd.competitions`, `fd.seasons`, `fd.fixtures`, `fd.match_results` | Fictional football calendar and results |
| `fd.contracts`, `fd.transfers` | Contract and transfer history |
| `fd.accounts`, `fd.journal_entries`, `fd.journal_lines` | Financial accounts and append-only ledger |
| `fd.assets`, `fd.businesses` | Property and non-football assets |
| `fd.political_bodies`, `fd.positions`, `fd.influence` | Associations, offices and influence |
| `fd_event`, `fd_event_choice`, `fd_chronicle` | Structured events, choices and immutable history |
| `fd_tick_job` | Bounded simulation work and recovery cursor |
| `fd_snapshot` | Versioned recovery snapshots |

This is a logical catalogue, not a final one-table-per-concept migration prescription. Normalisation and indexes must follow query patterns and invariant enforcement.

## Ownership

Use a typed ownership model supporting person, dynasty/estate, holding, and permitted entity owners. Keep economic ownership, voting/control rights, beneficial ownership, and operational appointments distinct. Avoid unchecked polymorphic foreign keys.

## Financial integrity

Balances are derived or cached from journal entries and are never client-editable. Transactions use balanced debit/credit entries, explicit currency, game timestamp, real creation timestamp, source event, actor, reason, and unique campaign-scoped idempotency key. Corrections are compensating entries, not history edits.

## Identity and RLS

The owner key must reuse the existing Telegram Mini App identity verifier. Do not assume Supabase Auth `auth.uid()` is the product identity. Trace the exact verified identity type before choosing a column or RLS predicate.

Policies must prevent cross-user reads/writes, forged owner IDs, ownership reassignment, cross-campaign foreign keys, and direct writes to protected simulation/ledger tables. Test with two distinct users. Enable RLS on every exposed relation.

## Index candidates

- `(campaign_id, id)` for scoped entity lookup;
- `(campaign_id, game_at)` for chronology;
- `(campaign_id, status, due_at)` for due work;
- unique `(campaign_id, idempotency_key)` for commands and transactions;
- unique fixture identity per competition/season/round;
- unique result per fixture;
- ownership lookup by asset and by owner;
- relationship lookup in both directions.

Add indexes only after concrete query shapes are defined.

## Migration gates

Before the first migration: confirm identity contract; decide public/private schema and Data API exposure; review grants and RLS; test campaign isolation; test journal balancing/idempotency; test succession atomicity; run security/performance advisors and compare against the existing baseline; confirm the live migration ledger; test a rollback/forward-fix path.

No production migration is part of this baseline.
