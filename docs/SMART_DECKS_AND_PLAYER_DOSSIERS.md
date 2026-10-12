# Smart Decks & Footballer Dossiers

Product/engineering brief for the next Sherlock Scholes differentiator. This document is a build contract, not a claim that the feature is already shipped.

## Product promise

Sherlock Scholes should feel like a football editor who knows what the user wants to play next: timely, credible themed decks with a strong visual identity, plus rich footballer dossiers that feel familiar to Football Manager / EA SPORTS FC players.

Two connected surfaces:
1. **Footballer dossier** — a card opens into a compact career profile: position, clubs by season, appearances/goals where sourced, trophies, national-team record, peak era, notable teammates, manager, and a source/last-updated line. Attributes/OVR are only shown when derived from evidence; never fill missing numbers with fabricated values.
2. **Smart Decks** — editorial-quality, continuously refreshed collections driven by verified news, tournaments, player form, and historical team eras/relationships.

## Dossier: display contract

### Layout
- Hero: large portrait, full name, nationality/flag, position, birth/death status where applicable, active/legend badge.
- FM-style summary row: appearances, goals, assists, trophies, international caps — only fields with sufficiently reliable data, each with scope (club/country/competition) and date range.
- Career timeline: club, season/years, appearances/goals where source-backed; distinguish full career history from partial collected seasons.
- Peak card: the player's strongest evidenced season/era, with a concise explanation and cited/source links.
- Connections: legendary teammates, managers, clubs, tournament squads. Every edge must have provenance and dates.
- Confidence: show "данных достаточно / частично / мало" internally and surface a subtle "обновлено" + source details in the dossier.

### Rating model
- Do not copy a single opaque real-world OVR from an unrelated game.
- If we create Sherlock attributes (pace, shooting, passing, dribbling, defense, physical), derive each from explicit, documented signals with position-aware weights and a time window. Store the formula/version and the evidence window.
- Use an uncertainty/coverage threshold. If coverage is below threshold, omit the attribute/OVR rather than displaying a misleading number.
- Separate **peak career**, **current form**, and **all-time profile**. They answer different questions and must not be collapsed into one score.
- Historical comparisons need era/competition normalization; modern tracking data must not make older players look objectively worse simply because the same measurements did not exist.

## Smart Decks: editorial formats

Initial launch should include four deck families:
1. **Right now** — recent major match, transfer, award, record, injury/return, tournament run, or coaching news.
2. **Tournament pulse** — squads, breakout players, decisive goals, rivalries, and historical parallels around a current tournament.
3. **Dynasty / golden era** — a great team in a defined season/era, key players, coach, rivals, trophies, stadium and tactical identity.
4. **Connections** — players linked by a verified chain: shared squad, manager, transfer path, derby, national team, or succession of eras.

Each deck should have a short editorial title, one-line hook, visual hero, 8–20 cards, difficulty/recognisability range, why-it-matters copy, source links, generation timestamp, expiry/review time, and a clear "why this deck for you" explanation. Never use a clickbait headline unsupported by evidence.

## AI-assisted curation pipeline

AI should be an editor and ranker, not the source of truth.

1. **Ingest** from configured trusted feeds/APIs (official competitions/clubs, verified match/stat feeds, and selected reputable news publishers). Save canonical URL, publisher, publication time, event time, language, and ingestion time.
2. **Normalize** entities to stable IDs: card ID, player QID/Transfermarkt ID where available, club key, competition key, season. Do not match on display name alone.
3. **Extract candidate events** into a schema: event type, entities, date, evidence URLs, confidence, freshness, and affected competition/season.
4. **Ground** each proposed deck against the existing cards database. Reject any player/club/score/relationship that cannot be resolved to a canonical entity and supported by a source. No invented transfer, lineup, trophy, or statistic.
5. **Rank candidates** with an explainable score, e.g. recency, source reliability, event importance, user interests, deck diversity, card recognisability, and evidence confidence. Weight configuration is versioned and testable.
6. **Assemble and validate** the deck: no duplicate card IDs; minimum useful card count; balanced categories; valid active cards; no unsupported relationship; source coverage threshold; avoid repeating yesterday's same deck.
7. **Human-readable editorial layer**: AI writes the hook and card rationale only from the verified event packet. Store prompt/model/version and input event IDs so a deck can be reproduced and audited.
8. **Publish with freshness policy**: short-lived news decks expire/review after 24–72 hours; tournament decks update on new fixtures/results; evergreen era decks are reviewed on data changes, not artificially expired.
9. **Feedback loop**: impressions, opens, starts, completion, skips, and saves. Optimize for actual play and satisfaction, not clicks alone. Use privacy-conscious, coarse preference signals and provide a way to reset personalization.

