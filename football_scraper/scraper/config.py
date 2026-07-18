"""Config + environment helpers."""
import json
import os


def load_config(path):
    """Load and parse the JSON config, with clear errors instead of tracebacks.

    A missing file, an empty file, or invalid JSON all raise SystemExit with a
    human-readable message naming the path, rather than the raw
    "Expecting value: line 1 column 1" that bare json.load() would surface.
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError as exc:
        raise SystemExit(
            "config файл не найден или недоступен: {} ({})".format(path, exc)
        )
    if not text.strip():
        raise SystemExit("config файл пустой или не JSON: {}".format(path))
    try:
        return json.loads(text)
    except ValueError as exc:
        raise SystemExit(
            "config файл пустой или не JSON: {} ({})".format(path, exc)
        )


def require_env(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(
            "Missing required environment variable: {}. "
            "Set it before running (see README).".format(name)
        )
    return value
