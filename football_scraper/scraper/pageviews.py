"""Wikipedia pageviews via the Wikimedia Pageviews REST API.

This source is free, key-less, and entirely SEPARATE from API-Football — it
does NOT touch the API-Football daily request budget. We still behave politely
toward Wikimedia, mirroring wikidata.py:
  * a contact User-Agent (same contact),
  * a >=1s pause between requests (do not weaken),
  * exponential-backoff retry on 429 / 5xx, honouring `Retry-After`,
  * an on-disk cache keyed by (project, article, window) so a re-run (or a
    dry-run followed by a real run) never re-fetches the same article+window,
  * a polite per-UTC-day request counter (WikimediaBudget).

Endpoint (per-article):
  GET {base}/metrics/pageviews/per-article/
      {project}/{access}/{agent}/{article}/{granularity}/{start}/{end}

  project      ru.wikipedia.org (preferred) or en.wikipedia.org (fallback)
  access       all-access
  agent        user            (excludes bots/spiders)
  granularity  monthly
  article      title, spaces -> underscores, then percent-encoded
  start/end    YYYYMMDD

Data is only available from 2015-07-01 onward, so a season window that starts
earlier is clamped to that epoch. A 404 means the article has no pageviews
data (missing article / out of range): we treat it as 0 views and FLAG the
absence (`found: False`) instead of crashing.
"""
import json
import os
import time
from datetime import date, datetime, timezone
from urllib.parse import quote

import requests

# Wikimedia Pageviews data does not exist before this date.
PAGEVIEWS_EPOCH = date(2015, 7, 1)

# Project hosts for the two Wikipedias we query.
PROJECT_RU = "ru.wikipedia.org"
PROJECT_EN = "en.wikipedia.org"


def _utc_today():
    """Today's date as YYYY-MM-DD in UTC (the counter's reset boundary)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def sum_views(payload):
    """Sum the `views` of every item in a Pageviews API payload.

    Pure function over the already-parsed JSON, so it can be unit-tested
    offline against fake responses. Missing / non-numeric `views` count as 0;
    a payload with no `items` sums to 0.
    """
    total = 0
    for item in (payload or {}).get("items", []):
        views = item.get("views")
        if isinstance(views, bool):
            continue  # bool is an int subclass — never a real view count
        if isinstance(views, (int, float)):
            total += int(views)
    return total


def season_window(season, window_cfg=None):
    """Return (start_date, end_date) for a season's pageviews window.

    Season N (the year it STARTS) spans, by default, N-08-01 to (N+1)-06-30 —
    the European football calendar. Configurable via window_cfg:
      start_month / start_day  (default 8 / 1)
      end_month   / end_day    (default 6 / 30)
      end_year_offset          (default 1 — the season crosses into year N+1)

    The start is clamped to PAGEVIEWS_EPOCH (2015-07-01) because the API has no
    data before then; an unclamped earlier date would 400.
    """
    cfg = window_cfg or {}
    start_month = int(cfg.get("start_month", 8))
    start_day = int(cfg.get("start_day", 1))
    end_month = int(cfg.get("end_month", 6))
    end_day = int(cfg.get("end_day", 30))
    end_year_offset = int(cfg.get("end_year_offset", 1))

    start = date(season, start_month, start_day)
    end = date(season + end_year_offset, end_month, end_day)
    if start < PAGEVIEWS_EPOCH:
        start = PAGEVIEWS_EPOCH
    return start, end


def resolve_article(player, enricher=None, allow_network=True):
    """Pick (project, article, source) for a players_meta row.

    Preference order (Russian first — the game ships Russian names):
      1. ru.wikipedia.org via `name_ru` (already the ruwiki sitelink title;
         no network needed).
      2. ru/en.wikipedia.org via the `wikidata_qid` sitelinks (one cached
         Wikidata call, only when allow_network and an enricher are given).
      3. en.wikipedia.org via `name_en` (last-resort fallback).

    Returns (project, article, source). source is one of:
      'name_ru', 'qid_ruwiki', 'qid_enwiki', 'name_en', or 'none'.
    `allow_network=False` (used by the dry-run plan) skips the Wikidata
    sitelink lookup so the plan stays fast and only counts what it can see.
    """
    name_ru = player.get("name_ru")
    if name_ru:
        return PROJECT_RU, name_ru, "name_ru"

    qid = player.get("wikidata_qid")
    if qid and allow_network and enricher is not None:
        titles = enricher.titles_for_qid(qid)
        if titles.get("ruwiki"):
            return PROJECT_RU, titles["ruwiki"], "qid_ruwiki"
        if titles.get("enwiki"):
            return PROJECT_EN, titles["enwiki"], "qid_enwiki"

    name_en = player.get("name_en")
    if name_en:
        return PROJECT_EN, name_en, "name_en"

    return None, None, "none"


class WikimediaBudget:
    """Polite per-UTC-day request counter for the Pageviews API.

    Wikimedia needs no key and is generous, but we still count our calls and
    hard-stop at a soft daily cap so a runaway loop can't hammer the service.
    Persisted per UTC day under cache/ and kept SEPARATE from the
    API-Football RequestBudget — different services, different tallies.
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
            return
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
            pass

    def consume(self):
        today = _utc_today()
        if today != self.date:
            self.date = today
            self.used = 0
        if self.used >= self.limit:
            raise RuntimeError(
                "Daily Wikimedia Pageviews request budget exhausted "
                "({} requests for {} UTC). Aborting to stay polite.".format(
                    self.limit, self.date
                )
            )
        self.used += 1
        self._save()


