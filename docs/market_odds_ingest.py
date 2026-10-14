#!/usr/bin/env python3
"""Fetch one Odds API sport/region snapshot into normalized multi-market quotes.

Every request must reserve quota before it leaves the process. The configured
ODDS_API_REQUEST_UNITS must conservatively reflect the provider's cost for this
sport/region/markets combination. This script never settles bets.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
PROVIDER = "the_odds_api"
API_ROOT = "https://api.the-odds-api.com/v4/sports"


def sb(path: str, *, method: str = "GET", params: dict[str, str] | None = None,
       body: Any = None, prefer: str | None = None) -> Any:
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
               "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=90) as response:
        raw = response.read()
    return json.loads(raw) if raw else []


def reserve_budget(units: int, hard_limit: int, now: datetime) -> tuple[bool, str]:
    period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if period_start.month == 12:
        period_end = period_start.replace(year=period_start.year + 1, month=1)
    else:
        period_end = period_start.replace(month=period_start.month + 1)
    result = sb("rpc/reserve_provider_api_budget", method="POST", body={
        "p_provider": PROVIDER,
        "p_budget_key": "odds_api_v4_monthly",
        "p_period_start": period_start.isoformat(),
        "p_period_end": period_end.isoformat(),
        "p_hard_limit": hard_limit,
        "p_units": units,
    })
    return bool(result), period_start.isoformat()


def finish_budget(period_start: str, units: int, *, consumed: bool) -> None:
    rpc = "consume_provider_api_budget" if consumed else "release_provider_api_budget"
    result = sb(f"rpc/{rpc}", method="POST", body={
        "p_provider": PROVIDER,
        "p_budget_key": "odds_api_v4_monthly",
        "p_period_start": period_start,
        "p_units": units,
    })
    if result is False:
        raise RuntimeError(f"API budget {rpc} returned false")


def normalize_market(market_key: str) -> str:
    known = {
        "h2h": "three_way_result", "h2h_3_way": "three_way_result",
        "spreads": "spread", "alternate_spreads": "spread",
        "totals": "totals", "alternate_totals": "totals",
        "btts": "both_teams_to_score", "draw_no_bet": "draw_no_bet",
        "double_chance": "double_chance", "correct_score": "correct_score",
    }
    # Keep each provider-specific player prop key distinct for settlement rules.
    return known.get(market_key, market_key)


def normalize_selection(market_key: str, outcome_name: str, home: str, away: str) -> str:
    value = outcome_name.strip()
    low = value.casefold()
    if market_key in {"h2h", "h2h_3_way"}:
        if low == "draw":
            return "draw"
        if low == home.casefold():
            return "home"
        if low == away.casefold():
            return "away"
    if market_key in {"spreads", "alternate_spreads", "draw_no_bet"}:
        if low == home.casefold():
            return "home"
        if low == away.casefold():
            return "away"
    if market_key in {"totals", "alternate_totals"}:
        if low in {"over", "under"}:
            return low
    if market_key == "btts":
        if low in {"yes", "no"}:
            return low
    if market_key == "double_chance":
        normalized = low.replace(" ", "").replace("/", "_").replace("-", "_")
        aliases = {"1x": "home_draw", "x2": "draw_away", "12": "home_away",
                   "home_draw": "home_draw", "draw_away": "draw_away", "home_away": "home_away"}
        return aliases.get(normalized, normalized)
    if market_key == "correct_score":
        return value.replace(":", "-").replace(" ", "")
    return low.replace(" ", "_")


def normalize_events(events: list[dict[str, Any]], existing_fixture_ids: set[str],
                     snapshot_at: str) -> tuple[list[dict[str, Any]], int]:
    rows: list[dict[str, Any]] = []
    skipped_events = 0
    for event in events:
        fixture_id = str(event.get("id", ""))
        if not fixture_id or fixture_id not in existing_fixture_ids:
            skipped_events += 1
            continue
        home, away = str(event.get("home_team", "")), str(event.get("away_team", ""))
        commence_at = event.get("commence_time")
        if not home or not away or not commence_at:
            skipped_events += 1
            continue
        for bookmaker in event.get("bookmakers") or []:
            bookmaker_key = str(bookmaker.get("key") or bookmaker.get("title") or "unknown")
            for market in bookmaker.get("markets") or []:
                raw_market_key = str(market.get("key", ""))
                if not raw_market_key:
                    continue
                for outcome in market.get("outcomes") or []:
                    try:
                        price = float(outcome["price"])
                    except (KeyError, TypeError, ValueError):
                        continue
                    if not 1 < price <= 10000:
                        continue
                    name = str(outcome.get("name", ""))
                    if not name:
                        continue
                    point = outcome.get("point")
                    try:
                        line = float(point) if point is not None else None
                    except (TypeError, ValueError):
                        continue
                    rows.append({
                        "fixture_id": fixture_id,
                        "sport_key": str(event.get("sport_key") or ""),
                        "provider": PROVIDER,
                        "bookmaker_key": bookmaker_key,
                        "market_key": normalize_market(raw_market_key),
                        "selection_key": normalize_selection(raw_market_key, name, home, away),
                        "line_value": line,
                        "decimal_odds": price,
                        "snapshot_at": snapshot_at,
                        "commence_at": commence_at,
                        "source_event_id": fixture_id,
                        "raw_payload": {"source_market_key": raw_market_key, "outcome_name": name},
                    })
    return rows, skipped_events


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sport", required=True, help="Odds API sport key, e.g. soccer_epl")
    parser.add_argument("--regions", default="uk,eu")
    parser.add_argument("--markets", required=True,
                        help="Comma-separated provider market keys; request cost must be configured conservatively")
    parser.add_argument("--hard-limit", type=int, default=int(os.environ.get("ODDS_API_MONTHLY_LIMIT", "0")))
    parser.add_argument("--request-units", type=int, default=int(os.environ.get("ODDS_API_REQUEST_UNITS", "0")))
    args = parser.parse_args()
    if not SUPABASE_URL or not SUPABASE_KEY or not os.environ.get("ODDS_API_KEY"):
        parser.error("SUPABASE_URL, SUPABASE_KEY and ODDS_API_KEY are required")
    if args.hard_limit <= 0 or args.request_units <= 0:
        parser.error("Set ODDS_API_MONTHLY_LIMIT and conservative ODDS_API_REQUEST_UNITS (> 0)")
    now = datetime.now(timezone.utc)
    try:
        allowed, period_start = reserve_budget(args.request_units, args.hard_limit, now)
        if not allowed:
            print("API request blocked: monthly provider budget would be exceeded.", file=sys.stderr)
            return 3
        params = urllib.parse.urlencode({
            "apiKey": os.environ["ODDS_API_KEY"], "regions": args.regions,
            "markets": args.markets, "oddsFormat": "decimal", "dateFormat": "iso",
        })
        url = f"{API_ROOT}/{urllib.parse.quote(args.sport, safe='')}/odds/?{params}"
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "SherlockScholes/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                payload = json.loads(response.read())
                remaining = response.headers.get("x-requests-remaining")
                used = response.headers.get("x-requests-used")
        except Exception:
            # A timeout can still consume provider quota; count it conservatively.
            finish_budget(period_start, args.request_units, consumed=True)
            raise
        else:
            finish_budget(period_start, args.request_units, consumed=True)

        if not isinstance(payload, list):
            raise RuntimeError("Odds API response is not an event list")
        event_ids = [str(e.get("id")) for e in payload if e.get("id")]
        if not event_ids:
            print(json.dumps({"events": 0, "quotes": 0, "remaining": remaining, "used": used}))
            return 0
        fixture_filter = "in.(" + ",".join(event_ids) + ")"
        fixtures = sb("fixtures", params={"select": "id", "id": fixture_filter})
        existing_ids = {str(row["id"]) for row in fixtures}
        snapshot_at = datetime.now(timezone.utc).isoformat()
        quotes, skipped = normalize_events(payload, existing_ids, snapshot_at)
        inserted = 0
        for offset in range(0, len(quotes), 100):
            batch = quotes[offset:offset + 100]
            result = sb("market_odds_quote", method="POST", params={
                "on_conflict": "fixture_id,provider,bookmaker_key,market_key,selection_key,line_key,snapshot_at"
            }, body=batch, prefer="resolution=merge-duplicates,return=representation")
            inserted += len(result) if isinstance(result, list) else len(batch)
        print(json.dumps({
            "sport": args.sport, "markets_requested": args.markets, "events_received": len(payload),
            "events_skipped_not_in_fixtures": skipped, "quotes_normalized": len(quotes),
            "quotes_upserted": inserted, "provider_requests_used_header": used,
            "provider_requests_remaining_header": remaining, "snapshot_at": snapshot_at,
        }, indent=2))
        return 0
    except (KeyError, ValueError, RuntimeError, urllib.error.URLError, urllib.error.HTTPError) as exc:
        print(f"odds ingest failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
