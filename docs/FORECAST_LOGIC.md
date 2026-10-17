# Forecast pipeline

## Prediction models

### LLM-style linear model

A ridge-regression model estimates match-goal outcomes from historical team features. Its regularization parameter is selected on a chronological validation window. Evaluation uses a later untouched time window.

### Interpretable model

The second outcome model combines home/away venue form, expected goal difference, and draw frequency. Its thresholds are selected on the validation window. It can abstain when the signal is weak; coverage is reported alongside accuracy.

## Evaluation rules

- Split by time, never randomly.
- Features for a match must use only information available before kickoff.
- Store a forecast before the match and never rewrite its pick after the result.
- Keep retrospective backfills marked separately from genuinely pre-match forecasts.
- Report accuracy, calibration, sample size, and coverage together.
- Do not select parameters on the final test window.

## Virtual LLM bankroll

The LLM prediction is evaluated with a simulated balance starting at 10,000 virtual credits. Once a match is graded, settlement uses the latest price captured before kickoff and the calibrated confidence when available.

Position sizing uses quarter-Kelly with a strict 2% balance cap. A position is opened only when estimated probability implies positive expected value at the recorded price. Profits and losses are virtual; no deposits, withdrawals, real bets, or bookmaker orders are made.

The bankroll is a measurable reward signal for comparing calibration and risk policies. It does not directly update the weights of an external LLM. Any policy update must be selected on earlier data and validated on a later, untouched time window to avoid overfitting.

## Nightly order

1. Grade predictions for completed matches.
2. Refit confidence calibration from already graded forecasts.
3. Settle eligible virtual positions idempotently.
4. Create forecasts for upcoming matches.
