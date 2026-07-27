# Quick-game filters — audit and rework

The screen this document is about is `HomeScreen`, view `create_training`:
the picker between "Быстрая игра" and the first card.

## What was wrong

### 1. One wall of chips, three meanings

The picker rendered 27 chips in a single flex-wrap: 8 tags, 6 continents,
12 non-player categories. All three kinds looked identical, but they did
different things — a tag narrowed the player pool, a continent filtered
players only, a category added a separate pool of cards. Nothing on screen
said so.

Below them sat a fourth control (three "recognizability" chips) and a
fifth (two `<select>` dropdowns), each with its own visual language.

There was also a hidden rule: `touched`. Tapping any tag while the
selection was pristine silently cleared every continent and category, so
"Звёзды" meant *only* stars — but the same tap after any other tap meant
something else entirely.

### 2. The counter described a different deck

`countDeck()` rebuilt the `WHERE` clause by hand from PostgREST filters
instead of calling the RPC. It omitted the onboarding difficulty floor,
the `langs` filter and the Pro check. The number under the button was
therefore not the deck the game would deal — it was an optimistic
approximation of it, and for a new player it could be off by thousands.

### 3. Five contradicting axes of "how well-known"

| axis | where it was used | problem |
| --- | --- | --- |
| `pageviews` | `p_min_pageviews`, `p_difficulty` | ru-wiki only → Russian-culture bias, patched by `p_boost_countries` |
| `pageviews_i18n` | inside the difficulty clause only | a second, parallel scale |
| `tier` | the "Известные / Средние / Малоизвестные" chips | **inverted**: median pageviews of `rare` = 1106 vs `common` = 3143; `legendary` started at 17 views |
| tags `star` / `legend` | chips, Pro preset | a third fame list, mixed in with real traits (goalkeeper, height) |
| `difficulty` column | nowhere | dead: `'medium'` on all 3364 rows |

The user-visible consequence: the chip labelled "Малоизвестные" dealt, on
average, *more* famous players than the one labelled "Средние". And
because the tier filter was player-only, asking for an obscure deck still
dealt "Реал Мадрид".

### 4. `top_league` was not a list of leagues

192 of 1367 non-null values were cups or friendlies — `Friendlies Clubs`
(58), `Cup` (44), `First League` (22), `League Cup` (15), `FA Cup`,
`Coppa Italia`, `Copa del Rey`, `DFB Pokal`, `Super Cup`, `UEFA Champions
League`, … They reached the dropdown because the options were derived from
whatever the column happened to contain.

Worse, the largest entry was a homonym. "Premier League" (723 players)
merged three competitions: England, Russia (~258 players — Спартак,
Зенит, ЦСКА, Ахмат, Крылья Советов…) and Belarus (Динамо (Брест), 17).

### 5. Twelve positional RPC parameters and six capability flags

`pick_random_cards` had grown one parameter per migration. The client
carried `rpcSupportsContinents`, `rpcSupportsTags`, `rpcSupportsInitData`,
`rpcSupportsDifficulty`, `rpcSupportsLocale`, `rpcSupportsGeo` and
retried the call after each `PGRST202` to discover what the deployed
database understood. Because tags were `AND`-ed across all categories,
the client also had to split any tag+category request into two RPC calls
and merge the pools by hand.

One of those degrade paths was hiding a real gap: `pro_deck.sql` had never
been applied to production, so `p_init_data` always failed, was always
dropped, and "server-side Pro enforcement" existed only on paper.

## What it is now

### One fame axis — `cards.fame`

`supabase/migrations/deck_fame.sql` adds `cards.fame smallint` (0–100):
the percentile rank of a card within its family (players against players,
everything else against everything else) by

    max(pageviews_ru, pageviews_i18n across 8 languages)

Taking the max across languages is what retires `p_boost_countries`: a
Korean or Mexican hero now scores on their own Wikipedia, so the
per-language relief hack has nothing left to fix.

Everything fame-shaped is derived from this column by `refresh_card_fame()`:

* `tier` — cosmetic frames only, via `fame_tier()`;
* tag `legend` — the Pro preset, exactly the top of the axis;
* tag `star` — **removed**, it is now literally `fame_min: 90`;
* the onboarding floor — a fame floor, the same field the picker writes,
  so the two collapse with `Math.max()` instead of being two systems.

Cards with no pageviews at all keep `fame = NULL`, which the predicate
treats as "never famous": they appear only when no floor is set. Inventing
a number for them would be a lie.

Distribution after the first run: 354 cards at `fame >= 90`, 1363 at
`fame >= 60`, 94 with no data.

### `top_league` holds leagues

`supabase/migrations/deck_top_league.sql`:

1. splits the homonym by club — Russian clubs become `Russian Premier
   League`, the Belarusian club becomes `NULL`;
