"""Deterministic settlement rules for normalized football market selections.

The selection's line is expressed from the selected side's perspective for spreads.
All scores are regulation-time scores unless the rule definition explicitly says otherwise.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_FLOOR
from typing import Literal

Status = Literal["won", "lost", "push", "void", "half_won", "half_lost"]


def _decimal(value: Decimal | int | float | str | None) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _combine_quarter(first: Status, second: Status) -> Status:
    if "void" in (first, second):
        return "void"
    if first == second:
        return first
    pair = {first, second}
    if pair == {"won", "push"}:
        return "half_won"
    if pair == {"lost", "push"}:
        return "half_lost"
    raise ValueError(f"Cannot combine quarter-line outcomes: {first}, {second}")


def _settle_line(rule_type: str, selection_key: str, home_score: int, away_score: int,
                 line: Decimal) -> Status:
    if rule_type == "totals":
        adjusted = Decimal(home_score + away_score) - line
        if adjusted == 0:
            return "push"
        return "won" if (adjusted > 0) == (selection_key == "over") else "lost"
    selected_score, opponent_score = (
        (home_score, away_score) if selection_key == "home" else (away_score, home_score)
    )
    adjusted = Decimal(selected_score) + line - Decimal(opponent_score)
    if adjusted == 0:
        return "push"
    return "won" if adjusted > 0 else "lost"


def settle(
    rule_type: str,
    selection_key: str,
    home_score: int | None,
    away_score: int | None,
    line_value: Decimal | int | float | str | None = None,
) -> Status:
    """Settle one selection without mutating state; invalid/unavailable data is void."""
    if home_score is None or away_score is None or home_score < 0 or away_score < 0:
        return "void"
    if rule_type not in {
        "three_way_result", "two_way_result", "totals", "both_teams_to_score",
        "spread", "draw_no_bet", "double_chance", "correct_score",
    }:
        raise ValueError(f"Unsupported settlement rule: {rule_type}")

    if rule_type in {"three_way_result", "two_way_result", "draw_no_bet", "double_chance"}:
        result = "home" if home_score > away_score else "away" if away_score > home_score else "draw"
        if rule_type == "three_way_result":
            return "won" if selection_key == result else "lost"
        if rule_type == "two_way_result":
            if result == "draw":
                return "void"
            return "won" if selection_key == result else "lost"
        if rule_type == "draw_no_bet":
            if result == "draw":
                return "push"
            return "won" if selection_key == result else "lost"
        accepted = {"home_draw": {"home", "draw"}, "draw_away": {"draw", "away"},
                    "home_away": {"home", "away"}}
        if selection_key not in accepted:
            raise ValueError(f"Unsupported double-chance selection: {selection_key}")
        return "won" if result in accepted[selection_key] else "lost"

    if rule_type == "both_teams_to_score":
        if selection_key not in {"yes", "no"}:
            raise ValueError(f"Unsupported BTTS selection: {selection_key}")
        both = home_score > 0 and away_score > 0
        return "won" if (both == (selection_key == "yes")) else "lost"

    if rule_type == "totals":
        line = _decimal(line_value)
        if line is None or selection_key not in {"over", "under"}:
            raise ValueError("Totals require a numeric line and over/under selection")
        fraction = abs(line % Decimal(1))
        if fraction in {Decimal("0.25"), Decimal("0.75")}:
            lower = (line * 2).to_integral_value(rounding=ROUND_FLOOR) / 2
            upper = lower + Decimal("0.5")
            return _combine_quarter(
                _settle_line("totals", selection_key, home_score, away_score, Decimal(lower)),
                _settle_line("totals", selection_key, home_score, away_score, Decimal(upper)),
            )
        return _settle_line("totals", selection_key, home_score, away_score, line)

    if rule_type == "spread":
        line = _decimal(line_value)
        if line is None or selection_key not in {"home", "away"}:
            raise ValueError("Spread requires a numeric selection-side handicap")
        fraction = abs(line % Decimal(1))
        if fraction in {Decimal("0.25"), Decimal("0.75")}:
            lower = (line * 2).to_integral_value(rounding=ROUND_FLOOR) / 2
            upper = lower + Decimal("0.5")
            return _combine_quarter(
                _settle_line("spread", selection_key, home_score, away_score, Decimal(lower)),
                _settle_line("spread", selection_key, home_score, away_score, Decimal(upper)),
            )
        return _settle_line("spread", selection_key, home_score, away_score, line)

    # Correct-score selection is canonical "home-away", e.g. "2-1".
    if rule_type == "correct_score":
        try:
            expected_home, expected_away = (int(x) for x in selection_key.split("-", maxsplit=1))
        except (ValueError, TypeError):
            raise ValueError("Correct score selection must be 'home-away'") from None
        return "won" if (home_score, away_score) == (expected_home, expected_away) else "lost"

    raise AssertionError("unreachable")
