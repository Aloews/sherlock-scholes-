"""
fetcher.py — polite HTTP access layer for the football scraper.

This is the part worth reusing from the esports project: it is what stops your
connection dropping and your IP getting rate-limited. The rules:
  - a delay between every request (configurable, default 2.5s)
  - exponential backoff + retry on 429 / 5xx
  - a real User-Agent with a contact email (many APIs require this)
  - on-disk caching so an identical request is never paid for / fetched twice
  - a daily request cap as a safety brake

Works against an official API (recommended) by passing the provider's auth header.
Never hammers a source. If a request keeps failing, it gives up gracefully and
logs it rather than spinning.
"""

import json
import os
import time
import hashlib
import urllib.request
import urllib.error
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
CACHE_DIR = BASE / "cache"
CACHE_DIR.mkdir(exist_ok=True)


class PoliteFetcher:
    def __init__(self, config):
        s = config["source"]
        p = config["politeness"]
        self.base_url = s["base_url"].rstrip("/")
        self.user_agent = s["user_agent"]
        self.api_key = os.environ.get(s["api_key_env"], "")
        self.provider = s["provider"]
        self.delay = p["delay_seconds"]
        self.max_retries = p["max_retries"]
        self.backoff_base = p["retry_backoff_base"]
        self.respect_429 = p["respect_429"]
        self.daily_cap = p["daily_request_cap"]
        self._count = 0
        self._last_request = 0.0

    # ---- cache helpers -----------------------------------------------------
    def _cache_path(self, url, params):
        key = hashlib.sha1(f"{url}::{json.dumps(params, sort_keys=True)}".encode()).hexdigest()
        return CACHE_DIR / f"{key}.json"

    def _read_cache(self, path):
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                return None
        return None

    def _write_cache(self, path, data):
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    # ---- the one method everything calls -----------------------------------
    def get(self, endpoint, params=None, use_cache=True):
        params = params or {}
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        cache_path = self._cache_path(url, params)

        if use_cache:
            cached = self._read_cache(cache_path)
            if cached is not None:
                return cached  # never re-fetch what we already have

        if self._count >= self.daily_cap:
            raise RuntimeError(f"daily_request_cap ({self.daily_cap}) reached — stopping to stay polite")

        # build request with provider auth + required headers
        full = url
        if params:
            from urllib.parse import urlencode
            full = f"{url}?{urlencode(params)}"

        headers = {"User-Agent": self.user_agent, "Accept": "application/json"}
        if self.provider == "api_football" and self.api_key:
            headers["x-apisports-key"] = self.api_key
        elif self.provider == "football_data" and self.api_key:
            headers["X-Auth-Token"] = self.api_key

        # polite spacing between requests
        wait = self.delay - (time.time() - self._last_request)
        if wait > 0:
            time.sleep(wait)

        attempt = 0
        while attempt <= self.max_retries:
            try:
                req = urllib.request.Request(full, headers=headers)
                with urllib.request.urlopen(req, timeout=30) as resp:
                    self._last_request = time.time()
                    self._count += 1
                    data = json.loads(resp.read().decode("utf-8"))
                    if use_cache:
                        self._write_cache(cache_path, data)
                    return data
            except urllib.error.HTTPError as e:
                # 429 = rate limited, 5xx = server hiccup -> back off and retry
                if e.code == 429 or 500 <= e.code < 600:
                    sleep = self.backoff_base ** attempt
                    print(f"  [{e.code}] backing off {sleep}s (attempt {attempt + 1}/{self.max_retries})")
                    time.sleep(sleep)
                    attempt += 1
                    continue
                print(f"  [{e.code}] non-retryable on {endpoint} — skipping")
                return None
            except (urllib.error.URLError, TimeoutError) as e:
                sleep = self.backoff_base ** attempt
                print(f"  [network] {e} — retry in {sleep}s")
                time.sleep(sleep)
                attempt += 1

        print(f"  gave up on {endpoint} after {self.max_retries} retries")
        return None

    @property
    def requests_made(self):
        return self._count
