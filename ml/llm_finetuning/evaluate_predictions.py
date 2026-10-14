#!/usr/bin/env python3
"""Evaluate predictions on a held-out, later time window; no training-set metrics."""
import argparse
import json
import math
from pathlib import Path


def evaluate(path, minimum=30):
    rows=[]
    with open(path,encoding="utf-8") as handle:
        for number,line in enumerate(handle,1):
            if not line.strip(): continue
            row=json.loads(line)
            actual=row.get("actual_outcome"); predicted=row.get("predicted_outcome")
            if actual not in {"home","draw","away"} or predicted not in {"home","draw","away"}:
                raise ValueError(f"{path}:{number}: outcomes must be home/draw/away")
            rows.append(row)
    if len(rows)<minimum: raise ValueError(f"need at least {minimum} holdout predictions; got {len(rows)}")
    accuracy=sum(r["actual_outcome"]==r["predicted_outcome"] for r in rows)/len(rows)
    result={"n":len(rows),"accuracy":accuracy,"correct":sum(r["actual_outcome"]==r["predicted_outcome"] for r in rows)}
    probability_rows=[r for r in rows if isinstance(r.get("probabilities"),dict)]
    if probability_rows:
        brier=0.0; log_loss=0.0
        for row in probability_rows:
            probs=row["probabilities"]
            if any(not isinstance(probs.get(k),(int,float)) or not 0<=probs[k]<=1 for k in ("home","draw","away")):
                raise ValueError("probabilities must contain home/draw/away values in [0,1]")
            total=sum(probs[k] for k in ("home","draw","away"))
            if abs(total-1.0)>0.02: raise ValueError("probabilities must sum to approximately 1")
            for key in ("home","draw","away"):
                target=1.0 if row["actual_outcome"]==key else 0.0
                brier+=(probs[key]-target)**2
            log_loss-=math.log(max(1e-12,probs[row["actual_outcome"]]))
        result["probability_n"]=len(probability_rows)
        result["brier_score"]=brier/(len(probability_rows)*3)
        result["log_loss"]=log_loss/len(probability_rows)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predictions",required=True); parser.add_argument("--minimum",type=int,default=30)
    parser.add_argument("--output",default="artifacts/llm-finetuning/evaluation.json")
    args=parser.parse_args(); result=evaluate(args.predictions,args.minimum)
    output=Path(args.output); output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(result,indent=2))


if __name__=="__main__": main()
