# Football Dynasty — Machiavellian Strategic Doctrine

## Purpose

Teach the player to reason about power, institutions, incentives, reputation, uncertainty and long-term control through the management of a fictional football dynasty.

The curriculum is an original game adaptation of ideas found across Niccolò Machiavelli's *The Prince* and, where noted, the broader civic and institutional concerns of his political thought. **The numbered set of 18 is a curated learning sequence created for this game; Machiavelli did not publish a canonical list of “18 rules”.** The lessons paraphrase concepts and do not reproduce a modern author's translation.

## Learning loop

1. Present one short concept with its source chapter.
2. Place the player in a concrete club, board, supporter, transfer, league or family-governance dilemma.
3. Offer three plausible actions with distinct consequences.
4. Let the player commit one decision. The server assigns a bounded strategic-judgment score (0–2); the client cannot submit a score.
5. Explain the chosen action's likely consequence and the underlying idea.
6. Persist the decision against the campaign, unlock the next lesson and add a chronicle event.
7. Let the player revisit completed lessons. A lesson cannot be replayed for extra points.

Scores assess the quality of the strategic reasoning in that particular scenario. They do not measure moral worth and do not imply that there is one universally correct action in every political context.

## The 18 principles

| # | Principle taught | Football-dynasty application | Primary reference |
|---:|---|---|---|
| 1 | Effective truth before wishful thinking | Audit the club's actual finances, squad and incentives before making public commitments | *The Prince*, XV |
| 2 | Virtù: the capacity to act | Build competence, judgment, initiative and adaptability instead of depending on luck | VI, XXV |
| 3 | Own foundations and capabilities | Keep critical recruitment, academy, medical and decision-making capacity under institutional control | XII–XIII |
| 4 | Learn from history and predecessors | Analyse why previous takeovers and sporting projects succeeded or failed | VI, XIV |
| 5 | Consolidate acquisitions before expanding | Understand local institutions and interests after acquiring a club | III, V |
| 6 | Map factions and interests | Understand the board, supporters, players, staff and their different sources of influence | IX, XIX |
| 7 | Distinguish respect, love and fear | Use consistent standards; never confuse intimidation with durable authority | XVII |
| 8 | Avoid hatred caused by arbitrariness | Do not humiliate stakeholders or impose opaque, arbitrary burdens | XIX |
| 9 | Avoid contempt and perceived weakness | Make informed decisions and ensure accountable execution | XIX |
| 10 | Combine the fox and the lion | Detect negotiation traps, verify claims and retain lawful leverage | XVIII |
| 11 | Manage reputation through visible deeds | Make public commitments measurable and report real progress | XVIII, XXI |
| 12 | Treat promises as costly commitments | Make credible promises; renegotiate transparently when circumstances change | XVIII |
| 13 | Choose capable advisers | Select executives for competence, incentives and accountability | XXII |
| 14 | Protect channels for unwelcome truth | Create structured ways for experts to challenge the leader's assumptions | XXIII |
| 15 | Practise fiscal restraint | Avoid showy generosity that weakens the club's future options | XVI |
| 16 | Prepare before threats become crises | Build squad depth, medical resilience and contingency plans | XII–XIV |
| 17 | Choose alliances deliberately | Evaluate the cost of neutrality, coalition terms and dependency | XXI |
| 18 | Adapt to fortuna and changing times | Revise methods when conditions change without losing strategic direction | XXV |

## Design and ethics constraints

- The setting is football governance and family enterprise. No real-world violence, coercion, criminal activity or abuse is presented as a player objective.
- Where Machiavelli discusses force, cruelty or deception, the game teaches the analytical distinction between capability, deterrence, reputation and arbitrary harm. It does not reward violence or unlawful conduct.
- Do not flatten Machiavelli into the slogan “the ends justify the means”. His account is more context-sensitive and includes repeated warnings about hatred, contempt, dependency and political fragility.
- Do not present *virtù* as a simple synonym for goodness; in this context it means the capacities that allow a leader to respond effectively to circumstances.
- Do not present *fortuna* as fully controllable. The player can prepare, build reserves and adapt, but uncertainty remains.
- AI-generated narrative must never decide lesson scores, unlocks or persisted campaign state. Those outcomes are deterministic server logic.

## Technical contract

- Content: src/features/football-dynasty/machiavelliPrinciples.ts.
- UI: src/screens/MachiavelliAcademy.tsx, embedded in the campaign screen.
- API: GET /api/v1/campaigns/{campaign_id}/doctrine and POST /api/v1/campaigns/{campaign_id}/doctrine/{principle_id}/answer.
- Persistence: fd.doctrine_progress, keyed by campaign and principle, protected by the same verified Telegram owner scope as the campaign.
- Mutations require idempotency keys. Principle order and score are server-authoritative.
- Each locale must include the academy interface labels in ru, en, es, pt, fr, ar, ja, ko and zh. Lesson text is authored in Russian and English; other locales currently use English lesson content until full lesson translation is reviewed.

## Source basis

- Niccolò Machiavelli, *The Prince*, especially Chapters III, V–VI, IX, XII–XXIII and XXV. [Early Modern Texts edition (PDF)](https://www.earlymoderntexts.com/assets/pdfs/machiavelli1532part1.pdf).
- [Internet Encyclopedia of Philosophy — Niccolò Machiavelli](https://iep.utm.edu/machiave/), for the structure and interpretive controversies surrounding *The Prince*.
- [Stanford Encyclopedia of Philosophy — Machiavelli](https://plato.stanford.edu/archives/spr2017/entries/machiavelli/), for the account of political power and *virtù*.
- Revisiting the Received Image of Machiavelli in Business Ethics Through a Close Reading of *The Prince* and *Discourses* (2023), [Journal of Business Ethics](https://doi.org/10.1007/s10551-023-05481-2), for a modern discussion of *virtù*, *fortuna*, adaptability and the distinction between effective rule and gratuitous harm.

These references support the conceptual adaptation. The game scenarios, wording, choice feedback and scoring are original product content.
