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
from urllib.parse import quote

import requests

# Wikimedia Commons redirect service: resolves a file NAME to the actual
# image, optionally thumbnailed server-side via ?width=N. Legal to hotlink.
COMMONS_FILEPATH_BASE = "https://commons.wikimedia.org/wiki/Special:FilePath"


def commons_filepath_url(filename, width=256, base=COMMONS_FILEPATH_BASE):
    """Commons Special:FilePath URL for a P18 file name, or None.

    'Erling Haaland 2023.jpg' ->
    https://commons.wikimedia.org/wiki/Special:FilePath/Erling_Haaland_2023.jpg?width=256
    Spaces -> underscores, then percent-encoded (same convention as article
    titles in pageviews.py).
    """
    name = (filename or "").strip()
    if not name:
        return None
    encoded = quote(name.replace(" ", "_"), safe="")
    return "{}/{}?width={}".format(base.rstrip("/"), encoded, int(width))


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

    def titles_for_qid(self, qid):
        """Return {'ruwiki': title|None, 'enwiki': title|None} for a QID.

        Used by the pageviews step to find the Wikipedia article name to query
        when a player has a wikidata_qid but no stored name_ru. Reuses the
        polite _api() call and is cached per QID (namespace wikidata_sitelinks).
        """
        default = {"ruwiki": None, "enwiki": None}
        if not qid:
            return dict(default)

        cached = self.cache.get("wikidata_sitelinks", qid)
        if cached is not None:
            return cached

        entities = self._api(
            {"action": "wbgetentities", "ids": qid, "props": "sitelinks"}
        ).get("entities", {})
        sitelinks = (entities.get(qid, {}) or {}).get("sitelinks", {}) or {}

        result = {
            "ruwiki": sitelinks.get("ruwiki", {}).get("title"),
            "enwiki": sitelinks.get("enwiki", {}).get("title"),
        }
        self.cache.set("wikidata_sitelinks", qid, result)
        return result

    def label_en_for_qid(self, qid):
        """English label (labels.en) of a QID, or None.

        The fallback display name for entities WITHOUT an enwiki sitelink —
        many Russian players have an en label but no English article. Reuses
        the polite _api() call; cached per QID (namespace wikidata_label_en),
        the negative result included, so an entity without an English label
        is never re-queried."""
        if not qid:
            return None

        cached = self.cache.get("wikidata_label_en", qid)
        if cached is not None:
            return cached.get("label")

        entities = self._api(
            {
                "action": "wbgetentities",
                "ids": qid,
                "props": "labels",
                "languages": "en",
            }
        ).get("entities", {})
        label = (
            ((entities.get(qid, {}) or {}).get("labels", {}) or {})
            .get("en", {})
            .get("value")
        )
        label = (label or "").strip() or None
        self.cache.set("wikidata_label_en", qid, {"label": label})
        return label

    def media_filename_for_qid(self, qid, prop="P18"):
        """Commons file name from a media claim of a QID, or None.

        prop is the Wikidata media property: P18 (image — players, stadiums,
        people) or P154 (logo image — clubs). Cached per QID in a namespace
        derived from the property ("wikidata_p18", "wikidata_p154", ...) —
        including the negative result, so an entity without that media is
        never re-queried. Uses wbgetclaims with property=<prop>: a tiny
        payload compared to a full wbgetentities, one polite call per
        uncached (entity, property) pair."""
        if not qid:
            return None

        namespace = "wikidata_" + prop.lower()
        cached = self.cache.get(namespace, qid)
        if cached is not None:
            return cached.get("file")

        data = self._api(
            {"action": "wbgetclaims", "entity": qid, "property": prop}
        )
        filename = None
        for claim in (data or {}).get("claims", {}).get(prop, []):
            try:
                value = claim["mainsnak"]["datavalue"]["value"]
            except (KeyError, TypeError):
                continue
            if isinstance(value, str) and value.strip():
                filename = value.strip()
                break

        self.cache.set(namespace, qid, {"file": filename})
        return filename

    def translations_for_qid(self, qid, langs):
        """{lang: {"sitelink": title|None, "label": label|None}} for the
        requested language codes — ONE wbgetentities call per QID covering
        ALL languages at once (props=sitelinks|labels, languages=es|pt|...),
        so the request budget does not multiply by the language count.
        (The wikidata_sitelinks namespace stores only ruwiki/enwiki, hence
        this separate namespace.) Cached per (sorted langs, qid), negative
        results included; sitelink keys follow the '<lang>wiki' convention
        (eswiki, zhwiki, ...)."""
        langs = sorted(langs)
        if not qid or not langs:
            return {}

        key = "{}|{}".format(",".join(langs), qid)
        cached = self.cache.get("wikidata_translations", key)
        if cached is not None:
            return cached.get("langs") or {}

        entities = self._api(
            {
                "action": "wbgetentities",
                "ids": qid,
                "props": "sitelinks|labels",
                "languages": "|".join(langs),
            }
        ).get("entities", {})
        entity = entities.get(qid, {}) or {}
        sitelinks = entity.get("sitelinks", {}) or {}
        labels = entity.get("labels", {}) or {}

        out = {}
        for lang in langs:
            out[lang] = {
                "sitelink": (sitelinks.get(lang + "wiki", {}) or {}).get("title"),
                "label": (labels.get(lang, {}) or {}).get("value"),
            }
        self.cache.set("wikidata_translations", key, {"langs": out})
        return out

    def entity_claims_labels(self, qid, langs=("ru", "en")):
        """Full claims + the entity's own labels in ONE wbgetentities call —
        the legend-career source (P54 with date qualifiers, P413, P166 all
        come back together). Cached per (qid, langs) in namespace
        wikidata_entity. Returns {} when missing."""
        if not qid:
            return {}
        key = "{}|{}".format(",".join(langs), qid)
        cached = self.cache.get("wikidata_entity", key)
        if cached is not None:
            return cached
        entities = self._api({
            "action": "wbgetentities", "ids": qid,
            "props": "claims|labels", "languages": "|".join(langs),
        }).get("entities", {})
        ent = entities.get(qid, {}) or {}
        self.cache.set("wikidata_entity", key, ent)
        return ent

    def labels_for_qids(self, qids, langs=("ru", "en")):
        """{qid: {lang: label}} for many entities, batched ≤50 per
        wbgetentities call (referenced clubs/positions/awards). Cached per qid
        in namespace wikidata_labels; only uncached ids hit the network."""
        out = {}
        todo = []
        for q in dict.fromkeys(q for q in qids if q):
            c = self.cache.get("wikidata_labels", q)
            if c is not None:
                out[q] = c
            else:
                todo.append(q)
        for i in range(0, len(todo), 50):
            chunk = todo[i:i + 50]
            entities = self._api({
                "action": "wbgetentities", "ids": "|".join(chunk),
                "props": "labels", "languages": "|".join(langs),
            }).get("entities", {})
            for q in chunk:
                labs = (entities.get(q, {}) or {}).get("labels", {}) or {}
                rec = {lang: (labs.get(lang, {}) or {}).get("value") for lang in langs}
                self.cache.set("wikidata_labels", q, rec)
                out[q] = rec
        return out

    def claim_item_ids(self, qid, prop):
        """Entity-id values of an item-valued Wikidata claim (e.g. P27 country
        of citizenship), as a list. Cached per QID in namespace
        'wikidata_<prop>' (key 'ids'), negative results included; one polite
        wbgetclaims call per uncached (entity, property) pair — same contract
        as media_filename_for_qid."""
        if not qid:
            return []
        namespace = "wikidata_" + prop.lower()
        cached = self.cache.get(namespace, qid)
        if cached is not None:
            return list(cached.get("ids") or [])
        data = self._api(
            {"action": "wbgetclaims", "entity": qid, "property": prop}
        )
        ids = []
        for claim in (data or {}).get("claims", {}).get(prop, []):
            try:
                value = claim["mainsnak"]["datavalue"]["value"]["id"]
            except (KeyError, TypeError):
                continue
            if value:
                ids.append(value)
        self.cache.set(namespace, qid, {"ids": ids})
        return ids

    def instance_of_qids(self, qid):
        """P31 (instance of) class QIDs of an entity, as a list (may be
        empty). The stadium-card guard: a bare stadium name often resolves
        to the PERSON/city the stadium is named after ("Сантьяго Бернабеу"),
        and P31 tells them apart (Q5 = human vs stadium/venue classes).
        Cached per QID (namespace wikidata_p31), the empty result included;
        same polite wbgetclaims call as media_filename_for_qid."""
        if not qid:
            return []

        cached = self.cache.get("wikidata_p31", qid)
        if cached is not None:
            return list(cached.get("classes") or [])

        data = self._api(
            {"action": "wbgetclaims", "entity": qid, "property": "P31"}
        )
        classes = []
        for claim in (data or {}).get("claims", {}).get("P31", []):
            try:
                value = claim["mainsnak"]["datavalue"]["value"]["id"]
            except (KeyError, TypeError):
                continue
            if value:
                classes.append(value)

        self.cache.set("wikidata_p31", qid, {"classes": classes})
        return classes

    def image_filename_for_qid(self, qid):
        """P18 (image) file name for a QID, or None — see
        media_filename_for_qid. Kept as the --photos entry point; the cache
        namespace stays wikidata_p18, so old caches remain valid."""
        return self.media_filename_for_qid(qid, "P18")

    def _is_footballer(self, entity):
        for claim in entity.get("claims", {}).get("P106", []):
            try:
                qid = claim["mainsnak"]["datavalue"]["value"]["id"]
            except (KeyError, TypeError):
                continue
            if qid == self.footballer_qid:
                return True
        return False

    def enrich(self, name, full_name=None):
        """Resolve name_ru for a player.

        Wikidata rarely matches an abbreviated name ("A. Onana"), so we search
        by the full name first ("Andre Onana") and only fall back to the short
        name if the full one yields nothing. The footballer disambiguation
        (P106 == Q937857) is applied to every candidate.
        """
        default = {
            "wikidata_qid": None,
            "name_ru": None,
            "name_source": "none",
            "name_confidence": "low",
        }

        queries = []
        for query in (full_name, name):
            if query and query not in queries:
                queries.append(query)
        if not queries:
            return dict(default)

        best = None
        for query in queries:
            res = self._search(query)
            if res["name_ru"]:
                return res  # full hit (russian article found) — done
            if best is None and res["wikidata_qid"]:
                best = res  # footballer matched but no ruwiki — remember as fallback
        return best if best is not None else dict(default)

    def _search(self, name_en):
        """Search + disambiguate a single query string, cached per query."""
        default = {
            "wikidata_qid": None,
            "name_ru": None,
            "name_source": "none",
            "name_confidence": "low",
        }

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
