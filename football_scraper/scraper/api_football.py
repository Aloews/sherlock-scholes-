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
import time

import requests


class RateLimiter:
    """Guarantees at least `min_pause` seconds between successive calls."""

    def __init__(self, min_pause_seconds):
        self.min_pause = float(min_pause_seconds)
        self._last = 0.0

    def wait(self):
        now = time.monotonic()
        elapsed = now - self._last
        if elapsed < self.min_pause:
            time.sleep(self.min_pause - elapsed)
        self._last = time.monotonic()


class RequestBudget:
    """Hard cap on the number of real network requests per process run."""

    def __init__(self, limit):
        self.limit = int(limit)
        self.used = 0

    def consume(self):
        if self.used >= self.limit:
            raise RuntimeError(
                "Daily API-Football request budget exhausted "
                "({} requests). Aborting to protect the free tier.".format(self.limit)
            )
        self.used += 1


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
                raise RuntimeError(
                    "API-Football error for /{}: {}".format(endpoint, errors)
                )

            self.cache.set("api_football", cache_key, data)
            return data
