#!/usr/bin/env python3
"""Validate and chronologically split verified pre-match examples for fine-tuning."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def parse_time(value):
    if not value: raise ValueError("timestamp is required")
    parsed=datetime.fromisoformat(str(value).replace("Z","+00:00"))
    if parsed.tzinfo is None: raise ValueError("timestamps must include a timezone")
    return parsed.astimezone(timezone.utc)


def load_examples(path):
    examples=[]; seen=set()
    with open(path,encoding="utf-8") as handle:
        for line_number,line in enumerate(handle,1):
            if not line.strip(): continue
            try:
                row=json.loads(line); fixture_id=str(row["fixture_id"])
                kickoff=parse_time(row["commence_at"]); feature_cutoff=parse_time(row["feature_cutoff_at"])
                odds_at=parse_time(row["odds_snapshot_at"]); settled_at=parse_time(row["settled_at"])
                target=row["target_outcome"]; context=row["input_context"]
                if target not in {"home","draw","away"}: raise ValueError("target_outcome must be home/draw/away")
                if not isinstance(context,dict) or not context: raise ValueError("input_context must be a non-empty object")
                if feature_cutoff>=kickoff or odds_at>=kickoff or settled_at<kickoff:
                    raise ValueError("temporal leakage or unsettled example")
                if fixture_id in seen: raise ValueError("duplicate fixture_id")
                seen.add(fixture_id)
                examples.append({"fixture_id":fixture_id,"commence_at":kickoff,"input_context":context,
                  "target_outcome":target,"feature_cutoff_at":feature_cutoff,"odds_snapshot_at":odds_at,"settled_at":settled_at})
            except Exception as exc: raise ValueError(f"{path}:{line_number}: {exc}") from exc
    return sorted(examples,key=lambda item:(item["commence_at"],item["fixture_id"]))


def chat_row(example):
    context=json.dumps(example["input_context"],ensure_ascii=False,sort_keys=True)
    answer=json.dumps({"outcome":example["target_outcome"]},separators=(",",":"))
    return {"messages":[
      {"role":"system","content":"You are a football forecasting model. Use only the supplied pre-match context. Return exactly one JSON object with outcome equal to home, draw, or away. Do not claim certainty."},
      {"role":"user","content":"Predict the 1X2 outcome from this pre-match context:\n"+context},
      {"role":"assistant","content":answer}]}


def write_jsonl(path,rows):
    with open(path,"w",encoding="utf-8") as handle:
        for row in rows: handle.write(json.dumps(row,ensure_ascii=False)+"\n")


def prepare(input_path,output_dir,min_examples=200):
    examples=load_examples(input_path); n=len(examples)
    if n<min_examples: raise ValueError(f"need at least {min_examples} verified examples; got {n}")
    train_end=int(n*0.70); valid_end=int(n*0.85)
    if train_end<1 or valid_end<=train_end or n-valid_end<1:
        raise ValueError("not enough examples for chronological train/validation/holdout")
    splits={"train.jsonl":examples[:train_end],"validation.jsonl":examples[train_end:valid_end],"holdout.jsonl":examples[valid_end:]}
    output=Path(output_dir); output.mkdir(parents=True,exist_ok=True)
    for name,rows in splits.items(): write_jsonl(output/name,[chat_row(row) for row in rows])
    digest=hashlib.sha256(Path(input_path).read_bytes()).hexdigest()
    manifest={"schema_version":1,"input_sha256":digest,"examples":n,
      "split_policy":"chronological 70/15/15; no random shuffle",
      "counts":{name:len(rows) for name,rows in splits.items()},
      "ranges":{name:{"from":rows[0]["commence_at"].isoformat(),"to":rows[-1]["commence_at"].isoformat()} for name,rows in splits.items()},
      "holdout_is_never_uploaded":True}
    (output/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input",required=True); parser.add_argument("--output-dir",default="artifacts/llm-finetuning")
    parser.add_argument("--min-examples",type=int,default=200); args=parser.parse_args()
    print(json.dumps(prepare(args.input,args.output_dir,args.min_examples),ensure_ascii=False,indent=2))


if __name__=="__main__": main()