2. rebuilds cup/friendly rows from the player's own club (169 of 192
   resolve, because the same club carries a real league on other players);
3. `NULL`s whatever is still not a league;
4. exposes `deck_leagues()` as the single source of truth for the picker,
   mirrored by `DECK_LEAGUES` on the client — the dropdown is no longer
   derived from live data.

Result: England 524, Russia 312, La Liga 149, Bundesliga 137, Serie A 126,
Ligue 1 94, Eredivisie 10. No cups.

### One canonical deck contract

`supabase/migrations/deck_rpc.sql`:

```
cards_matching(filter jsonb)                 -- THE predicate
pick_random_cards(filter, count, init_data)  -- deal
count_deck(filter, init_data)                -- count the same deck
```

The counter and the draw are the same SQL, so they cannot drift again.
The filter is one object:

```json
{ "categories": ["player","club"], "continents": ["europe"],
  "countries": ["FR"], "leagues": ["Premier League"],
  "tags": ["goalkeeper"], "fame_min": 60, "lang": "ru" }
```

Two rules make it behave the way the screen reads:

* `continents` / `countries` / `leagues` / `tags` describe **players** and
  never remove a club or a stadium — which is what let the client delete
  its two-pool merge;
* `fame_min` describes **every** card — "только знаменитые" no longer
  leaves an obscure club in the deck.

Pro-only tags are stripped server-side in `deck_sanitize_filter()`; the
missing `pro_only_tags()` / `tg_is_pro()` functions ship with this
migration, so the guard is real now.

**Deployment order matters, and I got it wrong once.** The migration
originally dropped the 12-parameter signature outright. The database ships
ahead of the frontend, so the build that was live in production kept
calling it positionally, got `PGRST202`, and dealt no cards at all until
the old signature was restored. It is back in `deck_rpc.sql` as a
temporary shim over the raw columns, and the two signatures coexist safely
because PostgREST resolves an overload by the parameter *names* in the
request body: the old client always sends `p_categories`, the new one
sends `p_filter`, and neither name exists in the other function. Drop the
shim once the new frontend is live everywhere — the `DROP` statement is
written out in the migration.

On the client the whole contract is `DeckFilter` in
`src/shared/types/deck.ts`. `cardRandomizer.ts` is down to `pickCards()`
and `countCards()` with no capability flags; `useTraining()` takes one
filter instead of eleven arguments; the route carries one state field.

### The picker is a screen of its own

`src/screens/DeckPickerScreen.tsx`. It used to be a block wedged into the
middle of `HomeScreen`, so it inherited the hero — logo, tagline and quote
rotator ate the top half, the options scrolled under the fold and the Play
button sat below them, off screen. The layout is now fixed: a header that
never scrolls (back · title · step bar), the body as the only scrolling
region, and a footer that always shows the deck size and the single
primary action.

The control vocabulary is one, too. A row that toggles something ends in a
check circle; a row that acts — a preset starts the game — ends in a
chevron; dense sets are chips with a tinted selected state; and the
country/league selects wear the same clothes as the rows instead of
looking like leftovers from a form. Before, four different treatments all
meant "selected".

### The flow

```
presets  ready decks in one tap — Всё подряд · Только знаменитые ·
         Только футболисты · ЧМ-2026 · Без футболистов · Легенды (Pro)
  ↓ «Собрать свою колоду»
1 who    players + three named groups of non-player categories
2 fame   the one axis, three steps, each showing what it would leave
3 refine players only: continent, country, league, traits (skipped
         entirely when the deck has no players)
```

Every option counts itself through `count_deck`, so a preset that would
deal nothing is disabled instead of starting an empty game, and the
number under the button is the deck.

Onboarding easing meets the wizard as a **pre-selected step**, not as a
floor applied on top of one: opening the picker highlights the
recognizability level the player's experience suggests, and that level is
exactly what gets dealt. The smooth `fameFloor()` decay survives only
where it stays invisible — the one-tap presets, which have no fame step to
show it in. Otherwise a newcomer would see "Любые" highlighted while the
deck was quietly capped, and the counter would describe a third thing.

## Follow-ups not in this change

* `pageviews`/`pageviews_i18n` are still refreshed by the scraper;
  `refresh_card_fame()` must run after every import or the percentile
  drifts. Wire it into `daily_enrich.py`.
* The deck holds visible duplicates (e.g. "Мохаммед Салах" and "Мохамед
  Салах" are two cards) — a data-quality issue independent of filtering.
* `cards.difficulty` is dead (`'medium'` everywhere) and can be dropped.
* Player counts per league remain source-skewed (England 524 vs
  Eredivisie 10); the filter is honest about what exists, but the
  collection needs balancing.
