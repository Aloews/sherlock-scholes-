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
import unicodedata
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


COUNTRY_CODE_EQUIVALENTS = {
    "ES": {"ESP"}, "BR": {"BRA"}, "AR": {"ARG"}, "MX": {"MEX"},
    "PT": {"POR"}, "TR": {"TUR"}, "UY": {"URU"}, "FR": {"FRA"},
    "IT": {"ITA"}, "DK": {"DEN"}, "RS": {"SRB", "SCG"},
    "ME": {"MNE"}, "CZ": {"CZE"}, "CM": {"CMR"}, "IS": {"ISL"},
    "CH": {"SUI"}, "SK": {"SVK"}, "BE": {"BEL"}, "CO": {"COL"},
    "GB": {"ENG", "WAL", "SCO", "NIR", "GBR"}, "GN": {"GUI"},
    "CL": {"CHI"}, "DE": {"GER"}, "HR": {"CRO"}, "PL": {"POL"},
    "RU": {"RUS"}, "SN": {"SEN"}, "IE": {"IRL"}, "NG": {"NGA"},
    "ML": {"MLI"}, "NL": {"NED"}, "NO": {"NOR"}, "SE": {"SWE"},
    "FI": {"FIN"}, "UA": {"UKR"}, "AT": {"AUT"}, "RO": {"ROU"},
    "BG": {"BUL"}, "SI": {"SVN"}, "MK": {"MKD"}, "BA": {"BIH"},
    "AL": {"ALB"}, "GR": {"GRE"}, "US": {"USA"}, "CA": {"CAN"},
    "AU": {"AUS"}, "NZ": {"NZL"}, "ZA": {"RSA"}, "EG": {"EGY"},
    "MA": {"MAR"}, "DZ": {"ALG"}, "TN": {"TUN"}, "CI": {"CIV"},
    "CD": {"COD"}, "GH": {"GHA"}, "BF": {"BFA"}, "PE": {"PER"},
    "EC": {"ECU"}, "PY": {"PAR"}, "VE": {"VEN"}, "CR": {"CRC"},
    "HN": {"HON"}, "SV": {"SLV"}, "JM": {"JAM"}, "TT": {"TRI"},
    "IL": {"ISR"}, "IR": {"IRN"}, "SA": {"KSA"}, "QA": {"QAT"},
    "AE": {"UAE"}, "CN": {"CHN"}, "KR": {"KOR"}, "IN": {"IND"},
    "ID": {"IDN"}, "TH": {"THA"}, "MY": {"MAS"}, "SG": {"SGP"},
    "KZ": {"KAZ"}, "GE": {"GEO"}, "AM": {"ARM"}, "AZ": {"AZE"},
}


def normalized_name_tokens(value):
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return set(re.findall(r"[a-z0-9]+", normalized.casefold()))


def profile_matches_card(card, profile):
    card_country = str(card.get("country") or "").strip().upper()
    profile_country = str(profile.get("nation_code") or "").strip().upper()
    expected_codes = COUNTRY_CODE_EQUIVALENTS.get(card_country)
    if expected_codes and profile_country and profile_country not in expected_codes:
        return False

    card_born = str(card.get("born_on") or "")[:10]
    profile_born = str(profile.get("born_on") or "")[:10]
    birth_match = bool(card_born and profile_born and card_born == profile_born)
    if card_born and profile_born and card_born != profile_born:
        return False

    profile_names = (profile.get("full_name"), profile.get("name"))
    card_names = (card.get("name_en"), card.get("name"))
    for card_name in card_names:
        card_tokens = normalized_name_tokens(card_name)
        if not card_tokens:
            continue
        for profile_name in profile_names:
            profile_tokens = normalized_name_tokens(profile_name)
            if not profile_tokens:
                continue
            if card_tokens == profile_tokens:
                return True
            if len(card_tokens) >= 2 and card_tokens.issubset(profile_tokens):
                return True
            # Soccer Wiki can prepend a family name (e.g. "Júnior Neymar")
            # while the card uses a mononym. A shared token plus an exact
            # birth date is strong evidence; without the date, reject namesakes.
            if birth_match and card_tokens.intersection(profile_tokens):
                return True
    return False


