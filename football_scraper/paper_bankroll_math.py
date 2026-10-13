from __future__ import annotations


def stake_for(balance: float, probability: float, decimal_odds: float | None) -> float:
    if balance < 1 or decimal_odds is None or decimal_odds <= 1:
        return 0.0
    p = min(1.0, max(0.0, probability))
    kelly = (p * decimal_odds - 1.0) / (decimal_odds - 1.0)
    if kelly <= 0:
        return 0.0
    stake = round(balance * min(0.02, kelly * 0.25), 2)
    return stake if stake >= 1.0 else 0.0


def settlement_profit(stake: float, decimal_odds: float, won: bool) -> float:
    if stake < 0 or decimal_odds <= 1:
        raise ValueError("stake must be non-negative and decimal_odds must exceed 1")
    return round(stake * (decimal_odds - 1.0), 2) if won else -round(stake, 2)
