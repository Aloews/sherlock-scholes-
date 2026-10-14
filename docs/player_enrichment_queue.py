#!/usr/bin/env python3
"""Idempotent per-player enrichment queue with post-write verification."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "football_scraper"))
from _sb import all_rows, sb  # noqa: E402
import cards_photo_transfermarkt as tm_photo  # noqa: E402


def iso_after(minutes: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def fetch_card(card_id: str):
    rows = sb("cards", params={
        "select": "id,name,photo_url,transfermarkt_id,wikidata_qid,active,category",
        "id": "eq." + card_id, "limit": 1
    })
    return rows[0] if rows else None


def patch_if_photo_empty(card_id: str, url: str) -> bool:
    sb("cards", method="PATCH",
       params={"id": "eq." + card_id, "photo_url": "is.null"},
       body={"photo_url": url})
    card = fetch_card(card_id)
    return bool(card and isinstance(card.get("photo_url"), str) and card["photo_url"].strip())


def process_photo(task: dict, card: dict) -> tuple[str, int, str | None]:
    if card.get("photo_url"):
        return "succeeded", 0, None
    if task["source"] == "transfermarkt":
        tm_id = str(card.get("transfermarkt_id") or "").strip()
        if not tm_id.isdigit():
            return "no_data", 0, "missing_transfermarkt_id"
        html = tm_photo.get(tm_photo.PROFILE % tm_id)
        if html is None:
            return "retryable", 0, "transfermarkt_profile_unreachable"
        url = tm_photo.portrait_url(html)
        if not url:
            return "no_data", 0, "transfermarkt_portrait_missing_or_placeholder"
        return ("succeeded", 1, None) if patch_if_photo_empty(str(card["id"]), url) else (
            "retryable", 0, "photo_write_not_verified")
    return "failed", 0, "unsupported_photo_source"


def process_season_stats(task: dict, card: dict) -> tuple[str, int, str | None]:
    tm_id = str(card.get("transfermarkt_id") or "").strip()
    if not tm_id.isdigit():
        return "no_data", 0, "missing_transfermarkt_id"
    env = dict(os.environ)
    env["APPLY"] = "1"
    script = HERE / "players_stats_transfermarkt.py"
    result = subprocess.run(
        [sys.executable, str(script), "--only", tm_id],
        env=env, capture_output=True, text=True, timeout=600, check=False
    )
    # Verify against the persistent table, not just the scraper's exit code.
    rows = all_rows("player_season_stat", {
        "select": "tm_player_id,card_id,season_id",
        "tm_player_id": "eq." + tm_id,
        "order": "season_id,competition_id,club_id"
    })
    detail = ((result.stderr or "") + "\n" + (result.stdout or "")).strip()[-1500:]
    if result.returncode != 0:
        return "retryable", 0, "scraper_exit_%d: %s" % (result.returncode, detail)
    if "ИГРОКОВ ПОТЕРЯНО" in detail or "ЗАПИСЬ ОТКЛОНЕНА" in detail:
        return "retryable", len(rows), "provider_or_write_failure: " + detail
    if rows:
        return "succeeded", len(rows), None
    return "no_data", 0, "provider_returned_no_season_rows"


def finish(task: dict, status: str, count: int, error: str | None):
    attempts = int(task.get("attempts") or 1)
    if status == "retryable" and attempts >= int(task.get("max_attempts") or 4):
        status = "failed"
    body = {
        "status": status,
        "result_count": count,
        "last_error": (error or "")[:2000] or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat() if status in ("succeeded", "no_data", "failed") else None,
        "next_attempt_at": iso_after(min(1440, 2 ** min(attempts, 10))) if status == "retryable" else datetime.now(timezone.utc).isoformat(),
    }
    sb("player_enrichment_queue", method="PATCH",
       params={"id": "eq." + str(task["id"]), "status": "eq.processing"},
       body=body)
    persisted = sb("player_enrichment_queue", params={
        "select": "status,result_count", "id": "eq." + str(task["id"]), "limit": 1
    }) or []
    verified = bool(persisted and persisted[0].get("status") == status
                    and int(persisted[0].get("result_count") or 0) == count)
    print(json.dumps({
        "task_id": task["id"], "card_id": task["card_id"],
        "task_type": task["task_type"], "source": task["source"],
        "status": status, "result_count": count, "error": error,
        "persisted_state_verified": verified
    }, ensure_ascii=False), flush=True)
    return verified


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enqueue", action="store_true", help="enqueue currently missing profile data")
    parser.add_argument("--run", action="store_true", help="claim and process a batch")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--worker", default=os.environ.get("GITHUB_RUN_ID", "manual"))
    args = parser.parse_args()
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_KEY"):
        raise SystemExit("SUPABASE_URL and SUPABASE_KEY are required")
    if args.limit < 1 or args.limit > 250:
        raise SystemExit("--limit must be in [1, 250]")
    if not args.enqueue and not args.run:
        parser.error("choose --enqueue and/or --run")

    if args.enqueue:
        result = sb("rpc/enqueue_player_enrichment", method="POST", body={})
        print("enqueue:", json.dumps(result, ensure_ascii=False), flush=True)

    if args.run:
        tasks = sb("rpc/claim_player_enrichment_jobs", method="POST", body={
            "p_limit": args.limit, "p_worker": args.worker
        }) or []
        print("claimed_tasks:", len(tasks), flush=True)
        for task in tasks:
            try:
                card = fetch_card(str(task["card_id"]))
                if not card or card.get("active") is False or card.get("category") != "player":
                    status, count, error = "no_data", 0, "card_missing_or_inactive"
                elif task["task_type"] == "photo":
                    status, count, error = process_photo(task, card)
                elif task["task_type"] == "season_stats":
                    status, count, error = process_season_stats(task, card)
                else:
                    status, count, error = "failed", 0, "unsupported_task_type"
                if not finish(task, status, count, error):
                    raise SystemExit("queue task persistence verification failed: %s" % task["id"])
            except subprocess.TimeoutExpired:
                if not finish(task, "retryable", 0, "season_stats_timeout"):
                    raise SystemExit("queue task timeout status could not be verified: %s" % task["id"])
            except Exception as exc:  # noqa: BLE001
                if not finish(task, "retryable", 0, "%s: %s" % (type(exc).__name__, str(exc))):
                    raise SystemExit("queue task error status could not be verified: %s" % task["id"])
            time.sleep(1.0)


if __name__ == "__main__":
    main()
