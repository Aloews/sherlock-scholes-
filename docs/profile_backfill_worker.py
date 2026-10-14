#!/usr/bin/env python3
"""Claim and process profile backfill jobs, verifying each persisted result.

Dry-run by default. --run requires the reviewed queue migration to be applied.
Each claimed job gets an idempotent source operation, a database read-back check,
and a terminal/retry status update. No provider response is treated as success
until the database reflects a valid result.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import socket
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"


def sb(path: str, *, method: str = "GET", params: dict[str, str] | None = None,
       body: Any = None, prefer: str | None = None) -> Any:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_KEY"]
    url = f"{base}/rest/v1/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=90) as response:
        raw = response.read()
    return json.loads(raw) if raw else []


def image_is_valid(url: str) -> tuple[bool, str]:
    if not url.startswith(("https://", "http://")):
        return False, "photo URL is not HTTP(S)"
    request = urllib.request.Request(url, headers={
        "User-Agent": "SherlockScholes/1.0 (+https://github.com/Aloews/sherlock-scholes-)",
        "Range": "bytes=0-1023",
    })
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            response.read(1024)
            if response.status >= 400:
                return False, f"image returned HTTP {response.status}"
            if not content_type.startswith("image/"):
                return False, f"unexpected content type: {content_type or '(missing)'}"
            return True, f"HTTP {response.status}, {content_type}"
    except Exception as exc:  # noqa: BLE001
        return False, f"image verification failed: {type(exc).__name__}: {exc}"


def get_card(card_id: str) -> dict[str, Any] | None:
    rows = sb("cards", params={"select": "id,name,photo_url,photo_source,wikidata_qid,transfermarkt_id",
                               "id": f"eq.{card_id}", "limit": "1"})
    return rows[0] if rows else None


def ensure_photo(card_id: str, worker_id: str) -> tuple[str, dict[str, Any]]:
    card = get_card(card_id)
    if not card:
        return "no_source_data", {"reason": "card not found"}
    if card.get("photo_url"):
        ok, detail = image_is_valid(card["photo_url"])
        if ok:
            return "succeeded", {"photo_url": card["photo_url"], "verification": detail, "already_present": True}
        return "retry", {"reason": "existing photo URL failed validation; it was not overwritten", "detail": detail}

    outputs = []
    env = dict(os.environ)
    env["APPLY"] = "1"
    if card.get("wikidata_qid"):
        proc = subprocess.run(
            [sys.executable, str(DOCS / "cards_photo_from_qid.py"), "--only-card", card_id],
            cwd=ROOT, env=env, text=True, capture_output=True, timeout=900,
        )
        outputs.append(proc.stdout + "\n" + proc.stderr)
        if proc.returncode:
            return "retry", {"reason": "Wikidata photo worker failed", "exit_code": proc.returncode,
                             "output_tail": outputs[-1][-3000:]}
        card = get_card(card_id) or card
        if card.get("photo_url"):
            ok, detail = image_is_valid(card["photo_url"])
            if ok:
                return "succeeded", {"photo_url": card["photo_url"], "verification": detail, "source": "wikidata"}
            return "retry", {"reason": "Wikidata URL failed image verification", "detail": detail}

    # Soccer Wiki is preferred when it has a portrait for this exact card.
    sw = sb("soccerwiki_player", params={"select": "photo_url", "card_id": f"eq.{card_id}", "limit": "1"})
    if sw and sw[0].get("photo_url"):
        candidate = sw[0]["photo_url"]
        ok, detail = image_is_valid(candidate)
        if ok:
            sb("cards", method="PATCH", params={"id": f"eq.{card_id}", "photo_url": "is.null"},
               body={"photo_url": candidate, "photo_source": "soccerwiki"}, prefer="return=minimal")
            card = get_card(card_id) or {}
            if card.get("photo_url") == candidate:
                return "succeeded", {"photo_url": candidate, "verification": detail, "source": "soccerwiki"}

    if card.get("transfermarkt_id"):
        proc = subprocess.run(
            [sys.executable, str(DOCS / "cards_photo_transfermarkt.py"),
             "--only-card", card_id, "--include-soccerwiki"],
            cwd=ROOT, env=env, text=True, capture_output=True, timeout=900,
        )
        outputs.append(proc.stdout + "\n" + proc.stderr)
        if proc.returncode:
            return "retry", {"reason": "Transfermarkt photo worker failed", "exit_code": proc.returncode,
                             "output_tail": outputs[-1][-3000:]}
        if any("профилей потеряно" in output.casefold() or "пачка" in output.casefold() and "потеряна" in output.casefold()
               for output in outputs):
            return "retry", {"reason": "source request failed; absence of a photo is not conclusive",
                             "output_tail": "\n".join(outputs)[-3000:]}
        card = get_card(card_id) or card
        if card.get("photo_url"):
            ok, detail = image_is_valid(card["photo_url"])
            if ok:
                return "succeeded", {"photo_url": card["photo_url"], "verification": detail, "source": "transfermarkt"}
            return "retry", {"reason": detail, "photo_url": card["photo_url"]}
    elif any("пачка" in output.casefold() and "потеряна" in output.casefold() for output in outputs):
        return "retry", {"reason": "Wikidata request failed; retry needed"}

    return "no_source_data", {"reason": "all eligible sources completed without a valid portrait",
                              "source_outputs": [output[-1000:] for output in outputs]}


def ensure_season_stats(card_id: str) -> tuple[str, dict[str, Any]]:
    card = get_card(card_id)
    if not card or not card.get("transfermarkt_id"):
        return "no_source_data", {"reason": "missing card or Transfermarkt ID"}
    env = dict(os.environ)
    env["APPLY"] = "1"
    proc = subprocess.run(
        [sys.executable, str(DOCS / "players_stats_transfermarkt.py"),
         "--only", str(card["transfermarkt_id"]), "--include-unvalued"],
        cwd=ROOT, env=env, text=True, capture_output=True, timeout=900,
    )
    output = proc.stdout + "\n" + proc.stderr
    if proc.returncode:
        return "retry", {"reason": "Transfermarkt season-stat collector failed",
                         "exit_code": proc.returncode, "output_tail": output[-3000:]}
    if "потеряно" in output.casefold() or "timeout" in output.casefold() or "timed out" in output.casefold():
        return "retry", {"reason": "source response may be incomplete", "output_tail": output[-3000:]}
    rows = sb("player_season_stat", params={
        "select": "tm_player_id,season_id,competition_id,club_id,apps,minutes,goals,assists",
        "tm_player_id": f"eq.{card['transfermarkt_id']}", "order": "season_id.desc",
    })
    if not rows:
        return "no_source_data", {"reason": "collector completed but no season-stat rows were persisted",
                                  "transfermarkt_id": card["transfermarkt_id"], "output_tail": output[-2000:]}
    invalid = [r for r in rows if not r.get("season_id") or not r.get("competition_id")
               or not r.get("club_id") or any(r.get(field) is not None and r[field] < 0
                                               for field in ("apps", "minutes", "goals", "assists"))]
    if invalid:
        return "retry", {"reason": "persisted season rows failed plausibility checks",
                         "row_count": len(rows), "invalid_rows": len(invalid)}
    return "succeeded", {"transfermarkt_id": card["transfermarkt_id"], "verified_rows": len(rows),
                         "latest_season": max(row["season_id"] for row in rows)}


def finish_job(job: dict[str, Any], worker_id: str, status: str, result: dict[str, Any]) -> str:
    now = datetime.now(timezone.utc)
    attempts = int(job.get("attempts") or 1)
    max_attempts = int(job.get("max_attempts") or 5)
    if status == "retry" and attempts >= max_attempts:
        status = "failed"
    body: dict[str, Any] = {
        "status": status,
        "lease_owner": None,
        "lease_until": None,
        "last_error": result.get("reason") if status in {"retry", "failed"} else None,
        "result": result,
        "updated_at": now.isoformat(),
    }
    if status in {"succeeded", "no_source_data", "failed"}:
        body["completed_at"] = now.isoformat()
    else:
        body["next_attempt_at"] = (now + timedelta(minutes=min(360, 2 ** min(attempts, 8)))).isoformat()
    updated = sb("profile_backfill_job", method="PATCH",
                 params={"id": f"eq.{job['id']}", "lease_owner": f"eq.{worker_id}", "status": "eq.running"},
                 body=body, prefer="return=representation")
    if not updated:
        raise RuntimeError(f"job {job['id']} lease lost before status update")
    return status


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true", help="claim and process jobs; otherwise report queue counts only")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--lease-seconds", type=int, default=1200)
    args = parser.parse_args()
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_KEY"):
        parser.error("SUPABASE_URL and SUPABASE_KEY are required")
    if not 1 <= args.limit <= 20:
        parser.error("--limit must be between 1 and 20")
    if not args.run:
        try:
            rows = sb("profile_backfill_job", params={"select": "status,task_type", "limit": "1000"})
            counts: dict[str, int] = {}
            for row in rows:
                key = f"{row.get('task_type')}:{row.get('status')}"
                counts[key] = counts.get(key, 0) + 1
            print(json.dumps({"dry_run": True, "queue_counts_sample": counts,
                              "note": "No jobs claimed or modified."}, indent=2))
            return 0
        except Exception as exc:  # noqa: BLE001
            print(f"queue report failed: {exc}", file=sys.stderr)
            return 1

    worker_id = f"{socket.gethostname()}:{uuid.uuid4().hex[:12]}"
    try:
        jobs = sb("rpc/claim_profile_backfill_jobs", method="POST", body={
            "p_worker": worker_id, "p_limit": args.limit, "p_lease_seconds": args.lease_seconds,
        })
        if not isinstance(jobs, list):
            raise RuntimeError("claim RPC did not return a job list")
        summary = {"worker": worker_id, "claimed": len(jobs), "succeeded": 0, "no_source_data": 0,
                   "retry": 0, "failed": 0, "jobs": []}
        for job in jobs:
            try:
                if job["task_type"] == "photo":
                    status, result = ensure_photo(job["card_id"], worker_id)
                elif job["task_type"] == "season_stats":
                    status, result = ensure_season_stats(job["card_id"])
                else:
                    status, result = "no_source_data", {"reason": f"unsupported task type: {job['task_type']}"}
                status = finish_job(job, worker_id, status, result)
            except Exception as exc:  # noqa: BLE001
                status = "retry"
                result = {"reason": f"{type(exc).__name__}: {exc}"}
                try:
                    status = finish_job(job, worker_id, status, result)
                except Exception as finish_exc:  # noqa: BLE001
                    result["finish_error"] = str(finish_exc)
                    status = "failed_to_record"
            summary["jobs"].append({"id": job.get("id"), "card_id": job.get("card_id"),
                                    "task_type": job.get("task_type"), "status": status, "result": result})
            if status in summary:
                summary[status] += 1
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 1 if summary["retry"] or summary["failed"] else 0
    except (KeyError, urllib.error.URLError, urllib.error.HTTPError, RuntimeError, ValueError) as exc:
        print(f"profile backfill worker failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
