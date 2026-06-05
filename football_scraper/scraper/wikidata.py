"""Russian-name enrichment via Wikidata.

For an English player name we:
  1. wbsearchentities (en) -> candidate QIDs.
  2. wbgetentities (claims|sitelinks) for those candidates.
  3. keep the first candidate whose occupation P106 == Q937857 (footballer).
  4. read sitelinks.ruwiki.title as name_ru.

Results are cached per English name. Wikidata calls are polite: a contact
User-Agent and a >=1s pause between requests (do not weaken).

Confidence rules (per methodology):
  * footballer match WITH a ruwiki article -> name_ru set, source=wikidata, high
  * no russian article (or no footballer match) -> name_ru=null, source=none, low
    (we do NOT transliterate at the pilot stage, only flag it)
"""
import time

import requests


class WikidataEnricher:
    def __init__(self, cfg, cache):
        self.base_url = cfg["base_url"]
        self.user_agent = cfg["user_agent"]
        self.min_pause = float(cfg["min_pause_seconds"])
        self.footballer_qid = cfg["footballer_qid"]
        self.search_limit = int(cfg.get("search_limit", 5))
        self.cache = cache
        self.session = requests.Session()
        self._last = 0.0

    def _wait(self):
        now = time.monotonic()
        elapsed = now - self._last
        if elapsed < self.min_pause:
            time.sleep(self.min_pause - elapsed)
        self._last = time.monotonic()

    def _api(self, params):
        params = dict(params)
        params["format"] = "json"
        headers = {"User-Agent": self.user_agent}
        for attempt in range(1, 4):
            self._wait()
            try:
                resp = self.session.get(
                    self.base_url, params=params, headers=headers, timeout=30
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

    def _is_footballer(self, entity):
        for claim in entity.get("claims", {}).get("P106", []):
            try:
                qid = claim["mainsnak"]["datavalue"]["value"]["id"]
            except (KeyError, TypeError):
                continue
            if qid == self.footballer_qid:
                return True
        return False

    def enrich(self, name_en):
        default = {
            "wikidata_qid": None,
            "name_ru": None,
            "name_source": "none",
            "name_confidence": "low",
        }
        if not name_en:
            return dict(default)

        cached = self.cache.get("wikidata", name_en)
        if cached is not None:
            return cached

        result = dict(default)

        search = self._api(
            {
                "action": "wbsearchentities",
                "search": name_en,
                "language": "en",
                "type": "item",
                "limit": self.search_limit,
            }
        )
        ids = [c["id"] for c in search.get("search", []) if c.get("id")]

        if ids:
            entities = self._api(
                {
                    "action": "wbgetentities",
                    "ids": "|".join(ids),
                    "props": "claims|sitelinks",
                }
            ).get("entities", {})

            for qid in ids:  # preserve search relevance ordering
                entity = entities.get(qid)
                if not entity or not self._is_footballer(entity):
                    continue
                result["wikidata_qid"] = qid
                ru_title = (
                    entity.get("sitelinks", {}).get("ruwiki", {}).get("title")
                )
                if ru_title:
                    result["name_ru"] = ru_title
                    result["name_source"] = "wikidata"
                    result["name_confidence"] = "high"
                break

        self.cache.set("wikidata", name_en, result)
        return result
