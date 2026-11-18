# Live consent verification — beta signup form (task t_aea9766e)

Verification of the deployed consent mechanism on `https://trackd.deanware.com/`,
run 18 Nov 2026 against the live site with a real browser (1440x900 viewport).
Companion to `signup-consent-snippet.html` (t_bf47c595) and
`docs/beta-email-consent-runbook.md` (wording + operating paths).

## What the form is

The consent block is **not** JS-rendered: it is static markup inside
`<form id="signup-form" name="trackd-test-group">` in `index.html`, which is what
Netlify parses at deploy time. The submit handler only serialises that form with
`new URLSearchParams(new FormData(form))`, so no `public/__forms.html` skeleton is
required — a skeleton is only needed when the fields do not exist in the built
HTML. The served page's `<form>` tag is Netlify's own re-serialisation: it drops
`data-netlify` / `netlify-honeypot` and rewrites `/privacy-policy.html` to
`/privacy-policy`. That is expected (see `docs/beta-signup-email-capture.md`).

## Verified on the live site

| Check | Result |
|---|---|
| Both ticks present and **unticked by default** (fresh load) | PASS — `beta_consent.checked=false`, `marketing_consent.checked=false` |
| `beta_consent` marked `required`, `marketing_consent` optional | PASS — `required=true` / `required=false` |
| Purposes not merged: required tick = install instructions + beta-group messages; optional tick = product news/tips | PASS — two separate labels, two separate names |
| Consent block links to `/privacy-policy` (both labels) | PASS — `/privacy-policy` returns HTTP 200 with the new policy |
| Styling matches the form: checkbox left of label, small muted text | PASS — flex row, checkbox first, 12.5px `#6b7280` |
| Submit with the beta tick unticked is blocked | PASS — 0 network requests, `checkValidity()=false`, message "Please check this box if you want to proceed." |
| Submit with the beta tick ticked | PASS — `POST /` → HTTP 200 → success state "Check your inbox for install instructions." |
| Wire format, beta only | `form-name=trackd-test-group&email=…&beta_consent=on&bot-field=` (marketing field omitted when unticked) |
| Wire format, both ticks | `form-name=trackd-test-group&email=…&beta_consent=on&marketing_consent=on&bot-field=` |

Test row created by that submit (delete per runbook part 3):
`kanban-consent-verify@example.com` — plus the earlier
`kanban-test+signup@example.com` from task t_a856a8fb.

## Still open — requires Netlify access

The one acceptance criterion a worker cannot self-check is the **store read-back**:
that the row lands in Forms → `trackd-test-group` **with `beta_consent: on`**.
Netlify's form store is not publicly readable and no usable Netlify token was
available in this environment (the token found in the orchestrator log returns
HTTP 401 — revoked or expired).

Run the check with a current personal access token:

```bash
export NETLIFY_TOKEN=nfp_...        # never commit; Netlify > Applications > Personal access tokens
python3 scripts/verify-netlify-forms-consent.py
```

It prints the form's registered fields (`email`, `beta_consent`, …) and the most
recent submissions with `beta_consent` / `marketing_consent`, and exits non-zero
if any listed submission lacks `beta_consent`. Read-only; the deletion path for
the test rows is runbook part 3a (`DELETE /submissions/{id}`).
