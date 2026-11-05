# Football Dynasty — Logical Data Model

**Status:** design only. No database migration has been applied.

## Naming and isolation

Use the `fd_` prefix in the existing Supabase project. Every campaign-owned relation carries `campaign_id`. Use composite foreign keys where practical to prevent cross-campaign references. Do not create production tables until identity, schema placement, grants, RLS, indexes, and test strategy are approved.

## Proposed relations

| Relation | Responsibility |
|---|---|
| `fd_campaign` | Owner, mode, seed, game time, ruleset and simulation versions |
| `fd_world` | Generated world and generation version |
| `fd_country`, `fd_region` | Fictional geography |
| `fd_dynasty` | Family house, head, reputation and succession rules |
| `fd_character` | Player and NPC characters |
| `fd_character_trait` | Skills and traits |
| `fd_family_relation` | Parentage, marriage, adoption, guardianship |
| `fd_relationship` | Trust, affection, respect, loyalty, fear, envy, rivalry |
| `fd_will`, `fd_will_allocation` | Versioned wills and allocations |
| `fd_club`, `fd_player`, `fd_staff` | Fictional football entities |
| `fd_club_role` | Executive and coaching appointments |
| `fd_holding`, `fd_ownership` | Holdings, ownership and control |
| `fd_competition`, `fd_season`, `fd_fixture`, `fd_match_result` | Fictional football calendar and results |
| `fd_contract`, `fd_transfer` | Contract and transfer history |
| `fd_account`, `fd_journal_entry` | Financial accounts and append-only ledger |
| `fd_asset`, `fd_business` | Property and non-football assets |
| `fd_political_body`, `fd_position`, `fd_influence` | Associations, offices and influence |
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
