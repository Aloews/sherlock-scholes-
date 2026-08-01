"""Tiny on-disk JSON cache.

Cached responses are reused across runs so a `--dry-run` followed by a real
run does NOT spend the API-Football daily budget twice, and so Wikidata
QIDs / ruwiki titles are never fetched more than once per name.
"""
import hashlib
import json
import os


def _is_empty(value):
    """True for a 'nothing was found' payload: None, {}, [], "", and a dict
    whose every value is itself empty ({"titles": []}, {"extract": ""}).

    False and 0 are NOT empty — they are real answers ({"disambig": False},
    a pageviews count of 0) and must stay cached.
    """
    if value is None:
        return True
    if isinstance(value, (bool, int, float)):
        return False
    if isinstance(value, dict):
        return not value or all(_is_empty(v) for v in value.values())
    if isinstance(value, (str, list, tuple, set)):
        return len(value) == 0
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