class WikiPagePropsClient:
    """Reads Wikipedia pageprops for a title: disambiguation flag and/or QID.

    Defaults to ruwiki; pass api_url/cache_prefix for another language
    edition (--cards-photos uses an enwiki instance as the fallback). A bare
    card name ("Челси") can land on a disambiguation page whose pageviews/QID
    are real but belong to the wrong page — so --cards-pageviews and
    --cards-photos must not take them. One MediaWiki API call per title:
        action=query & prop=pageprops & ppprop=... & redirects=1
    Same politeness as the pageviews client: contact User-Agent, >=1s pause,
    simple backoff retry, per-title on-disk cache (negative results too,
    namespaced per wiki via cache_prefix), and the shared WikimediaBudget so
    every network call is counted.
    A missing page is NOT a disambig (the pageviews 404 handles it).
    """

    API_URL = "https://ru.wikipedia.org/w/api.php"

    def __init__(self, user_agent, cache, min_pause=1.0, budget=None,
                 api_url=None, cache_prefix="ruwiki"):
        self.user_agent = user_agent
        self.min_pause = float(min_pause)
        self.cache = cache
        self.budget = budget
        self.api_url = api_url or self.API_URL
        self.cache_prefix = cache_prefix
        self.session = requests.Session()
        self._last = 0.0

    def _wait(self):
        now = time.monotonic()
        elapsed = now - self._last
        if elapsed < self.min_pause:
            time.sleep(self.min_pause - elapsed)
        self._last = time.monotonic()

    def _query(self, params):
        headers = {"User-Agent": self.user_agent}
        for attempt in range(1, 4):
            self._wait()
            if self.budget is not None:
                self.budget.consume()
            try:
                resp = self.session.get(
                    self.api_url, params=params, headers=headers, timeout=30
                )
                if resp.status_code == 429 or resp.status_code >= 500:
                    time.sleep(min(2 ** attempt, 30))
                    continue
                resp.raise_for_status()
                return resp.json()
            except requests.RequestException:
                if attempt == 3:
                    raise
                time.sleep(min(2 ** attempt, 30))
        return {}

    def is_disambiguation(self, title):
        cached = self.cache.get(self.cache_prefix + "_disambig", title)
        if cached is not None:
            return bool(cached.get("disambig"))

        data = self._query(
            {
                "action": "query",
                "format": "json",
                "titles": title,
                "prop": "pageprops",
                "ppprop": "disambiguation",
                "redirects": 1,
            }
        )

        disambig = False
        pages = ((data or {}).get("query") or {}).get("pages") or {}
        for page in pages.values():
            if "disambiguation" in (page.get("pageprops") or {}):
                disambig = True
                break

        self.cache.set(self.cache_prefix + "_disambig", title, {"disambig": disambig})
        return disambig

    def qid_for_title(self, title):
        """Resolve an article title to its Wikidata QID (--cards-photos).

        Follows redirects. Returns {"qid": str|None, "disambig": bool}:
        qid is None when the page does not exist or has no wikibase item;
        disambig=True flags a disambiguation page, whose QID belongs to the
        disambiguation entity, not the card — the caller must skip it and try
        the next title variant. Cached per title (namespace
        <cache_prefix>_pageprops), negative results too, so a re-run never
        re-asks about a missing page.
        """
        cached = self.cache.get(self.cache_prefix + "_pageprops", title)
        if cached is not None:
            return cached

        data = self._query(
            {
                "action": "query",
                "format": "json",
                "titles": title,
                "prop": "pageprops",
                "ppprop": "wikibase_item|disambiguation",
                "redirects": 1,
            }
        )

        qid = None
        disambig = False
        pages = ((data or {}).get("query") or {}).get("pages") or {}
        for page in pages.values():
            props = page.get("pageprops") or {}
            if "disambiguation" in props:
                disambig = True
            if not qid:
                qid = props.get("wikibase_item") or None

        result = {"qid": qid, "disambig": disambig}
        self.cache.set(self.cache_prefix + "_pageprops", title, result)
        return result

    def pageimage_for_title(self, title, size=256):
        """Infobox thumbnail URL for an article (prop=pageimages) — the
        --cards-photos fallback when the entity has a Wikipedia article but
        no Wikidata P18. PEOPLE CARDS ONLY: on enwiki the pageimage of a
        club/stadium is often a non-free (fair-use) logo we must not take.
        Returns the thumbnail URL (upload.wikimedia.org) or None. Cached per
        (size, title) (namespace <cache_prefix>_pageimage), negative results
        too; same pause, retry and budget contract as every other call."""
        key = "{}|{}".format(int(size), title)
        cached = self.cache.get(self.cache_prefix + "_pageimage", key)
        if cached is not None:
            return cached.get("url") or None

        data = self._query(
            {
                "action": "query",
                "format": "json",
                "titles": title,
                "prop": "pageimages",
                "piprop": "thumbnail",
                "pithumbsize": int(size),
                "redirects": 1,
            }
        )

        url = None
        pages = ((data or {}).get("query") or {}).get("pages") or {}
        for page in pages.values():
            source = (page.get("thumbnail") or {}).get("source")
            if source:
                url = source
                break

        self.cache.set(self.cache_prefix + "_pageimage", key, {"url": url})
        return url

    def search_titles(self, query, limit=3):
        """Full-text article search (action=query & list=search) — the LAST
        resort of the card resolvers, after every exact title variant missed:
        an alternative Russian spelling ("Садьо Мане") still finds the real
        article ("Мане, Садио"). Returns up to `limit` result titles in
        relevance order; the CALLER must filter them for closeness to the
        card name and skip disambiguations. Cached per (limit, query)
        (namespace <cache_prefix>_search), the empty result too; same pause,
        retry and budget contract as every other call."""
        key = "{}|{}".format(int(limit), query)
        cached = self.cache.get(self.cache_prefix + "_search", key)
        if cached is not None:
            return list(cached.get("titles") or [])

        data = self._query(
            {
                "action": "query",
                "format": "json",
                "list": "search",
                "srsearch": query,
                "srlimit": int(limit),
                "srprop": "",
            }
        )
        titles = [
            r.get("title")
            for r in (((data or {}).get("query") or {}).get("search") or [])
            if r.get("title")
        ]
        self.cache.set(self.cache_prefix + "_search", key, {"titles": titles})
        return titles