### Candidate ranking (version 1)
Use a deterministic baseline before training a recommender:
- source reliability and evidence confidence: hard eligibility gates;
- freshness: strongest for news, weak for evergreen historical decks;
- event importance: official result/record/trophy/major transfer, not volume of articles;
- card availability and profile completeness;
- diversity: don't fill a deck with near-identical players;
- user affinity: previously played/saved categories, clubs, eras, difficulty, and language;
- novelty: reward a new angle and penalize recently repeated decks.

The AI may propose candidates; the backend must decide whether they are eligible. A model must never be able to bypass source checks.

## Data model proposal

Add versioned tables through migrations rather than hardcoding collections in the frontend:
- `football_events`: id, event_type, occurred_at, published_at, source_id, canonical_url, source_reliability, confidence, payload JSONB, entity_keys, ingested_at.
- `content_sources`: id, name, domain, source_type, reliability, enabled, allowed_event_types.
- `smart_decks`: id, slug, title, subtitle, family, hero_asset, language, status, generated_at, refresh_after, expires_at, rank_score, rationale, model_id, prompt_version, ranking_version.
- `smart_deck_cards`: deck_id, card_id, position, reason, evidence_event_ids, confidence.
- `player_profile_snapshots`: card_id, as_of, source_id, scope, season, metrics JSONB, coverage, formula_version. Keep source records distinct instead of overwriting historical facts.
- `player_connections`: from_card_id, to_card_id, relation_type, valid_from, valid_to, source_event_id/source_url, confidence.
- `user_deck_feedback`: user_id, deck_id, event_type, created_at, minimal context needed for ranking.

Add unique constraints, foreign keys, RLS, retention policy and indexes. Public clients may read only published decks and safe card metadata; source ingestion and publishing should run server-side using service-role credentials, never in the browser.

## Visual direction

- Premium football editorial, not a generic AI feed.
- Every deck has a bespoke hero composition: match-night lights for current events; archival grain and period-specific colors for legendary eras; tactical-board/connection lines for relationship decks.
- Strong hierarchy: title, one-line reason, freshness label, card strip, source badge, play CTA.
- Motion is restrained and meaningful: live pulse for fresh event, timeline reveal for historical era, subtle links drawing between related players.
- Personalization should feel like relevance, not surveillance. Explain the recommendation in natural language ("Ты часто выбираешь Лигу чемпионов и легендарные составы"), avoid claiming the app can literally read thoughts, and allow preferences to be reset.

## Rollout plan

**Phase 1 — reliable editorial MVP**
- Curated-deck schema, source registry, read API, beautiful home/collection shelf, deterministic hand-authored/algorithmic decks.
- Build 3–5 live examples from verified data and one legendary era.
- Add tests for source provenance, entity resolution, expiry, duplicates, empty/stale feed, and unsafe/unresolved facts.

**Phase 2 — AI-assisted updates**
- Scheduled event extraction and candidate ranking; AI generates only copy and suggestions after grounding.
- Preview/approval mode at first; publish automatically only after confidence and coverage gates pass.
- Audit logs and alerting for stale source feeds or failed refresh.

**Phase 3 — personalization**
- Rank already-eligible decks using play history and explicit preferences.
- A/B test starts/completions and repeat-play rate; do not optimize click-through in isolation.

## Release gates

- Every factual claim in a current deck has a source and event timestamp.
- Every deck card resolves to one canonical active card ID.
- No unverified entity, fabricated metric, or unresolved duplicate.
- Current-form stats exclude future fixtures and disputed placeholder scores.
- Stale feeds visibly degrade to the last verified deck; they never generate fake "breaking news".
- Tests cover Russian/English names, aliases, duplicates, source outages, time zones, and event expiry.
- Feature is not considered production-ready until CI, SQL/RLS checks, and a real UI smoke test pass.
