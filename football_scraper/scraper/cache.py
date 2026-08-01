"""Tiny on-disk JSON cache.

Cached responses are reused across runs so a `--dry-run` followed by a real
run does NOT spend the API-Football daily budget twice, and so Wikidata
QIDs / ruwiki titles are never fetched more than once per name.
"""
import hashlib
import json
import os


def _carries_nothing(value):
    """True for a value that answers nothing on its own: None, False, 0, "",
    [], {} — or a dict/list built only out of those.

    False and 0 count as nothing HERE, inside a payload, on purpose. The
    commonest miss in this codebase is the ruwiki lookup's
    {"qid": None, "disambig": False}: there is no article, and the False is
    not an answer, it is the absence of one. Judging that dict by its flag
    alone would keep exactly the negative entry we are trying not to persist
    (that is why a whole nightly pass could report "115 cards processed,
    Wikimedia budget 0/20000" — every lookup was served by a stale miss).

    A payload that also carries a real value is NOT nothing: a 404 from the
    Pageviews API is {"views": 0, "found": False, "project": ..., "article":
    ...}, and the project/article strings make it a genuine, cacheable
    "this article has no data" answer.
    """
    if isinstance(value, dict):
        return not value or all(_carries_nothing(v) for v in value.values())
    if isinstance(value, (list, tuple, set)):
        return not value or all(_carries_nothing(v) for v in value)
    if isinstance(value, str):
        return len(value) == 0
    # None, False, 0, 0.0 — nothing. Any other scalar is an answer.
    return value is None or value is False or value == 0


def _is_empty(value):
    """True when a payload is worth NOT persisting — see _carries_nothing.

    Top-level scalars keep their plain meaning (a bare False/0 handed to the
    cache is a real answer); only structured payloads are judged by content.
    """
    if isinstance(value, (dict, list, tuple, set, str)) or value is None:
        return _carries_nothing(value)
    return False


class FileCache:
    def __init__(self, root, enabled=True):
        self.root = root
        self.enabled = enabled
        if enabled:
            os.makedirs(root, exist_ok=True)

    def _path(self, namespace, key):
        digest = hashlib.sha1(key.encode("utf-8")).hexdigest()
        folder = os.path.join(self.root, namespace)
        os.makedirs(folder, exist_ok=True)
        return os.path.join(folder, digest + ".json")

    def get(self, namespace, key):
        if not self.enabled:
            return None
        path = self._path(namespace, key)
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, json.JSONDecodeError):
            return None

    def set(self, namespace, key, value):
        if not self.enabled:
            return
        # Never persist an empty result. The cache directory survives between
        # CI runs (actions/cache), and there is no TTL — a negative entry
        # written once would suppress every future network lookup for that
        # key forever ("115 cards processed, Wikimedia budget 0/20000").
        # Misses stay uncached so the next run retries them.
        if _is_empty(value):
            return
        path = self._path(namespace, key)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(value, fh, ensure_ascii=False)
