"""Delete cached "nothing was found" entries so the next run retries them.

The cache never stores a miss any more (scraper/cache.py), but that only
applies to NEW writes: the entries already on disk stay forever, because the
cache has no TTL and is carried between CI runs by actions/cache. A single
bad night therefore keeps answering "no such article" for free, which is what
a pass reporting "115 карточек обработано, бюджет Wikimedia 0/20000" looks
like — no requests were made because every lookup hit a stale miss.

This walks the cache directory and removes exactly those files, judging them
with the SAME rule the cache uses when deciding not to write (_is_empty), so
what survives here is exactly what would be written today. Real answers —
including a genuine Pageviews 404 — are kept, so the run costs no budget.

Local disk only: no network, no DB, no budget.

  python docs/cache_prune_empty.py            # dry-run, just counts
  APPLY=1 python docs/cache_prune_empty.py    # delete
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.join(os.path.dirname(HERE), "football_scraper")
sys.path.insert(0, SCRAPER)

from scraper.cache import _is_empty  # noqa: E402

APPLY = os.environ.get("APPLY") == "1"

# Budget counters live beside the cached responses and are NOT cache entries —
# deleting them would reset the day's spend and let a run exceed it.
SKIP_FILES = ("photos_budget.json", "pageviews_budget.json", "budget.json")


def main():
    root = os.path.join(SCRAPER, "cache")
    if not os.path.isdir(root):
        # First run on a fresh machine (or a CI cache miss): nothing to prune
        # is a normal outcome, not a failure — never break the nightly chain.
        print("Кеша ещё нет ({}) — чистить нечего.".format(root))
        return

    per_namespace = {}
    total = removed = unreadable = 0

    for dirpath, _dirnames, filenames in os.walk(root):
        namespace = os.path.relpath(dirpath, root)
        for filename in filenames:
            if not filename.endswith(".json") or filename in SKIP_FILES:
                continue
            path = os.path.join(dirpath, filename)
            total += 1
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    value = json.load(fh)
            except (OSError, ValueError):
                # A truncated file is useless too — it would fail to load on
                # every read and be treated as a miss anyway.
                unreadable += 1
                if APPLY:
                    try:
                        os.remove(path)
                    except OSError:
                        pass
                continue
            if not _is_empty(value):
                continue
            per_namespace[namespace] = per_namespace.get(namespace, 0) + 1
            removed += 1
            if APPLY:
                try:
                    os.remove(path)
                except OSError:
                    pass

    print("=" * 66)
    print("CACHE PRUNE — {}".format(
        "LIVE, файлы удаляются" if APPLY else "DRY RUN, ничего не удаляется"))
    print("=" * 66)
    print("Каталог          : {}".format(root))
    print("Всего записей    : {}".format(total))
    print("Промахов         : {}{}".format(
        removed, " (удалено)" if APPLY else " (к удалению)"))
    if unreadable:
        print("Битых файлов     : {}".format(unreadable))
    for namespace in sorted(per_namespace, key=lambda n: -per_namespace[n]):
        print("  {:<28} {}".format(namespace, per_namespace[namespace]))
    if not removed and not unreadable:
        print("\nЧистить нечего — промахов в кеше нет.")
    elif not APPLY:
        print("\nНичего не удалено. Повторите с APPLY=1, чтобы применить.")


if __name__ == "__main__":
    main()
