#!/usr/bin/env python3
"""Delete beta-signup emails from the Netlify Forms store.

Executable form of docs/signup-list-data-deletion-procedure.md. This is the
"how it is deleted" half of the promise in privacy-policy.html section 6.

SAFETY: every mode is a DRY RUN unless you pass --confirm. Deletions are
permanent (Netlify has no undo and no automatic expiry).

Usage:
    export NETLIFY_TOKEN=nfp_...        # Netlify PAT: Applications > Personal access tokens
    python3 scripts/delete-signup-data.py --list
    python3 scripts/delete-signup-data.py --email someone@example.com
    python3 scripts/delete-signup-data.py --email someone@example.com --confirm
    python3 scripts/delete-signup-data.py --sweep --older-than-days 395 --confirm

Options:
    --site NAME        site slug                     (default trackd-deanware)
    --form NAME        form name                     (default trackd-test-group)
    --list             list stored submissions (verified + spam) and exit
    --email ADDRESS    select submissions for that address (case-insensitive)
    --sweep            select submissions older than --older-than-days
    --older-than-days  retention cutoff for --sweep  (default 395)
    --confirm          actually DELETE; without it nothing is modified
    --show-email       print full addresses (default: masked, e.g. a***@example.com)

Environment:
    NETLIFY_TOKEN      required. Never commit it, never echo it into a log.
    NETLIFY_API_BASE   override the API base (tests only).
    NETLIFY_UA         override the User-Agent.

Exit codes: 0 = success, 1 = nothing matched / nothing to do, 2 = config or API error.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

DEFAULT_API = "https://api.netlify.com/api/v1"
DEFAULT_UA = "trackd-deletion (trackd@deanware.com)"


class ApiError(RuntimeError):
    pass


def mask(email: str | None) -> str:
    """Mask an address so routine output is not a PII dump: jane@x.com -> j***@x.com."""
    if not email or "@" not in email:
        return "***"
    local, _, domain = email.partition("@")
    keep = local[:1]
    return f"{keep}{'*' * max(len(local) - 1, 3)}@{domain}"


def api(method: str, path: str, token: str, base: str, ua: str):
    """Call the API. Returns (status, parsed-body-or-text, link-header).

    GET/LIST bodies are JSON; a 204/empty DELETE body comes back as ''.
    """
    req = urllib.request.Request(
        base + path, method=method, headers={"Authorization": f"Bearer {token}", "User-Agent": ua}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode() or ""
            link = resp.headers.get("Link", "")
            body = json.loads(raw) if raw.strip() else None
            return resp.status, body, link
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:400]
        raise ApiError(f"{method} {path} -> HTTP {exc.code}: {detail}") from None
    except Exception as exc:  # network, DNS, JSON decode
        raise ApiError(f"{method} {path} -> {exc}") from None


def find_site(token: str, base: str, ua: str, slug: str) -> str:
    status, sites, _ = api("GET", "/sites?per_page=100", token, base, ua)
    if status != 200 or not isinstance(sites, list):
        raise ApiError(f"could not list sites (HTTP {status})")
    site = next((s for s in sites if s.get("name") == slug), None)
    if not site:
        raise ApiError(f"site {slug!r} not found on this account")
    return site["id"]


def find_form(token: str, base: str, ua: str, site_id: str, name: str) -> str:
    status, forms, _ = api("GET", f"/sites/{site_id}/forms", token, base, ua)
    if status != 200 or not isinstance(forms, list):
        raise ApiError(f"could not list forms (HTTP {status})")
    form = next((f for f in forms if f.get("name") == name), None)
    if not form:
        raise ApiError(f"form {name!r} is not registered; registered: {[f.get('name') for f in forms]}")
    return form["id"]


def list_submissions(token: str, base: str, ua: str, form_id: str, state: str | None = None):
    """All submissions for a form, paginating via the Link header."""
    out, path = [], f"/forms/{form_id}/submissions?per_page=100" + (f"&state={state}" if state else "")
    while path:
        _, page, link = api("GET", path, token, base, ua)
        if not isinstance(page, list):
            raise ApiError(f"unexpected submissions payload for {path}")
        out.extend(page)
        nxt = ""
        for part in link.split(","):
            if 'rel="next"' in part:
                nxt = part.split(";")[0].strip().strip("<>")
        path = nxt.replace(base, "") if nxt else ""
    return out


def parse_created(sub) -> datetime | None:
    raw = sub.get("created_at")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Delete beta signup emails from Netlify Forms (dry run by default).")
    ap.add_argument("--site", default="trackd-deanware")
    ap.add_argument("--form", default="trackd-test-group")
    ap.add_argument("--email")
    ap.add_argument("--list", action="store_true", help="list stored submissions and exit")
    ap.add_argument("--sweep", action="store_true", help="select submissions older than --older-than-days")
    ap.add_argument("--older-than-days", type=int, default=395)
    ap.add_argument("--confirm", action="store_true", help="actually delete (default is a dry run)")
    ap.add_argument("--show-email", action="store_true", help="print unmasked addresses")
    args = ap.parse_args()

    if not (args.list or args.email or args.sweep):
        ap.error("nothing to do: pass --list, --email ADDRESS or --sweep")
    if args.email and args.sweep:
        ap.error("use either --email or --sweep, not both")

    token = os.environ.get("NETLIFY_TOKEN", "").strip()
    if not token:
        print(
            "NETLIFY_TOKEN is not set. Create a personal access token at Netlify > Applications > "
            "Personal access tokens, export it, and re-run. See "
            "docs/signup-list-data-deletion-procedure.md section 4.",
            file=sys.stderr,
        )
        return 2
    base = os.environ.get("NETLIFY_API_BASE", DEFAULT_API).rstrip("/")
    ua = os.environ.get("NETLIFY_UA", DEFAULT_UA)
    show = (lambda e: e or "?") if args.show_email else mask

    try:
        site_id = find_site(token, base, ua, args.site)
        form_id = find_form(token, base, ua, site_id, args.form)
        rows = list_submissions(token, base, ua, form_id, "verified")
        spam = list_submissions(token, base, ua, form_id, "spam")
    except ApiError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    for sub in spam:
        sub["_state"] = "spam"
    for sub in rows:
        sub["_state"] = "verified"
    all_rows = rows + spam
    print(f"site={args.site}  form={args.form}  stored: {len(rows)} verified, {len(spam)} spam")

    if args.list:
        for sub in all_rows:
            data = sub.get("data") or {}
            print(
                f"  [{sub['_state']}] {sub.get('created_at')}  {show(data.get('email'))}"
                f"  beta_consent={data.get('beta_consent')!r}"
                f"  marketing_consent={data.get('marketing_consent')!r}  id={sub.get('id')}"
            )
        return 0

    if args.email:
        want = args.email.strip().lower()
        matches = [s for s in all_rows if str((s.get("data") or {}).get("email", "")).strip().lower() == want]
        what = f"address {show(args.email)}"
    else:
        cutoff = datetime.now(timezone.utc) - timedelta(days=args.older_than_days)
        matches = [
            s for s in all_rows if (d := parse_created(s)) is not None and d < cutoff
        ]
        what = f"submissions older than {args.older_than_days} days (before {cutoff.date()})"

    if not matches:
        print(f"no submissions match {what} — nothing to do")
        return 1

    print(f"\n{len(matches)} submission(s) match {what}:")
    for sub in matches:
        data = sub.get("data") or {}
        print(
            f"  [{sub['_state']}] {sub.get('created_at')}  {show(data.get('email'))}"
            f"  id={sub.get('id')}"
        )

    if not args.confirm:
        print(
            "\nDRY RUN — nothing was deleted. Re-run with --confirm to delete the rows above.\n"
            "A deletion also means: remove the address from any mailing list and add it to the\n"
            "suppression list (do-not-contact.csv). See "
            "docs/signup-list-data-deletion-procedure.md sections 3 and 5."
        )
        return 0

    deleted = 0
    for sub in matches:
        try:
            api("DELETE", f"/submissions/{sub.get('id')}", token, base, ua)
        except ApiError as exc:
            print(f"  FAILED id={sub.get('id')}: {exc}", file=sys.stderr)
            continue
        deleted += 1
        print(f"  deleted id={sub.get('id')} ({show((sub.get('data') or {}).get('email'))})")

    print(
        f"\ndeleted {deleted} of {len(matches)}. Next: remove the address from any mailing list and add "
        "it to the suppression list, then log the request and reply to the requester."
    )
    return 0 if deleted == len(matches) else 1


if __name__ == "__main__":
    raise SystemExit(main())
