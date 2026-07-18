"""
ratings.py — derive a per-season "play level" and "popularity" score per player.

IMPORTANT honesty principle (same as the esports project):
these are TRANSPARENT, DERIVED metrics computed from real public stats — they are
NOT invented numbers and NOT a definitive judgement of a player. Each score records
which inputs were actually available, so a thin season produces a clearly-flagged
low-confidence score instead of a fake-precise one.

- play_level: a normalized blend of on-pitch performance stats for that season.
- popularity: a normalized blend of public-attention PROXIES (pageviews, transfer
  value, minutes share). Popularity is inherently an estimate from indirect signals,
  never a hard measurement — the output flags it as such.
"""


def _norm(value, lo, hi):
    """Clamp + scale a raw value into 0..100."""
    if value is None or hi == lo:
        return None
    v = max(lo, min(hi, value))
    return round((v - lo) / (hi - lo) * 100, 1)


def play_level(season_stats):
    """
    season_stats: dict of real per-season fields (any may be missing):
      rating_avg (provider match rating, ~6.0-8.0), goals, assists,
      minutes, appearances
    Returns: {score, confidence, inputs_used}
    """
    parts = []
    used = []

    if season_stats.get("rating_avg") is not None:
        parts.append(_norm(season_stats["rating_avg"], 6.0, 8.0) * 0.45)
        used.append("rating_avg")
    if season_stats.get("goals") is not None and season_stats.get("appearances"):
        per90_goal = season_stats["goals"] / max(season_stats["appearances"], 1)
        parts.append((_norm(per90_goal, 0, 1.0) or 0) * 0.2)
        used.append("goals")
    if season_stats.get("assists") is not None and season_stats.get("appearances"):
        per_app_assist = season_stats["assists"] / max(season_stats["appearances"], 1)
        parts.append((_norm(per_app_assist, 0, 0.7) or 0) * 0.15)
        used.append("assists")
    if season_stats.get("minutes") is not None:
        parts.append((_norm(season_stats["minutes"], 0, 3420) or 0) * 0.2)  # 38*90
        used.append("minutes")

    if not parts:
        return {"score": None, "confidence": "none", "inputs_used": []}

    score = round(sum(parts), 1)
    # confidence reflects how many of the 4 signal groups we actually had
    conf = {4: "high", 3: "good", 2: "medium", 1: "low"}.get(len(used), "low")
    return {"score": score, "confidence": conf, "inputs_used": used}


def popularity(signals):
    """
    signals: dict of public-attention PROXIES (any may be missing):
      wikipedia_pageviews (season total), transfer_value (EUR),
      minutes_share (0..1 of team minutes), team_prominence (0..100, e.g. league position inverse)
    Returns: {score, confidence, inputs_used, note}
    """
    parts = []
    used = []

    if signals.get("wikipedia_pageviews") is not None:
        # log-ish scaling: 0..3,000,000 season views
        parts.append((_norm(signals["wikipedia_pageviews"], 0, 3_000_000) or 0) * 0.4)
        used.append("wikipedia_pageviews")
    if signals.get("transfer_value") is not None:
        parts.append((_norm(signals["transfer_value"], 0, 200_000_000) or 0) * 0.3)
        used.append("transfer_value")
    if signals.get("minutes_share") is not None:
        parts.append((_norm(signals["minutes_share"], 0, 1.0) or 0) * 0.15)
        used.append("minutes_share")
    if signals.get("team_prominence") is not None:
        parts.append((signals["team_prominence"]) * 0.15)
        used.append("team_prominence")

    if not parts:
        return {"score": None, "confidence": "none", "inputs_used": [],
                "note": "no public-attention signals available this season"}

    score = round(sum(parts), 1)
    conf = {4: "high", 3: "good", 2: "medium", 1: "low"}.get(len(used), "low")
    return {
        "score": score,
        "confidence": conf,
        "inputs_used": used,
        "note": "popularity is a proxy estimate from public signals, not a definitive measure"
    }
