#!/usr/bin/env python3
"""Auditable worker for profile_backfill_jobs; requires the matching SQL migration."""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def usable_photo(url):
    if not url:
        return False
    parsed = urllib.parse.urlparse(str(url))
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return False
    path = parsed.path
    return not re.search(r"/(default|dummy)[^/]*\.[a-z]+$", path, re.I)


def classify_result(exit_code, output, verified):
    folded = output.casefold()
    if exit_code != 0 or any(marker in folded for marker in (
        "профилей потеряно", "игроков потеряно", "потеряно пачек",
        "запись отклонена у",
    )):
        return "retry"
    if verified:
        return "succeeded"

    # A successful process is not proof that the write landed. If a source
    # reported data but read-after-write cannot see it, retry rather than
    # silently classifying a write/filter bug as a genuine data gap.
    if re.search(r"(?:портретов найдено|фото найдено)\s*:\s*[1-9]\d*", folded):
        return "retry"
    if re.search(r"строк статистики\s*:\s*[1-9]\d*", folded):
        return "retry"

    # Mark no_data only when the collector explicitly reports zero source rows.
    if re.search(r"(?:портретов найдено|фото найдено)\s*:\s*0(?:\D|$)", folded):
        return "no_data"
    if re.search(r"строк статистики\s*:\s*0(?:\D|$)", folded):
        return "no_data"
    return "retry"


def image_reachable(url):
    if not usable_photo(url):
        return False
    request = urllib.request.Request(str(url), headers={
        "User-Agent": "SherlockScholes/1.0 (+https://github.com/Aloews/sherlock-scholes-)",
        "Range": "bytes=0-1023",
    })
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            response.read(1024)
            return response.status < 400 and content_type.startswith("image/")
    except (urllib.error.URLError, TimeoutError, ValueError):
        return False


def request(path, params=None, method="GET", body=None):
    base=os.environ["SUPABASE_URL"].rstrip("/"); key=os.environ["SUPABASE_KEY"]
    url=base+"/rest/v1/"+path
    if params: url += "?"+urllib.parse.urlencode(params,doseq=True)
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(url,data=data,method=method,headers={
      "apikey":key,"Authorization":"Bearer "+key,"Content-Type":"application/json","Prefer":"return=representation"})
    with urllib.request.urlopen(req,timeout=90) as response:
        raw=response.read()
    return json.loads(raw) if raw else []


def rpc(name,payload):
    return request("rpc/"+name,method="POST",body=payload)


def verify(job):
    if job["task_type"] in ("photo_tm","photo_qid","photo_sw"):
        rows=request("cards",{"select":"id,photo_url","id":"eq."+job["card_id"],"limit":"1"})
        return bool(rows and image_reachable(rows[0].get("photo_url")))
    rows=request("player_season_stat",{"select":"tm_player_id","tm_player_id":"eq."+str(job["transfermarkt_id"]),"limit":"1"})
    return bool(rows)


def run_collector(job):
    task=job["task_type"]
    if task=="photo_sw":
        source=request("soccerwiki_player",{"select":"photo_url","card_id":"eq."+job["card_id"],"limit":"1"})
        url=source[0].get("photo_url") if source else None
        if not usable_photo(url):
            return "Фото найдено: 0\\nSoccer Wiki photo URL is empty or a placeholder",0
        if not image_reachable(url):
            return "ПРОФИЛЕЙ ПОТЕРЯНО: Soccer Wiki photo URL is unreachable",1
        request("cards",params={"id":"eq."+job["card_id"],"or":"(photo_url.is.null,photo_url.eq.)"},
                method="PATCH",body={"photo_url":url})
        rows=request("cards",{"select":"id,photo_url","id":"eq."+job["card_id"],"limit":"1"})
        if rows and rows[0].get("photo_url")==url and image_reachable(rows[0].get("photo_url")):
            return "Фото найдено: 1\\nЗаписано: 1\\nИсточник: Soccer Wiki",0
        if rows and image_reachable(rows[0].get("photo_url")):
            return "Фото найдено: 1\\nКарточка уже содержит доступное фото",0
        return "Фото найдено: 1\\nRead-after-write verification failed",0
    if task=="photo_tm":
        command=[sys.executable,"docs/cards_photo_transfermarkt.py","--only",str(job["transfermarkt_id"])]
    elif task=="photo_qid":
        command=[sys.executable,"docs/cards_photo_from_qid.py","--only-card-id",str(job["card_id"])]
    elif task=="season_stats":
        command=[sys.executable,"docs/players_stats_transfermarkt.py","--only",str(job["transfermarkt_id"]),"--include-unvalued"]
    else:
        raise ValueError("Unsupported task type: "+str(task))
    result=subprocess.run(command,cwd=ROOT,env=dict(os.environ,APPLY="1"),text=True,
      stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=360)
    return result.stdout[-12000:],result.returncode


