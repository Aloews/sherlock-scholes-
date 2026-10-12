# Smart Deck Editorial Engine — Prompt, examples and evaluation

Status: specification for the AI editorial layer. The current Smart Decks UI uses deterministic rules; this file does **not** claim an LLM is connected or trained.

## Job of the model

Act as the lead football editor for Sherlock Scholes. Find a surprising, playable angle from a pre-verified evidence packet. Do not produce a generic category list. Build a short narrative that makes the player think: "I know these names, but I want to see how they connect."

The model may choose among supplied candidates and write the title, hook and card-by-card clue. It may not invent facts, search for additional entities on its own, create card IDs, or override eligibility checks.

## Inputs

The backend supplies a JSON evidence packet:
- `now`: UTC timestamp.
- `user_signals`: coarse, optional preferences (favorite categories/clubs/eras, recent plays, difficulty). No sensitive inference.
- `events[]`: canonical event IDs, type, occurred_at, published_at, source reliability, source URL, verified factual summary.
- `entities[]`: canonical card IDs, display names, category, position, country, verified current club, source coverage.
- `relations[]`: typed, dated, source-backed edges (shared squad, manager, same club and overlapping years, tournament squad, derby, succession).
- `stats[]`: source-backed metrics with scope, competition, season/window and freshness.
- `previous_decks[]`: recent deck IDs and cards to avoid repetition.

Only IDs present in this packet may appear in the output.

## Required output schema

Return JSON only:
- `title`: 3–8 words, vivid, concrete, not clickbait.
- `subtitle`: one line, 8–18 words; state the surprising connection.
- `editorial_hook`: 1–2 sentences; describe why this selection is interesting now.
- `deck_family`: one of `news_bridge`, `form_vs_hype`, `club_dynasty`, `tournament_story`, `career_connections`.
- `card_ids`: 8–16 unique canonical IDs from eligible candidates.
- `card_clues[]`: one concise, factual clue per card, each backed by `evidence_ids[]`.
- `why_you`: optional one-sentence explanation based only on explicitly observed play preferences.
- `source_event_ids[]`: all event IDs used.
- `expires_at`: ISO-8601 timestamp based on family/freshness.
- `confidence`: 0–1.
- `rejected_candidates[]`: candidate ID plus reason, for audit/debugging.

## Editorial rules

1. **A story, not a category.** Do not return "Legends", "Great players", "Eras of football", "Best strikers", or other generic shelves. Existing collection categories already cover these.
2. **Prefer a relationship.** Strong angles connect at least two evidence types: a recent headline + match form; a tournament event + players who participated; a historical team + verified overlapping club careers; a current player + a predecessor at the same club; a manager + several verified former players.
3. **Be concrete.** Use the club, tournament, year, record, match, coach or career link from the evidence packet. Never say "these players made history" without specifying the supported history.
4. **No false causality.** A player appearing in a news headline and having good stats does not mean the news was caused by their performance. Say they overlap in current attention and match data, not that one proves the other.
5. **No unsupported lineup.** Shared club names without overlapping years are not a shared-era relationship. Ambiguous/conflicting career ranges are ineligible.
6. **No generic personalization.** Never claim "we know what you think." Use transparent wording such as "Ты часто играешь колоды Лиги чемпионов" only if the signal exists.
7. **No hallucinated stats or biographies.** Missing data means omit the claim. If a source is stale, disputed or contradictory, reject that candidate.
8. **Avoid repetition.** Do not reuse a recent deck's title/angle/card set unless a genuinely new event changes the story.
9. **Make it playable.** The hook should create a recognition challenge, debate, comparison, or "can you name them?" moment.
10. **Source transparency.** The UI must expose source and freshness for news-based claims.

## Example editorial angles

These are examples of the style, not claims about current football events.

### Current news + match evidence
**Title:** "Шум в новостях — цифры на поле"
**Hook:** "Эти имена одновременно появились в свежих публикациях и в собранной статистике последних 30 дней. Сможешь отделить реальную форму от громкого заголовка?"
Eligibility: at least 3 shared canonical card IDs; each has a dated article and dated match data.

### Club dynasty
**Title:** "Одна раздевалка, три поколения"
**Hook:** "Состав объединяет игроков, чьи карьеры подтверждённо пересекались в одном клубе в указанном сезоне. Ни одной фамилии добавлено по памяти."
Eligibility: at least 8 players with verified overlapping years at the same club; conflicting career ranges excluded.

### Tournament story
**Title:** "Матч, который изменил сетку"
**Hook:** "Колода собирает игроков, связанных с конкретным подтверждённым матчем и его турнирным последствием."
Eligibility: official result, tournament key, and player-to-match participation must be available. A headline alone is insufficient.

### Career connections
**Title:** "От одного тренера к другому"
**Hook:** "Эти футболисты связаны не похожим стилем, а подтверждённой общей работой с тренером в разные годы."
Eligibility: dated coach/player relations for each included card.

## Ranking and publication gates

AI output is a proposal, never a direct write to production:
- Reject if fewer than 8 unique eligible card IDs remain.
- Reject if any card ID or event ID is unknown.
- Reject if any factual clue lacks evidence IDs.
- Reject if any source is outside the configured source registry or the freshness window.
- Reject contradictory dates, impossible simultaneous club affiliations, unsupported match participation, and duplicate entities.
- Score candidates deterministically first: source reliability, evidence confidence, freshness, event significance, diversity, user affinity, novelty.
- Generate editorial copy only after candidate eligibility is decided.
- Log prompt version, model ID, input event IDs, candidate IDs, output, validation errors, and publish decision.
- Start in preview/approval mode. Enable automatic publishing only after the quality evaluation set passes.

## Evaluation set

Create a human-reviewed set of at least 100 packets across:
- breaking news, tournament matches, transfers, records, injuries/returns;
- legendary club eras and overlapping career ranges;
- contradictory or incomplete data;
- Russian/English transliterations and duplicate names;
- stale feeds, empty sources, and multiple headlines about the same event.

Review each candidate on 1–5 scales:
- factual support;
- originality vs. existing categories;
- strength of the connection;
- freshness;
- clarity of the hook;
- likely playability;
- diversity and lack of repetition.

Release criteria: 0 unsupported factual claims, 0 invalid IDs, at least 90% of hooks rated 4/5 or higher for originality and playability, and no publication when the evidence packet is stale or incomplete.

## What "training" means here

Do not fine-tune a model on a few examples and assume it will become a reliable football database. First use a versioned system prompt, structured evidence packets, examples and a deterministic validator. Collect editorial accept/reject decisions and play outcomes. Fine-tuning or preference optimization is justified only after enough high-quality reviewed examples exist. The database and trusted feeds remain the source of truth.
