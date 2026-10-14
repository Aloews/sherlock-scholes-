#!/usr/bin/env python3
"""Report missing player data and optionally enqueue idempotent backfill jobs.

Dry-run by default. Requires SUPABASE_URL and SUPABASE_KEY. Use --enqueue only
after the reviewed profile_backfill_job migration has been applied.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from typing import Any

PAGE_SIZE = 1000


def request_json(path: str, *, method: str = "GET", params: dict[str, str] | None = None,
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


def read_all(table: str, select: str, filters: dict[str, str] | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        params = {"select": select, "limit": str(PAGE_SIZE), "offset": str(offset)}
        params.update(filters or {})
        page = request_json(table, params=params)
        if not isinstance(page, list):
            raise RuntimeError(f"Unexpected response for {table}: {type(page).__name__}")
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def has_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def make_report(cards: list[dict[str, Any]], seasons: list[dict[str, Any]]) -> dict[str, Any]:
    season_card_ids = {row.get("card_id") for row in seasons if row.get("card_id")}
    missing_photo = [c for c in cards if not has_text(c.get("photo_url"))]
    missing_season = [c for c in cards if has_text(c.get("transfermarkt_id")) and c["id"] not in season_card_ids]
    missing_tm_id = [c for c in cards if not has_text(c.get("transfermarkt_id"))]
    missing_qid = [c for c in missing_photo if not has_text(c.get("wikidata_qid"))]
    photo_sources = Counter(c.get("photo_source") or "(null)" for c in cards if has_text(c.get("photo_url")))
    career_json_empty = [c for c in cards if not isinstance(c.get("career_stats"), dict) or not c["career_stats"]]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "active_player_cards": len(cards),
        "season_stat_rows": len(seasons),
        "players_with_season_stats": len(season_card_ids),
        "missing_photo": len(missing_photo),
        "missing_photo_with_wikidata_qid": sum(1 for c in missing_photo if has_text(c.get("wikidata_qid"))),
        "missing_photo_without_wikidata_qid": len(missing_qid),
        "missing_season_stats_with_transfermarkt_id": len(missing_season),
        "missing_transfermarkt_id": len(missing_tm_id),
        "missing_career_stats_json": len(career_json_empty),
        "photo_source_counts": dict(photo_sources.most_common()),
        "jobs": {
            "photo": [{"card_id": c["id"], "name": c.get("name"), "provider": "photo_source_router",
                       "idempotency_key": f"photo:{c['id']}:v1", "priority": 10 if has_text(c.get("transfermarkt_id")) else 30}
                      for c in missing_photo],
            "season_stats": [{"card_id": c["id"], "name": c.get("name"), "provider": "transfermarkt",
                              "transfermarkt_id": c["transfermarkt_id"],
                              "idempotency_key": f"season_stats:{c['id']}:transfermarkt:v1", "priority": 20}
                             for c in missing_season],
        },
    }


def render_markdown(report: dict[str, Any]) -> str:
    jobs = report["jobs"]
    lines = [
        "# Player profile data-gap report", "",
        f"Generated: {report['generated_at']}", "",
        "## Coverage", "",
        "| Metric | Count |", "|---|---:|",
        f"| Active player cards | {report['active_player_cards']} |",
        f"| Season-stat rows | {report['season_stat_rows']} |",
        f"| Players with season stats | {report['players_with_season_stats']} |",
        f"| Missing photo URL | {report['missing_photo']} |",
        f"| Missing photo, with Wikidata QID | {report['missing_photo_with_wikidata_qid']} |",
        f"| Missing photo, without Wikidata QID | {report['missing_photo_without_wikidata_qid']} |",
        f"| Missing season stats, with Transfermarkt ID | {report['missing_season_stats_with_transfermarkt_id']} |",
        f"| Missing Transfermarkt ID | {report['missing_transfermarkt_id']} |",
        f"| Missing career_stats JSON | {report['missing_career_stats_json']} |", "",
        "## Photo source coverage", "",
        "| Source | Cards |", "|---|---:|",
    ]
    lines.extend(f"| {source} | {count} |" for source, count in report["photo_source_counts"].items())
    lines += [
        "", "## Backfill queue preview", "",
        f"- Photo jobs: **{len(jobs['photo'])}**",
        f"- Season-stat jobs: **{len(jobs['season_stats'])}**",
        "- Queue generation is idempotent; this report does not write jobs unless --enqueue is supplied.",
        "- Each worker must verify persisted data before marking a job succeeded.",
        "- Empty provider responses and transport failures are distinct outcomes; failures must not be recorded as 'no source data'.",
        "", "## Interpretation", "",
        "A non-empty photo URL is not proof that the image loads or depicts the correct player. "
        "A season-stat row is not proof of complete career coverage. The next validation layer must "
        "check image HTTP status/content type and verify season records contain plausible dates, clubs, "
        "competitions and totals.",
        "",
    ]
    return "\n".join(lines)


def enqueue_jobs(report: dict[str, Any], limit: int) -> int:
    pending = report["jobs"]["photo"] + report["jobs"]["season_stats"]
    if limit > 0:
        pending = pending[:limit]
    payloads = []
    for item in pending:
        payloads.append({
            "card_id": item["card_id"],
            "task_type": "photo" if item["idempotency_key"].startswith("photo:") else "season_stats",
            "provider": item["provider"],
            "idempotency_key": item["idempotency_key"],
            "priority": item["priority"],
            "result": {"display_name": item.get("name"), "transfermarkt_id": item.get("transfermarkt_id")},
        })
    inserted = 0
    # Batch writes to avoid one REST request per player; conflict handling keeps reruns idempotent.
    for offset in range(0, len(payloads), 100):
        result = request_json("profile_backfill_job", method="POST",
                              params={"on_conflict": "idempotency_key"},
                              body=payloads[offset:offset + 100],
                              prefer="resolution=ignore-duplicates,return=representation")
        inserted += len(result) if isinstance(result, list) else 0
    return inserted

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default="artifacts/profile-data")
    parser.add_argument("--enqueue", action="store_true", help="Write jobs after the migration has been applied")
    parser.add_argument("--enqueue-limit", type=int, default=0, help="Cap new jobs; 0 means no cap")
    args = parser.parse_args()
    if args.enqueue and args.enqueue_limit < 0:
        parser.error("--enqueue-limit must be >= 0")
    try:
        cards = read_all("cards", "id,name,photo_url,photo_source,wikidata_qid,transfermarkt_id,career_stats",
                         {"category": "eq.player", "active": "eq.true", "order": "id.asc"})
        seasons = read_all("player_season_stat", "card_id", {"card_id": "not.is.null", "order": "card_id.asc"})
        report = make_report(cards, seasons)
        output = pathlib.Path(args.output_dir)
        output.mkdir(parents=True, exist_ok=True)
        (output / "profile_gap_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (output / "profile_gap_report.md").write_text(render_markdown(report), encoding="utf-8")
        if args.enqueue:
            inserted = enqueue_jobs(report, args.enqueue_limit)
            print(f"Enqueued {inserted} new jobs (duplicates ignored).")
        else:
            print("Dry run: no queue rows written. Use --enqueue only after migration is applied.")
        print(json.dumps({k: v for k, v in report.items() if k != "jobs"}, ensure_ascii=False, indent=2))
        print(f"Reports: {output / 'profile_gap_report.md'} and {output / 'profile_gap_report.json'}")
        return 0
    except (KeyError, urllib.error.URLError, urllib.error.HTTPError, RuntimeError, ValueError) as exc:
        print(f"profile-gap-report failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
