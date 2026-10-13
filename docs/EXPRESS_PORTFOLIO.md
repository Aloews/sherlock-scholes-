# Bookmaker-line express portfolios

The forecast board has three separate portfolio profiles:

- **Higher market probability** selects the most likely 1X2 outcome per fixture, then chooses legs from different competitions.
- **Diversified outcomes** requires different 1X2 outcome classes (home win, draw, away win) and different competitions where the available line permits it.
- **LLM disagreement** only includes the LLM's pre-match pick when its calibrated probability exceeds the market's no-margin probability by at least two percentage points.

The panel is administrator-only. It uses all bookmaker rows in the latest available pre-kickoff snapshot: market probabilities come from the median-price consensus, while the combined price uses the best observed price for each selected outcome. The combined price may therefore require placing different legs with different bookmakers.

Historical performance is evaluated as three-leg weekly tickets from historical pre-kickoff odds and completed scores. The displayed hit rate is withheld until there are at least ten historical tickets; the sample count remains visible. Current estimated probability is the product of the market probabilities, an independence approximation across different fixtures. It is not a guarantee and does not account for every shared source of risk.

## Current data boundary

The collector currently stores the 1X2 market (home/draw/away) across the bookmakers returned by the provider. It does **not** yet collect totals, Asian handicaps, or both-teams-to-score markets. The panel must not imply otherwise. Expanding to those markets requires a separate storage schema, result settlement rules, and a monthly API-credit budget check.

## Learning loop

The LLM model pipeline continues to refit on historical match data and recalibrate confidence on a chronological schedule. The virtual bankroll supplies a separate reward signal for the stake-sizing policy: recent virtual returns can reduce or cautiously increase the Kelly fraction and confidence floor. This updates risk policy, not the weights of an external hosted LLM. Model or policy changes must be judged on later, untouched time windows rather than the same results used to tune them.