def finish(job_id,verified,no_data=False,error=None):
    return rpc("finish_profile_backfill_job",{"p_job_id":job_id,"p_verified":verified,"p_no_data":no_data,"p_error":error})


def final_job_results(results):
    """Return the last observed status for each job, preserving anonymous test rows."""
    latest = {}
    anonymous = []
    for index, item in enumerate(results):
        job_id = item.get("job_id")
        if job_id is None:
            anonymous.append((index, item))
        else:
            latest[job_id] = item
    return list(latest.values()) + [item for _, item in anonymous]


def result_exit_code(results):
    """Fail only when a job's final status still needs retry or is terminally failed."""
    final_results = final_job_results(results)
    return 1 if any(item.get("status") in ("pending", "failed") for item in final_results) else 0


def rpc_status(value):
    while isinstance(value, list):
        if not value:
            return ""
        value = value[0]
    if isinstance(value, dict):
        for key in ("finish_profile_backfill_job", "status", "result"):
            if key in value:
                return rpc_status(value[key])
    return str(value)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enqueue-only",action="store_true")
    parser.add_argument("--enqueue-limit",type=int,default=10)
    parser.add_argument("--batch-size",type=int,default=10)
    parser.add_argument("--max-jobs",type=int,default=100)
    parser.add_argument("--report",default="profile-backfill-result.jsonl")
    args=parser.parse_args()
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_KEY"):
        parser.error("SUPABASE_URL and SUPABASE_KEY are required")
    if not 1 <= args.enqueue_limit <= 100000:
        parser.error("--enqueue-limit must be between 1 and 100000")
    if not 1 <= args.batch_size <= 20 or not 1 <= args.max_jobs <= 500:
        parser.error("--batch-size must be 1..20 and --max-jobs must be 1..500")
    enqueued=rpc("enqueue_profile_backfill_jobs",{"p_limit":args.enqueue_limit})
    print("New jobs enqueued:",enqueued)
    if args.enqueue_only: return 0
    results=[]; processed=0
    while processed<args.max_jobs:
        jobs=rpc("claim_profile_backfill_jobs",{"p_limit":min(args.batch_size,args.max_jobs-processed),"p_lease_minutes":45})
        if not jobs: break
        for job in jobs:
            result={"job_id":job["id"],"card_id":job["card_id"],"task_type":job["task_type"],"status":"failed"}
            try:
                if verify(job):
                    result["status"]="succeeded"; finish(job["id"],True)
                else:
                    output,exit_code=run_collector(job)
                    result["collector_tail"]=output[-1000:]
                    status=classify_result(exit_code,output,verify(job))
                    if status=="retry": raise RuntimeError("collector failed: "+output[-2500:])
                    if status=="succeeded":
                        result["status"]="succeeded"; finish(job["id"],True)
                    else:
                        result["status"]="no_data"; finish(job["id"],False,no_data=True,error=output[-1000:])
            except Exception as exc:
                result["error"]=str(exc)[:2000]
                try: result["status"]=rpc_status(finish(job["id"],False,error=result["error"]))
                except Exception as finish_exc: result["finish_error"]=str(finish_exc)[:500]
            results.append(result); processed+=1
            print(json.dumps(result,ensure_ascii=False))
    with open(args.report,"w",encoding="utf-8") as handle:
        for item in results: handle.write(json.dumps(item,ensure_ascii=False)+"\n")
    final_results=final_job_results(results)
    summary={"processed":processed,"unique_jobs":len(final_results),
      "succeeded":sum(x["status"]=="succeeded" for x in final_results),
      "no_data":sum(x["status"]=="no_data" for x in final_results),
      "retry_or_failed":sum(x["status"] in ("pending","failed") for x in final_results),
      "report":args.report}
    print(json.dumps(summary,ensure_ascii=False))
    return result_exit_code(results)


if __name__=="__main__": raise SystemExit(main())
