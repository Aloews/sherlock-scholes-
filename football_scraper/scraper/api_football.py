"""API-Football (api-sports.io) client.

Built-in protections for the free tier (100 req/day, 10 req/min) — DO NOT
weaken these:
  * RateLimiter   — enforces a minimum pause between network calls.
  * RequestBudget — hard stop once the daily request budget is reached.
  * retry         — exponential backoff on 429 / 5xx / network errors.
  * cache         — successful responses are served from disk, free of charge.

The API key is read from the environment by the caller and passed in; it is
never stored in code or committed.
"""
import json
import os
import time
from datetime import datetime, timezone

import requests


def _utc_today():
    """Today's date as YYYY-MM-DD in UTC (the budget's reset boundary)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


class PlanLimitError(RuntimeError):
    """Raised when API-Football rejects a request because of a plan limit.

    Example on the free tier: requesting page > 3 returns HTTP 200 with
    `errors.plan` set. Callers can catch this to degrade gracefully (stop
    paginating and keep what was already collected) instead of crashing.
    """


class RateLimiter:
    """Guarantees at least `min_pause` seconds between successive calls.

    Optionally calls `on_long_pause(delay)` just BEFORE a sleep that lasts at
    least `long_pause_threshold` seconds. This is purely cosmetic — a hook so
    the runner can tell the user "still waiting on the rate limiter" instead of
    going silent during the (deliberately long) free-tier pause. It does NOT
    change how long we sleep; the pause is never shortened.
    """

    def __init__(self, min_pause_seconds, on_long_pause=None,
                 long_pause_threshold=3.0):
        self.min_pause = float(min_pause_seconds)
        self._last = 0.0
        self.on_long_pause = on_long_pause
        self.long_pause_threshold = float(long_pause_threshold)

    def wait(self):
        now = time.monotonic()
        elapsed = now - self._last
        if elapsed < self.min_pause:
            delay = self.min_pause - elapsed
            if self.on_long_pause is not None and delay >= self.long_pause_threshold:
                self.on_long_pause(delay)
            time.sleep(delay)
        self._last = time.monotonic()


class RequestBudget:
    """Hard cap on real network requests, persisted per UTC day.

    Counting only within a single process run is not enough: several runs in
    the same day could together blow the real free-tier quota (100/day). So
    the used count is stored on disk keyed by the UTC date and reloaded on
    start — runs on the same day keep counting up to the shared limit; a new
    UTC day resets the tally to 0.

    Only real network calls reach consume(); cached responses never do, so the
    on-disk cache still serves repeated runs without spending budget.
    """

    def __init__(self, limit, state_path=None):
        self.limit = int(limit)
        self.state_path = state_path
        self.date = _utc_today()
        self.used = 0
        self._load()

    def _load(self):
        if not self.state_path:
            return
        try:
            with open(self.state_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            # Missing or corrupt state file -> start today's tally at 0.
            return
        # Continue today's count; a stale date is ignored (i.e. reset to 0).
        if isinstance(data, dict) and data.get("date") == self.date:
            try:
                self.used = int(data.get("used", 0))
            except (TypeError, ValueError):
                self.used = 0

    def _save(self):
        if not self.state_path:
            return
        try:
            os.makedirs(os.path.dirname(self.state_path), exist_ok=True)
            with open(self.state_path, "w", encoding="utf-8") as fh:
                json.dump({"date": self.date, "used": self.used}, fh)
        except OSError:
            # A failed persist must not crash the crawl; the in-memory cap is
            # still enforced for the remainder of this run.
            pass

    def consume(self):
        # Roll the tally over if a long run crosses midnight UTC.
        today = _utc_today()
        if today != self.date:
            self.date = today
            self.used = 0
        if self.used >= self.limit:
            raise RuntimeError(
                "Daily API-Football request budget exhausted "
                "({} requests for {} UTC). Aborting to protect the free "
                "tier.".format(self.limit, self.date)
            )
        self.used += 1
        self._save()


class ApiFootballClient:
    def __init__(self, base_url, api_key, cache, rate_limiter, retry_cfg, budget):
        self.base_url = base_url.rstrip("/")
        self.headers = {"x-apisports-key": api_key}
        self.cache = cache
        self.rate_limiter = rate_limiter
        self.budget = budget
        self.max_attempts = int(retry_cfg["max_attempts"])
        self.backoff_base = float(retry_cfg["backoff_base_seconds"])
        self.backoff_max = float(retry_cfg["backoff_max_seconds"])
        self.session = requests.Session()

    def _backoff(self, attempt):
        delay = min(self.backoff_base * (2 ** (attempt - 1)), self.backoff_max)
        time.sleep(delay)

    def get(self, endpoint, params=None):
        params = params or {}
        cache_key = endpoint + "?" + json.dumps(params, sort_keys=True)

        cached = self.cache.get("api_football", cache_key)
        if cached is not None:
            return cached

        url = self.base_url + "/" + endpoint.lstrip("/")
        attempt = 0
        while True:
            attempt += 1
            self.rate_limiter.wait()
            self.budget.consume()
            try:
                resp = self.session.get(
                    url, headers=self.headers, params=params, timeout=30
                )
            except requests.RequestException:
                if attempt >= self.max_attempts:
                    raise
                self._backoff(attempt)
                continue

            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt >= self.max_attempts:
                    resp.raise_for_status()
                self._backoff(attempt)
                continue

            resp.raise_for_status()
            data = resp.json()

            # API-Football reports logical errors in the `errors` field (HTTP 200).
            errors = data.get("errors")
            if errors:
                if isinstance(errors, dict) and errors.get("plan"):
                    raise PlanLimitError(
                        "API-Football plan limit for /{}: {}".format(
                            endpoint, errors["plan"]
                        )
                    )
                raise RuntimeError(
                    "API-Football error for /{}: {}".format(endpoint, errors)
                )

            self.cache.set("api_football", cache_key, data)
            return data
