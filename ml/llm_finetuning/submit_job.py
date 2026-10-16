#!/usr/bin/env python3
"""Submit only when explicitly requested to an OpenAI-compatible fine-tuning API."""
import argparse, json, os, uuid, urllib.error, urllib.request
from pathlib import Path


def api_request(url,key,data,content_type="application/json"):
    req=urllib.request.Request(url,data=data,method="POST",headers={"Authorization":"Bearer "+key,"Content-Type":content_type})
    try:
        with urllib.request.urlopen(req,timeout=120) as response: return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail=exc.read().decode("utf-8","replace")[:2000]
        raise RuntimeError(f"provider HTTP {exc.code}: {detail}") from exc


def upload_file(base,key,path):
    boundary="----sherlock-scholes-"+uuid.uuid4().hex
    data=Path(path).read_bytes()
    body=(f"--{boundary}\r\nContent-Disposition: form-data; name=\"purpose\"\r\n\r\nfine-tune\r\n"
      f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{Path(path).name}\"\r\n"
      "Content-Type: application/jsonl\r\n\r\n").encode()+data+f"\r\n--{boundary}--\r\n".encode()
    return api_request(base.rstrip("/")+"/files",key,body,"multipart/form-data; boundary="+boundary)


def main():
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument("--artifact-dir",default="artifacts/llm-finetuning")
    parser.add_argument("--submit",action="store_true"); args=parser.parse_args()
    root=Path(args.artifact_dir); manifest=json.loads((root/"manifest.json").read_text(encoding="utf-8"))
    if not args.submit:
        print(json.dumps({"dry_run":True,"manifest":manifest},ensure_ascii=False)); return 0
    base=os.environ.get("FT_BASE_URL","").strip(); key=os.environ.get("FT_API_KEY",""); model=os.environ.get("FT_MODEL","").strip()
    if not base or not key or not model: raise SystemExit("FT_BASE_URL, FT_API_KEY and FT_MODEL are required")
    if manifest["examples"]<200: raise SystemExit("Refusing to submit fewer than 200 verified examples")
    train=upload_file(base,key,root/"train.jsonl"); valid=upload_file(base,key,root/"validation.jsonl")
    payload=json.dumps({"model":model,"training_file":train["id"],"validation_file":valid["id"],
      "suffix":"sherlock-scholes-"+manifest["input_sha256"][:10]}).encode()
    job=api_request(base.rstrip("/")+"/fine_tuning/jobs",key,payload)
    result={"job_id":job.get("id"),"status":job.get("status"),"model":model,
      "training_file":train["id"],"validation_file":valid["id"],"holdout_uploaded":False,
      "input_sha256":manifest["input_sha256"]}
    print(json.dumps(result,ensure_ascii=False))
    if not result["job_id"]: raise SystemExit("Provider response did not include a job id")
    return 0


if __name__=="__main__": raise SystemExit(main())
