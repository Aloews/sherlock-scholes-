"""Tiny on-disk JSON cache.

Cached responses are reused across runs so a `--dry-run` followed by a real
run does NOT spend the API-Football daily budget twice, and so Wikidata
QIDs / ruwiki titles are never fetched more than once per name.
"""
import hashlib
import json
import os


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
        path = self._path(namespace, key)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(value, fh, ensure_ascii=False)
