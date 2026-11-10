# Football Dynasty — Game Design Document

**Baseline:** v1.0 · **World:** fictional · **Modes:** sandbox and scenarios · **Primary play:** strategic management.

## Product vision

A grand-strategy football dynasty simulator. The player creates a person, builds a family, acquires football assets, manages a club holding, competes with autonomous rival families, and continues the campaign through heirs. The dynasty—not the manager's career—is the unit of long-term progression.

### Design pillars
1. The campaign survives the founder's death.
2. Football, economy, family, and politics form one causal world.
3. Characters have motives, skills, traits, relationships, and persistent memories.
4. AI follows the same financial and legal rules as the player.
5. Major outcomes are explainable and recorded in a chronicle.
6. The player delegates operations while retaining strategic control.

## World and campaign setup

The world is fully fictional. Generation creates regions, countries, cities, associations, leagues, clubs, competitions, stadiums, and a compact historical record. Real clubs, players, owners, federations, and competitions are not imported into this mode.

Two campaign formats:
- **Sandbox:** configurable start, open-ended progression, no mandatory victory.
- **Scenario:** authored start and optional objectives; completing an objective does not end the campaign.

Initial test-world targets (subject to profiling): 2 countries, 2 leagues, 16 clubs, 300 players, 8 rival dynasties, 100 notable characters. These are not production scale limits.

Country/league variables include economy, population, football culture, infrastructure, media reach, reputation, regulations, and competition rules. Historical records must be consistent with current world state and persisted after generation.

## Character creation

The player chooses identity/presentation, age, origin country/city, education, traits, skills, family situation, ambition, capital, debt, contacts, reputation, and starting assets.

Origins are asymmetric starts, not permanent classes:
- football-family heir;
- entrepreneur/investor;
- former professional player;
- football agent;
- trained executive;
- ordinary newcomer.

Core skills: diplomacy, management, finance, football expertise, negotiation/intrigue, and public standing. Traits influence decisions and AI behaviour. Skills modify outcomes but do not guarantee them.

## Characters and dynasty

Characters have age, life state, skills, traits, ambitions, employment, assets, relationships, and event history. Family relations support parent/child, spouse/former spouse, sibling, adoption, guardianship, and house membership. Kinship does not automatically confer legal ownership.

Relationships are multidimensional: trust, affection, respect, loyalty, fear, envy, and rivalry. Dynasty state includes house identity, head, reputation, prestige, branches, claims, succession rules, and milestones.

## Inheritance

Inheritance is a deterministic rules engine, never an LLM decision. Inputs include valid will, succession law, legal heirs, ownership shares, adoption status, eligibility, debt, and asset restrictions.

Required cases: multiple heirs, split estate, voting/control rights distinct from economic shares, contested will, no direct heir, minors/guardians, renunciation, disinheritance, negotiated settlement, and an heir dying during succession.

Preview allocations before confirmation. Execute transfers atomically. Preserve an immutable audit trail. A repeated request must not transfer an asset twice.

## Football management

Fictional entities include clubs, players, staff, leagues, cups, seasons, fixtures, results, stadiums, academies, contracts, transfers, and club histories.

Club roles: president/chair, CEO, sporting director, head coach, finance lead, academy director. Each role has skills, personality, loyalty, contract, salary, and agenda. The player chooses full control, strategic delegation, or autonomous management.

Ownership supports direct ownership, holdings, multiple shareholders, minority investments, voting rights, and beneficial ownership. Economic share, voting control, and operational appointment are separate concepts. Multi-club restrictions are configurable by competition and jurisdiction.

The first release models seasons, fixtures, results, tables, player development, availability, contracts, and transfers. A full tactical match engine is not an MVP promise.

## Economy and assets

Maintain separate ledgers for personal, family/estate, holding, club, and independent business accounts. Revenue includes matchday, broadcasting, sponsorship, merchandise, transfers, prize money, academy compensation, hospitality, and non-football businesses. Costs include wages, transfers, staff, facilities, stadium operations, debt service, tax, dividends, and investment.

Every money movement is a journaled transaction with currency, amount, accounts, game date, source event, actor, and idempotency key. Balances are not client-editable. Personal assets cannot be paid from club funds without a valid salary, dividend, loan, or other recorded transaction.

Assets include property, vehicles, businesses, shares, stadiums, and infrastructure. Each has owner, location, valuation method, upkeep, liquidity, and sale rules. Economic risks include insolvency, liquidity crisis, covenant breach, sponsor loss, declining attendance, failed investment, and regulatory penalties.

## Politics and rivals

Political entities include associations, leagues, committees, and governing bodies. Influence derives from sporting success, finance, reputation, relationships, and coalitions. Elections have eligibility, campaigning, voting, and consequences. The MVP focuses on transparent influence and alliances.

Rival dynasties have leaders, heirs, goals, assets, relationships, budgets, and behavioural archetypes: sporting maximiser, conservative steward, aggressive investor, political operator, traditionalist, or opportunist. AI uses the same constraints as the player; it cannot create money or bypass ownership rules.

AI memory stores structured event references and relationship changes. Narrative text presents persisted facts; it does not determine state.

## Personal life and time

Life simulation is strategic, not room-by-room. It covers partnership, marriage, divorce, children, education, friendships, residences, travel, and social events through choices and event chains. Full 3D property exploration is out of scope.

Campaign time is paused or advanced in bounded ticks. The server is authoritative. Events pass through eligibility checks, persistence, choice resolution, atomic state changes, and chronicle recording. Use event-driven and tiered updates rather than recalculating every character daily.

## Interface

Primary areas: Overview, Character, Dynasty, Football, Clubs/Holding, World, Politics, Rivals, Assets, Chronicle. Surface the next meaningful decisions, pending events, finances, club performance, succession risks, and rival activity without combining every system into one dashboard.

Use Sherlock Scholes routing, design tokens, FSD, and all nine locales: ru, en, es, pt, fr, ar, ja, ko, zh.

## MVP vertical slice

A single-player campaign must support: create world and character; choose origin; acquire/control a small club; create a family and heir; appoint leadership; run a season; maintain separate ledgers; advance age; process founder death and succession; continue as heir; save and reload deterministically.

Not MVP: multiplayer campaigns, 3D life simulation, fully detailed tactical controls, exhaustive global politics, hundreds of countries, LLM-authoritative state, or real-world licensed football data.

## Acceptance criteria

Automated tests prove reproducible world generation; campaign isolation; no direct client mutation of protected balances/ownership; balanced idempotent financial transactions; succession edge cases; fixture/table reconciliation; budget-constrained rival decisions; preserved history after succession; exact recovery after reload; and no regression in existing Sherlock Scholes routes or football data.

## Open decisions

Exact Telegram identity adapter; public/private schema placement; RPC versus Edge orchestration boundary; tick budget; ownership/legal depth; match simulation model; future multiplayer; world size after load testing.
