# Multi-market odds and settlement

## Storage model

The current fixture_odds table stores only 1X2 prices. The proposed market_odds table stores one quote per fixture, observation time, provider, region, bookmaker, market, selection and line. It preserves snapshots rather than overwriting prices, so backtests can use only information available before kickoff.

Initial additional markets:

- totals: Over/Under with the exact line.
- spreads: home/away handicap with the outcome's signed point.
- btts: both teams to score, Yes/No.
- draw_no_bet: home/away; a draw pushes.
- Existing h2h remains in fixture_odds and is not duplicated by the new collector.

The collector is currently restricted to the EU region and a fixed set of ten competitions. Regional expansion should be a separate quota decision.

## Request budget

Every paid request reserves one credit through the existing atomic spend_odds_credits(1) RPC before the provider call. The same monthly 500-credit cap is shared with score fetching and existing 1X2 collection. The expansion collector:

- fails closed if it cannot read the budget;
- leaves the configured 80-credit reserve untouched;
- makes at most four additional market/competition requests per invocation by default (hard cap eight);
- rotates across market/competition pairs using persistent cursor state;
- never logs the API key or quote prices.

The additional markets are not queried on every league every day: quota is a hard cap, not a target. The rotation gradually covers the configured market/competition matrix.

## Settlement contract

settle_market_pick returns a state, not a boolean:

- win, loss: settled result;
- push: stake returned under the market rules;
- pending: score unavailable;
- unsupported or unsupported_line: rule/line is not implemented and must not be silently scored as a loss.

Totals and spreads support whole and half-point lines in the initial implementation. Quarter-line Asian settlement is explicitly marked unsupported until split-stake settlement (half win/half loss) is implemented and tested. The provider's exact point is stored with each outcome.

## Deployment sequence

1. Review and apply supabase/migrations/zz_player_enrichment_markets_finetuning.sql to a non-production project first.
2. Deploy football-market-expansion with ODDS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and optionally MARKET_REQUESTS_PER_RUN.
3. Invoke it using the service-role bearer token only; never from the browser.
4. Validate returned row counts, unique snapshots, market/selection/line mapping and settlement fixtures before enabling a schedule.
5. Confirm monthly spend remains below the existing shared budget. A hard budget stop is expected behavior.

Odds remain internal and are not exposed to the client UI.
