#!/usr/bin/env python3
"""Export settled, temporally valid examples through the service-role RPC."""
import json, os, urllib.request
from pathlib import Path


def main():
    base=os.environ["SUPABASE_URL"].rstrip("/"); key=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    req=urllib.request.Request(base+"/rest/v1/rpc/export_llm_finetune_examples",data=b"{}",method="POST",
      headers={"apikey":key,"Authorization":"Bearer "+key,"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=120) as response: rows=json.loads(response.read())
    output=Path("artifacts/llm-finetuning/raw_examples.jsonl"); output.parent.mkdir(parents=True,exist_ok=True)
    with output.open("w",encoding="utf-8") as handle:
        for row in rows: handle.write(json.dumps(row,ensure_ascii=False)+"\n")
    print(json.dumps({"exported":len(rows),"path":str(output)},ensure_ascii=False))
    if not rows: raise SystemExit("No verified settled examples. Fine-tuning is not ready.")


if __name__=="__main__": main()
