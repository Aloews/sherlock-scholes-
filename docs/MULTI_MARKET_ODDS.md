# Multi-market odds ingestion and settlement

## Data model

- `market_odds_quote`: append-only timestamped bookmaker quotes. Every row includes fixture,
  sport, provider, bookmaker, normalized market, selection, optional line, decimal odds, snapshot
  time and source metadata. Snapshots are retained for backtesting; a new quote does not overwrite
  an earlier quote.
- `market_settlement_rule`: versioned rule definition by normalized market key.
- `market_selection_result`: one settled selection per fixture/market/selection/rule version.
- `provider_api_budget`: provider-wide hard limits with atomic quota reservation before a request.
  Reservations are consumed after an attempted request, including timeouts, to avoid undercounting.

The migration is not applied by these code changes. Apply it only through the reviewed migration
process after staging verification.

## Supported normalized markets

The ingestion adapter maps common Odds API keys to normalized market types:

- `h2h` → three-way result (home/draw/away)
- `spreads` → spread / handicap
- `totals` → over/under with an explicit line
- `btts` → both teams to score
- `draw_no_bet` → draw-no-bet
- `double_chance` → home/draw, draw/away, home/away
- `correct_score` → exact score
- `player_*` → provider-specific player prop key (requires a matching settlement rule before use)

The quote collector does not imply every market is available for every fixture. Unknown fixture IDs
are skipped rather than inserted without a canonical fixture record.

## Ingestion

Configure `SUPABASE_URL`, `SUPABASE_KEY`, `ODDS_API_KEY`, `ODDS_API_MONTHLY_LIMIT`, and
`ODDS_API_REQUEST_UNITS`. The request-unit value must conservatively match the provider's cost for
the selected sport, region and market combination. The collector blocks the request if its budget
reservation fails.

```bash
python docs/market_odds_ingest.py \
  --sport soccer_epl \
  --regions uk,eu \
  --markets h2h,spreads,totals,btts \
  --hard-limit "$ODDS_API_MONTHLY_LIMIT" \
  --request-units "$ODDS_API_REQUEST_UNITS"
```

Start with one sport and a small set of markets. Confirm provider quota headers against the configured
unit cost before enabling scheduled collection. The current script makes one request per invocation;
it does not fan out across sports automatically.

## Settlement rules

`docs/market_settlement.py` implements deterministic settlement for three-way result, two-way result,
totals, BTTS, spread, draw-no-bet, double chance and correct score. Quarter-line totals and spreads
split into two half-lines and can return `half_won` / `half_lost`. Missing scores settle as `void`.
All settlement assumes regulation time unless a market definition explicitly says otherwise.

Before enabling any new market in production:
1. Define and version its settlement rule.
2. Add fixtures covering wins, losses, pushes, voids, half wins and half losses where relevant.
3. Verify provider selection names and line semantics against raw payloads.
4. Backfill historical outcomes only from a trusted results source.
5. Keep each bookmaker quote's original timestamp; do not use post-kickoff prices in pre-match backtests.
