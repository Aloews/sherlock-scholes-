# LLM virtual bankroll

The forecasting pipeline maintains a simulated account denominated in virtual credits. The account is isolated from real payment and betting systems.

## Settlement

- Starting balance: 10,000 credits.
- Only forecasts recorded before kickoff are eligible; retrospective backfills are excluded.
- Settlement uses the latest available bookmaker price captured before kickoff. Odds are read only by a privileged database function and are never returned by the summary RPC.
- Confidence is calibrated using the existing model calibration when available.
- Position sizing uses one quarter of Kelly, capped at 2% of the current balance per match. No positive expected edge means no position.
- Correct predictions earn stake × (decimal odds − 1); incorrect predictions lose only the virtual stake.
- Every eligible forecast is recorded once, including forecasts for which no position was placed. A unique fixture key makes settlement idempotent.
- The balance and ledger are updated atomically by PostgreSQL. Only the service role can execute settlement or read the summary.

## Learning objective

The balance is an evaluation signal, not a gradient for an external language model. It supports walk-forward comparison of calibration and stake-sizing policies. Policy changes must be selected on historical training windows and accepted only after a later untouched evaluation window; optimizing against the same ledger used for reporting would overfit.

No real bets, deposits, withdrawals, payments, or bookmaker orders are executed.
