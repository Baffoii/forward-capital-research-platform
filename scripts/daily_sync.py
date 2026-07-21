#!/usr/bin/env python3
"""
Daily sync for Forward Capital Research Platform.

Runs OUTSIDE the published site (which can't reach the external-tool connector
bridge in its production sandbox). Fetches fresh finance-connector data for
each watchlist company, then pushes it into the live site over HTTPS via the
/api/admin/ingest endpoint.

SEC EDGAR filing refresh and thesis-confidence recompute are triggered as many
SMALL, separate HTTP requests rather than one big /api/admin/sync-all call.
The production sandbox was observed to become unstable when a single request
does a lot of sequential work (13 companies' worth of EDGAR fetches plus
signal scoring in one execution) -- spreading that work across many small
requests, each with its own request/response lifecycle, avoided the crash in
testing. /api/admin/sync-all still exists for manual/UI use but the cron no
longer calls it.

Requires: run via `bash` with api_credentials=["external-tools"].
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

def _load_local_env():
    """Fall back to the project's gitignored .env file if the variable isn't already
    set in the process environment. Keeps the existing cron working (it doesn't set
    env vars explicitly) while keeping the real token out of git history."""
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


_load_local_env()

SITE_URL = os.environ.get("FORWARD_CAPITAL_SITE_URL", "https://forward-capital.pplx.app/port/5000")
ADMIN_TOKEN = os.environ.get("INGEST_ADMIN_TOKEN")
if not ADMIN_TOKEN:
    print("ERROR: INGEST_ADMIN_TOKEN is not set (checked environment and .env).", file=sys.stderr)
    sys.exit(1)

COMPANIES = [
    {"id": 1, "ticker": "NVDA"},
    {"id": 2, "ticker": "GOOG"},
    {"id": 3, "ticker": "AMZN"},
    {"id": 4, "ticker": "MSFT"},
    {"id": 5, "ticker": "AMD"},
    {"id": 6, "ticker": "INTC"},
    {"id": 7, "ticker": "SNDK"},
    {"id": 8, "ticker": "MU"},
    {"id": 9, "ticker": "AVGO"},
    {"id": 10, "ticker": "MRVL"},
    {"id": 11, "ticker": "VRT"},
    {"id": 12, "ticker": "BE"},
    {"id": 13, "ticker": "GEV"},
]


def call_external_tool(source_id, tool_name, arguments):
    payload = json.dumps({"source_id": source_id, "tool_name": tool_name, "arguments": arguments})
    proc = subprocess.run(
        ["external-tool", "call", payload],
        capture_output=True, text=True, timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"exit code {proc.returncode}")
    return json.loads(proc.stdout)


def http_request(method, path, body=None, headers=None, retries=3, backoff_seconds=15, timeout=60):
    """HTTP request with retries. The production sandbox has shown intermittent instability
    (fast 503s, or hangs) under heavy sequential load, so transient failures here are expected
    and worth retrying rather than treating as a hard failure."""
    req_headers = {
        "User-Agent": "Mozilla/5.0 (compatible; ForwardCapitalSync/1.0)",
        **(headers or {}),
    }
    data = None
    if body is not None:
        req_headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    last_error = None
    for attempt in range(1, retries + 1):
        req = urllib.request.Request(SITE_URL + path, data=data, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            body_text = e.read().decode()[:500]
            last_error = {"error": f"HTTP {e.code}", "body": body_text}
            if e.code not in (502, 503, 504) or attempt == retries:
                return last_error
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last_error = {"error": f"transport error: {e}"}
            if attempt == retries:
                return last_error
        print(f"  retrying {path} after transient error (attempt {attempt}/{retries}): {last_error}", file=sys.stderr)
        time.sleep(backoff_seconds * attempt)
    return last_error


def http_post(path, body, headers=None, **kwargs):
    return http_request("POST", path, body=body, headers=headers, **kwargs)


def main():
    items = []
    errors = []

    for c in COMPANIES:
        ticker = c["ticker"]
        cid = c["id"]
        for tool_type, source_id, tool_name, args in [
            ("quote", "finance", "finance_quotes", {"ticker_symbols": [ticker]}),
            ("insiders", "finance", "finance_insider_transactions", {"ticker_symbols": [ticker], "months_lookback": 6}),
            ("analysts", "finance", "finance_analyst_research", {"ticker_symbols": [ticker]}),
        ]:
            try:
                result = call_external_tool(source_id, tool_name, args)
                item = {"companyId": cid, "ticker": ticker, "type": tool_type, "result": result}
                if tool_type == "insiders":
                    item["monthsLookback"] = 6
                items.append(item)
            except Exception as e:
                errors.append(f"{ticker}/{tool_type}: {e}")

    print(f"Fetched {len(items)} items, {len(errors)} fetch errors", file=sys.stderr)
    for e in errors:
        print(f"  fetch error: {e}", file=sys.stderr)

    ingest_result = None
    if items:
        # Push in small chunks to keep each request's sequential DB-write burst short -- the
        # production sandbox has shown instability under large bursts of back-to-back writes.
        chunk_size = 5
        pushed = 0
        push_errors = 0
        chunks = [items[i:i + chunk_size] for i in range(0, len(items), chunk_size)]
        for idx, chunk in enumerate(chunks):
            resp = http_post("/api/admin/ingest", {"items": chunk}, headers={"x-admin-token": ADMIN_TOKEN})
            if isinstance(resp, dict) and "results" in resp:
                pushed += resp.get("received", 0)
                for r in resp["results"]:
                    if isinstance(r, dict) and "error" in r:
                        push_errors += 1
            else:
                push_errors += len(chunk)
                print(f"  push error: {resp}", file=sys.stderr)
            # Brief pause between chunks so the backend isn't hit with continuous back-to-back bursts.
            if idx < len(chunks) - 1:
                time.sleep(4)
        ingest_result = {"pushed": pushed, "push_errors": push_errors}

    # Refresh SEC EDGAR filings one company at a time, via separate small HTTP requests
    # (not one big loop inside a single request) -- this is the change that fixed the
    # sync-all crash under testing.
    time.sleep(4)
    filings_synced = 0
    filings_errors = 0
    for c in COMPANIES:
        resp = http_request(
            "POST",
            f"/api/companies/{c['id']}/sync/filings",
            body={},
            retries=2,
            backoff_seconds=10,
            timeout=30,
        )
        if isinstance(resp, dict) and "error" in resp:
            filings_errors += 1
            print(f"  filings sync error for {c['ticker']}: {resp}", file=sys.stderr)
        else:
            filings_synced += 1
        time.sleep(1.5)

    # Recompute thesis confidence in its own separate, lightweight request.
    time.sleep(4)
    recompute_resp = http_post("/api/admin/recompute-all", {}, headers={"x-admin-token": ADMIN_TOKEN})

    summary = {
        "fetched_items": len(items),
        "fetch_errors": len(errors),
        "ingest_result": ingest_result,
        "filings_synced": filings_synced,
        "filings_errors": filings_errors,
        "sync_all_theses": recompute_resp.get("theses") if isinstance(recompute_resp, dict) else recompute_resp,
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