class PageviewsClient:
    """Fetches and sums Wikipedia pageviews for an article over a date window."""

    def __init__(self, cfg, cache, budget=None):
        self.base_url = cfg["base_url"].rstrip("/")
        self.user_agent = cfg["user_agent"]
        self.min_pause = float(cfg.get("min_pause_seconds", 1.0))
        self.access = cfg.get("access", "all-access")
        self.agent = cfg.get("agent", "user")
        self.granularity = cfg.get("granularity", "monthly")
        retry = cfg.get("retry", {})
        self.max_attempts = int(retry.get("max_attempts", 4))
        self.backoff_base = float(retry.get("backoff_base_seconds", 2.0))
        self.backoff_max = float(retry.get("backoff_max_seconds", 60))
        self.cache = cache
        self.budget = budget
        self.session = requests.Session()
        self._last = 0.0

    def _wait(self):
        now = time.monotonic()
        elapsed = now - self._last
        if elapsed < self.min_pause:
            time.sleep(self.min_pause - elapsed)
        self._last = time.monotonic()

    def _sleep_after(self, resp, attempt):
        """Back off, honouring Retry-After when the server sends it."""
        delay = None
        retry_after = resp.headers.get("Retry-After")
        if retry_after:
            try:
                delay = float(retry_after)
            except ValueError:
                delay = None  # HTTP-date form — fall back to exponential
        if delay is None:
            delay = min(self.backoff_base * (2 ** (attempt - 1)), self.backoff_max)
        time.sleep(delay)

    def _backoff(self, attempt):
        time.sleep(min(self.backoff_base * (2 ** (attempt - 1)), self.backoff_max))

    def _get(self, url):
        """GET a Pageviews URL. Returns parsed JSON, or None on a 404.

        404 is the API's "no data for this article/range" signal and must not
        crash the crawl. 429 / 5xx / network errors are retried with backoff.
        """
        headers = {"User-Agent": self.user_agent, "Accept": "application/json"}
        attempt = 0
        while True:
            attempt += 1
            self._wait()
            if self.budget is not None:
                self.budget.consume()
            try:
                resp = self.session.get(url, headers=headers, timeout=30)
            except requests.RequestException:
                if attempt >= self.max_attempts:
                    raise
                self._backoff(attempt)
                continue

            if resp.status_code == 404:
                return None
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt >= self.max_attempts:
                    resp.raise_for_status()
                self._sleep_after(resp, attempt)
                continue

            resp.raise_for_status()
            return resp.json()

    def views_for_window(self, project, article, start_date, end_date):
        """Total pageviews for `article` on `project` over [start, end].

        Returns a dict: {views, found, project, article}. A 404 (no data) maps
        to {views: 0, found: False, ...}. Result is cached per
        (project, article, window, access, agent, granularity).
        """
        start = start_date.strftime("%Y%m%d")
        end = end_date.strftime("%Y%m%d")
        cache_key = "|".join(
            [project, article, start, end, self.access, self.agent, self.granularity]
        )

        cached = self.cache.get("pageviews", cache_key)
        if cached is not None:
            return cached

        # Spaces -> underscores, then percent-encode everything (incl. '/').
        encoded = quote(article.replace(" ", "_"), safe="")
        url = "/".join(
            [
                self.base_url,
                "metrics",
                "pageviews",
                "per-article",
                project,
                self.access,
                self.agent,
                encoded,
                self.granularity,
                start,
                end,
            ]
        )

        payload = self._get(url)
        if payload is None:
            result = {
                "views": 0,
                "found": False,
                "project": project,
                "article": article,
            }
        else:
            result = {
                "views": sum_views(payload),
                "found": True,
                "project": project,
                "article": article,
            }

        self.cache.set("pageviews", cache_key, result)
        return result
