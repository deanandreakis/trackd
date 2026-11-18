#!/usr/bin/env python3
"""Verify the beta signup consent evidence in Netlify Forms.

Companion to docs/beta-email-consent-runbook.md part 3a. Read-only: it never
deletes anything. Use it to confirm the acceptance criterion for task
t_aea9766e — a live submission is stored with `beta_consent: on` — which can
only be checked with Netlify API access (the store is not publicly readable).

Usage:
    export NETLIFY_TOKEN=nfp_...          # Netlify PAT, never commit it
    python3 scripts/verify-netlify-forms-consent.py [--site trackd-deanware] \
        [--form trackd-test-group] [--limit 10]

Exit codes: 0 = form found and every listed submission carries beta_consent;
1 = form missing, no submissions, or a submission lacks beta_consent;
2 = configuration/API error.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

API = "https://api.netlify.com/api/v1"
UA = "trackd-consent-verify (trackd@deanware.com)"


def api(path: str, token: str) -> tuple[int, Any]:
    req = urllib.request.Request(
        API + path,
        headers={"Authorization": f"Bearer {token}", "User-Agent": UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:400]
    except Exception as exc:  # network, DNS, JSON
        return -1, str(exc)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="trackd-deanware")
    ap.add_argument("--form", default="trackd-test-group")
    ap.add_argument("--limit", type=int, default=10)
    args = ap.parse_args()

    token = os.environ.get("NETLIFY_TOKEN", "").strip()
    if not token:
        print("NETLIFY_TOKEN is not set. Create a personal access token in "
              "Netlify > Applications > Personal access tokens.", file=sys.stderr)
        return 2

    status, sites = api("/sites?per_page=100", token)
    if status != 200:
        print(f"GET /sites failed: HTTP {status} {sites}", file=sys.stderr)
        return 2
    site = next((s for s in sites if s.get("name") == args.site), None)
    if not site:
        print(f"site {args.site!r} not found in this account", file=sys.stderr)
        return 2

    status, forms = api(f"/sites/{site['id']}/forms", token)
    if status != 200:
        print(f"GET /sites/{site['id']}/forms failed: HTTP {status} {forms}", file=sys.stderr)
        return 2
    form = next((f for f in forms if f.get("name") == args.form), None)
    if not form:
        print(f"form {args.form!r} is NOT registered on {args.site}", file=sys.stderr)
        print("registered forms:", [f.get("name") for f in forms], file=sys.stderr)
        return 1

    fields = [f.get("name") for f in form.get("fields", [])]
    print(f"form: {form['name']}  id={form['id']}")
    print(f"registered fields: {fields}")
    for required in ("email", "beta_consent"):
        print(f"  {'OK  ' if required in fields else 'MISS'} field {required}")

    status, subs = api(f"/forms/{form['id']}/submissions?per_page={args.limit}", token)
    if status != 200:
        print(f"GET submissions failed: HTTP {status} {subs}", file=sys.stderr)
        return 2
    if not subs:
        print("no submissions stored yet", file=sys.stderr)
        return 1

    ok = True
    print(f"\n{len(subs)} most recent submission(s):")
    for sub in subs:
        data = sub.get("data") or {}
        beta = data.get("beta_consent")
        market = data.get("marketing_consent")
        print(f"  {sub.get('created_at')}  email={data.get('email')!r}  "
              f"beta_consent={beta!r}  marketing_consent={market!r}  id={sub.get('id')}")
        if str(beta).lower() not in ("on", "true"):
            ok = False

    print("\nRESULT:", "PASS — every listed submission carries beta_consent"
          if ok else "FAIL — a submission is missing beta_consent")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
