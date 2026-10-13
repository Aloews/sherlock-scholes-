#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import urllib.request


def call_rpc(name: str, url: str, key: str) -> dict:
    request = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/rpc/{name}",
        data=b"{}",
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def main() -> int:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_KEY are required")

    settled = call_rpc("settle_llm_paper_bankroll", url, key)
    policy = call_rpc("train_llm_paper_policy", url, key)
    settlement_row = settled[0] if isinstance(settled, list) and settled else settled
    policy_row = policy[0] if isinstance(policy, list) and policy else policy
    print(json.dumps({
        "settlement": settlement_row,
        "policy": policy_row,
    }, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
