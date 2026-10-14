#!/usr/bin/env python3
"""Auditable worker for profile_backfill_jobs; requires the matching SQL migration."""
import argparse
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def classify_result(exit_code, output, verified):
    if exit_code != 0 or "ПРОФИЛЕЙ ПОТЕРЯНО" in output:
        return "retry"
    return "succeeded" if verified else "no_data"


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
    if job["task_type"] in ("photo_tm","photo_qid"):
        rows=request("cards",{"select":"id,photo_url","id":"eq."+job["card_id"],"limit":"1"})
        return bool(rows and rows[0].get("photo_url"))
    rows=request("player_season_stat",{"select":"tm_player_id","tm_player_id":"eq."+str(job["transfermarkt_id"]),"limit":"1"})
    return bool(rows)


def run_collector(job):
    task=job["task_type"]
    if task=="photo_tm":
        command=[sys.executable,"docs/cards_photo_transfermarkt.py","--only",str(job["transfermarkt_id"])]
    elif task=="photo_qid":
        command=[sys.executable,"docs/cards_photo_from_qid.py","--only-card-id",str(job["card_id"])]
    elif task=="season_stats":
        command=[sys.executable,"docs/players_stats_transfermarkt.py","--only",str(job["transfermarkt_id"])]
    else:
        raise ValueError("Unsupported task type: "+str(task))
    result=subprocess.run(command,cwd=ROOT,env=dict(os.environ,APPLY="1"),text=True,
      stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=360)
    return result.stdout[-12000:],result.returncode


def finish(job_id,verified,no_data=False,error=None):
    return rpc("finish_profile_backfill_job",{"p_job_id":job_id,"p_verified":verified,"p_no_data":no_data,"p_error":error})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enqueue-only",action="store_true")
    parser.add_argument("--enqueue-limit",type=int,default=50000)
    parser.add_argument("--batch-size",type=int,default=10)
    parser.add_argument("--max-jobs",type=int,default=100)
    parser.add_argument("--report",default="profile-backfill-result.jsonl")
    args=parser.parse_args()
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_KEY"):
        parser.error("SUPABASE_URL and SUPABASE_KEY are required")
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
                        result["status"]="no_data"; finish(job["id"],False,no_data=True)
            except Exception as exc:
                result["error"]=str(exc)[:2000]
                try: result["status"]=str(finish(job["id"],False,error=result["error"]))
                except Exception as finish_exc: result["finish_error"]=str(finish_exc)[:500]
            results.append(result); processed+=1
            print(json.dumps(result,ensure_ascii=False))
    with open(args.report,"w",encoding="utf-8") as handle:
        for item in results: handle.write(json.dumps(item,ensure_ascii=False)+"\n")
    summary={"processed":processed,"succeeded":sum(x["status"]=="succeeded" for x in results),
      "no_data":sum(x["status"]=="no_data" for x in results),
      "retry_or_failed":sum(x["status"] in ("pending","failed") for x in results),"report":args.report}
    print(json.dumps(summary,ensure_ascii=False))
    return 1 if any(x["status"]=="failed" for x in results) else 0


if __name__=="__main__": raise SystemExit(main())