def classify_result(exit_code, output, verified):
    folded = output.casefold()
    # A successful read-after-write check is authoritative: an earlier source
    # may have failed after another fallback already persisted a valid photo.
    if verified:
        return "succeeded"
    if exit_code != 0 or any(marker in folded for marker in (
        "профилей потеряно", "игроков потеряно", "потеряно пачек",
        "запись отклонена у",
    )):
        return "retry"

    # A zero-photo result is not genuine absence when all regional hosts failed
    # to respond or reported throttling/temporary access errors. Keep the task
    # retryable so a transient source outage cannot strand the card in no_data.
    regional = re.search(r"regional portrait requests?:\s*([^\n]+)", folded)
    if regional and re.search(
        r"no_response|timeout|connection[_ ]?(?:error|reset)|"
        r"http[_ ]?(?:403|429|5\d\d)|\b(?:403|429|5\d\d)\b|robot|blocked",
        regional.group(1),
    ):
        return "retry"

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
    try:
        with urllib.request.urlopen(req,timeout=90) as response:
            raw=response.read()
    except urllib.error.HTTPError as exc:
        # Include the upstream PostgREST/Postgres diagnostic, but never echo
        # credentials or authorization headers into Actions logs.
        try:
            detail = exc.read(4096).decode("utf-8", errors="replace")
        except Exception:
            detail = ""
        detail = re.sub(r"(?i)(authorization\\s*[:=]\\s*bearer\\s+)\\S+", r"\\1[REDACTED]", detail)
        for secret in (key, os.environ.get("SUPABASE_KEY", "")):
            if secret:
                detail = detail.replace(secret, "[REDACTED]")
        detail = re.sub(r"(?i)(service_role|sb_secret)_[A-Za-z0-9_-]{8,}", "[REDACTED]", detail)
        detail = re.sub(r"(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token)(\\s*[:=]\\s*)[^,\\s\\\"]+", r"\\1\\2[REDACTED]", detail)
        detail = " ".join(detail.split())[:2500]
        raise RuntimeError(
            f"Supabase HTTP {exc.code} for {method} {path}: "
            f"{detail or exc.reason}"
        ) from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Supabase network error for {method} {path}: {exc.reason}") from None
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
        cards=request("cards",{"select":"id,name,name_en,country,photo_url,born_on","id":"eq."+job["card_id"],"limit":"1"})
        if not cards:
            return "Фото найдено: 0\\nPlayer card not found",0
        card=cards[0]
        source=request("soccerwiki_player",{
            "select":"name,full_name,photo_url,nation_code,born_on",
            "card_id":"eq."+job["card_id"],"order":"pid.asc"
        })
        candidates=[row for row in source
                    if usable_photo(row.get("photo_url")) and profile_matches_card(card,row)]
        if not candidates:
            return "Фото найдено: 0\\nNo identity-verified Soccer Wiki photo matches card",0
        url=next((row.get("photo_url") for row in candidates
                  if image_reachable(row.get("photo_url"))),None)
        if not url:
            return "ПРОФИЛЕЙ ПОТЕРЯНО: matching Soccer Wiki photo URLs are unreachable",1
        request("cards",params={"id":"eq."+job["card_id"],"or":"(photo_url.is.null,photo_url.eq.)"},
                method="PATCH",body={"photo_url":url})
        rows=request("cards",{"select":"id,photo_url","id":"eq."+job["card_id"],"limit":"1"})
        if rows and rows[0].get("photo_url")==url and image_reachable(rows[0].get("photo_url")):
            return "Фото найдено: 1\\nЗаписано: 1\\nИсточник: Soccer Wiki",0
        if rows and usable_photo(rows[0].get("photo_url")) and image_reachable(rows[0].get("photo_url")):
            return "Фото найдено: 1\\nКарточка уже содержит доступное фото",0
        return "Фото найдено: 1\\nRead-after-write verification failed",0
    if task in ("photo_qid", "photo_tm"):
        outputs = []
        failures = []
        qid_output = ""
        qid_exit = 0
        tm_attempted = False
        if job.get("wikidata_qid") or task == "photo_qid":
            qid_command = [sys.executable, "docs/cards_photo_from_qid.py",
                           "--only-card-id", str(job["card_id"])]
            qid_result = subprocess.run(qid_command, cwd=ROOT, env=dict(os.environ, APPLY="1"),
                text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=360)
            qid_output = qid_result.stdout[-12000:]
            outputs.append("Wikidata attempt:\n" + qid_output)
            qid_exit = qid_result.returncode
            if qid_exit == 0 and re.search(r"фото найдено\s*:\s*[1-9]\d*", qid_output.casefold()):
                return qid_output + "\nИсточник: Wikidata", 0
            if qid_exit != 0:
                failures.append(qid_exit)

        if task == "photo_tm" or job.get("transfermarkt_id"):
            tm_attempted = True
            tm_command = [sys.executable, "docs/cards_photo_transfermarkt.py",
                          "--only", str(job["transfermarkt_id"])]
            tm_result = subprocess.run(tm_command, cwd=ROOT, env=dict(os.environ, APPLY="1"),
                text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=360)
            tm_output = tm_result.stdout[-12000:]
            outputs.append("Transfermarkt attempt:\n" + tm_output)
            if tm_result.returncode == 0 and (
                re.search(r"portraits found\s*:\s*[1-9]\d*", tm_output.casefold())
                or re.search(r"портретов найдено\s*:\s*[1-9]\d*", tm_output.casefold())
            ):
                return tm_output + "\nИсточник: Transfermarkt после Wikidata", 0
            if tm_result.returncode != 0:
                failures.append(tm_result.returncode)

        combined = "\n".join(outputs)[-12000:]
        qid_zero = bool(re.search(r"фото найдено\s*:\s*0(?:\D|$)", qid_output.casefold()))
        tm_zero = bool(re.search(
            r"(?:portraits found|портретов найдено)\s*:\s*0(?:\D|$)",
            combined.casefold()
        ))
        if failures:
            return combined, failures[-1]
        if (not qid_output or qid_zero) and (tm_zero or not tm_attempted):
            return combined, 0
        return combined, 1

    if task=="season_stats":
        command=[sys.executable,"docs/players_stats_transfermarkt.py","--only",str(job["transfermarkt_id"]),"--include-unvalued"]
    else:
        raise ValueError("Unsupported task type: "+str(task))
    result=subprocess.run(command,cwd=ROOT,env=dict(os.environ,APPLY="1"),text=True,
      stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=360)
    output=result.stdout[-12000:]
    return output,result.returncode


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
    """Fail only when a job reaches terminal failure; pending retries are expected."""
    final_results = final_job_results(results)
    return 1 if any(item.get("status") == "failed" for item in final_results) else 0


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
