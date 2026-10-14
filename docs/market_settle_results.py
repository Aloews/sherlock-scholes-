#!/usr/bin/env python3
"""Settle stored football-market selections from completed fixture scores.

Requires the multi-market migration to be applied. Only quotes captured before
kickoff are eligible. Player props are skipped until a matching stat-result
adapter exists; final scores alone cannot settle player props.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime
import os
import sys
import urllib.parse
import urllib.request
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from market_settlement import settle


def sb(path: str, *, method: str = "GET", params: dict[str, str] | None = None,
       body: Any = None, prefer: str | None = None) -> Any:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_KEY"]
    url = f"{base}/rest/v1/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=90) as response:
        raw = response.read()
    return json.loads(raw) if raw else []


def actual_value(rule_type: str, home_score: int, away_score: int) -> float | None:
    if rule_type == "totals":
        return float(home_score + away_score)
    if rule_type == "spread":
        return float(home_score - away_score)
    if rule_type == "both_teams_to_score":
        return float(home_score > 0 and away_score > 0)
    return None


def parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def rule_for_fixture(rules: dict[str, list[dict[str, Any]]], market_key: str,
                     commence_at: str) -> dict[str, Any] | None:
    kickoff = parse_timestamp(commence_at)
    eligible = [rule for rule in rules.get(market_key, [])
                if parse_timestamp(rule["effective_from"]) <= kickoff]
    return max(eligible, key=lambda row: (parse_timestamp(row["effective_from"]), row["rule_version"])) if eligible else None


def settle_fixture(fixture: dict[str, Any], rules: dict[str, list[dict[str, Any]]]) -> tuple[list[dict[str, Any]], int]:
    commence_at = fixture.get("commence_at")
    if not fixture.get("completed") or fixture.get("home_score") is None or fixture.get("away_score") is None:
        return [], 0
    if not commence_at:
        return [], 0
    quotes = sb("rpc/market_quotes_for_settlement", method="POST",
                body={"p_fixture_id": fixture["id"]})
    candidates = {}
    for quote in quotes:
        key = (quote["market_key"], quote["selection_key"], quote.get("line_value"))
        candidates.setdefault(key, set()).add((quote["provider"], quote["bookmaker_key"]))
    results = []
    skipped = 0
    for (market_key, selection_key, line_value), sources in candidates.items():
        rule = rule_for_fixture(rules, market_key, commence_at)
        if not rule:
            skipped += 1
            continue
        rule_type = rule["rule_type"]
        if rule_type == "player_prop":
            skipped += 1
            continue
        status = settle(rule_type, selection_key, fixture["home_score"], fixture["away_score"], line_value)
        results.append({
            "fixture_id": fixture["id"],
            "market_key": market_key,
            "selection_key": selection_key,
            "line_value": line_value,
            "rule_version": rule["rule_version"],
            "status": status,
            "actual_value": actual_value(rule_type, fixture["home_score"], fixture["away_score"]),
            "source": "fixtures",
            "settled_at": fixture.get("scores_at"),
            "evidence": {
                "period": "regulation",
                "home_score": fixture["home_score"],
                "away_score": fixture["away_score"],
                "pre_kickoff_quote_sources": len(sources),
                "commence_at": commence_at,
            },
        })
    return results, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-id", default="", help="settle one fixture only")
    parser.add_argument("--limit", type=int, default=100, help="maximum completed fixtures to process (1-500)")
    parser.add_argument("--confirm-regulation-scores", action="store_true",
                        help="assert fixture scores are regulation-time scores for the selected competition")
    args = parser.parse_args()
    if not args.confirm_regulation_scores:
        parser.error("verify the score source first and pass --confirm-regulation-scores")
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_KEY"):
        parser.error("SUPABASE_URL and SUPABASE_KEY are required")
    if not 1 <= args.limit <= 500:
        parser.error("--limit must be between 1 and 500")
    try:
        rules_rows = sb("market_settlement_rule", params={
            "select": "market_key,rule_version,rule_type,effective_from",
            "order": "market_key.asc,effective_from.asc,rule_version.asc",
            "limit": "1000",
        })
        rules: dict[str, list[dict[str, Any]]] = {}
        for row in rules_rows:
            rules.setdefault(row["market_key"], []).append(row)
        filters = {
            "select": "id,home_score,away_score,completed,scores_at,commence_at",
            "completed": "eq.true",
            "home_score": "not.is.null",
            "away_score": "not.is.null",
            "order": "scores_at.desc.nullslast,id.asc",
            "limit": str(args.limit),
        }
        if args.fixture_id:
            filters["id"] = f"eq.{args.fixture_id}"
        fixtures = sb("fixtures", params=filters)
        total_written = total_skipped = 0
        for fixture in fixtures:
            rows, skipped = settle_fixture(fixture, rules)
            total_skipped += skipped
            for offset in range(0, len(rows), 100):
                batch = rows[offset:offset + 100]
                written = sb("market_selection_result", method="POST", params={
                    "on_conflict": "fixture_id,market_key,selection_key,line_key,rule_version"
                }, body=batch, prefer="resolution=merge-duplicates,return=representation")
                total_written += len(written) if isinstance(written, list) else len(batch)
        print(json.dumps({
            "fixtures_checked": len(fixtures),
            "settlement_rows_upserted": total_written,
            "selections_skipped_without_rule_or_player_stat_adapter": total_skipped,
            "note": "Only pre-kickoff quotes and rules effective at kickoff were used; player props require separate stat-result sources.",
        }, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"market settlement failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
