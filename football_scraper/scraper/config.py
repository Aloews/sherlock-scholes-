"""Config + environment helpers."""
import json
import os


def load_config(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def require_env(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(
            "Missing required environment variable: {}. "
            "Set it before running (see README).".format(name)
        )
    return value
