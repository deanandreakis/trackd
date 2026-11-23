# Beta signup — end-to-end verification report (t_adb959d6)

**Date:** 23 Nov 2026 · **Verifier:** senior-dev (independent) · **Commit under test:** `78b694b`
(local `main`, 5 commits ahead of `origin/main`; backend also pushed as `origin/beta-signup-api`).

**Verdict: PARTIAL PASS.** Everything that can be exercised without AWS SES credentials and a
Netlify deploy is verified and passing, on the live site and against the real handler over real
sockets. The two acceptance criteria that require the **deployed** endpoint — a live submission
storing the address in the SES list **and** a confirmation email arriving in an inbox — are
**BLOCKED** on external credentials this worker cannot obtain (see "Blocker").

## Live-state facts (verified against the running site, not the source)

| Fact | Observed | Evidence |
| --- | --- | --- |
| `POST /api/beta-signup` on the live site | **404** | `curl -i` → `HTTP/2 404`, Netlify 404 page, `x-nf-request-id: 01M853N8…` |
| Live landing page | 200 | `curl -i https://trackd.deanware.com/` → 200 |
| Live frontend build | contract **v2** (sends consent booleans) | recorded live request body, see case 5 |
| `origin/main` | at `98ff5c2` (consent-boolean frontend); API commits **not** pushed to main | `git rev-list --count origin/main..main` = 5 |
| SES env vars anywhere in the runtime | **none** | no `AWS_*`/`SES_*`/`SIGNUP_*` keys in any profile `.env`; no `~/.aws`; no `netlify`/`aws` CLI; vault empty |
| Test inbox reachable | **no** | email block in `.env` is commented out; no himalaya account |

## Test cases

### Live (real browser against `https://trackd.deanware.com/`)

| # | Case | Result | Evidence |
| --- | --- | --- | --- |
| L1 | Consent line visible on the form | **PASS** | both `.signup-consent__row` elements `display:flex`, in-flow, non-zero box |
| L2 | Privacy-policy link visible on the form and resolves | **PASS** | link text "Privacy Policy", `href=/privacy-policy` → `https://trackd.deanware.com/privacy-policy` = **200** |
| L3 | Consent defaults | **PASS** | `beta_consent` `required=true`, unchecked; `marketing_consent` unchecked; neither pre-ticked |
| L4 | Honeypot present and unreachable | **PASS** | `name=honeypot`, `tabindex=-1`, inside `aria-hidden="true"`, empty, x = −6000 px |
| L5 | Invalid email → inline error, no network call | **PASS** | alert: "Please enter a valid email address, like you@example.com."; recorded requests: **0** |
| L6 | Consent unticked → inline error, no network call | **PASS** | alert: "Please tick the box to confirm you want the install instructions."; recorded requests: **0** |
| L7 | Valid submit issues the frozen contract request | **PASS** | `POST /api/beta-signup` body = `{"email":"…","honeypot":"","source":"homepage-hero","beta_consent":true,"marketing_consent":false}` |
| L8 | Success UI appears after submit | **PASS** | form hidden, `role=status` → "Check your inbox for install instructions." |
| L9 | Live API is not deployed → client falls back | **PASS (as designed)** | API 404 → fallback `POST /` (`form-name=trackd-test-group`, urlencoded) → success UI. **Storage is the Netlify Forms list, not SES; no SES email is sent.** |

> The fallback POST in L9 was intercepted in the browser harness so no test row was written to the
> production Netlify Forms list. The fallback path itself was exercised live.

### Local (real HTTP → real handler → real SES provider against a local SES stub)

Run: `npm test` (39/39), `node acceptance-harness.js` (6/6), `node scripts/security/adversarial-beta-signup.js`.

| # | Case | Result | Evidence |
| --- | --- | --- | --- |
| A1 | Valid POST → 200, address stored, email sent | **PASS** | `status=200 creates=1 sends=1 marker=1`; marker holds no raw address |
| A2 | Filled honeypot → 400, nothing stored/sent | **PASS** | `status=400 sesDelta=0 storeDelta=0` |
| A3 | Missing/invalid email → 400 with clear message | **PASS** | 8/8 invalid inputs → 400 "Please enter a valid email address." |
| A4 | Duplicate signup → idempotent (one row, one send) | **PASS** | `statuses=200,200 createsDelta=1 sendsDelta=1 rowsDelta=1` |
| A5 | Per-IP rate limit blocks rapid repeats | **PASS** | `codes=200,200,200,400,400,400`, other IP 200 |
| A6 | Provider outage → generic 500, no internals leaked | **PASS** | `status=500`, body has no provider name / key / stack; `leaked=[]` |
| A7 | Repo suite | **PASS** | `npm test` → **39 tests, 39 pass** |
| A8 | Adversarial probes (XFF spoofing, log injection, path encoding, send-target isolation) | **PASS** | "ALL probes report the secure behaviour" |

### Blocked (require deployed endpoint + SES creds + inbox)

| # | Case | Result |
| --- | --- | --- |
| B1 | Live submission stored in the SES contact list | **BLOCKED** |
| B2 | Confirmation email with install instructions arrives | **BLOCKED** |
| B3 | Live duplicate / provider-outage behaviour on the deployed endpoint | **BLOCKED** |

## Blocker

The endpoint cannot be deployed and exercised because the required secrets and the deploy action are
outside this worker's reach:

1. **AWS SES** — verified sending identity for `deanware.com`, production access (leave sandbox), a
   contact list, and an IAM user with `ses:SendEmail` + `ses:CreateContact`.
2. **Netlify env vars** set in the UI — `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
   `SIGNUP_FROM_EMAIL`, `SES_CONTACT_LIST`, `SIGNUP_HASH_SALT`.
3. **Deploy** of `main` (currently 5 commits ahead of `origin/main`) **after** the env vars are set.
   Deploying before they are set is unsafe: the handler returns `500` when the provider is not
   configured, and the frontend only falls back on `404`, so a premature deploy would replace a
   working capture path with inline errors.
4. **A test inbox** (an SES-verified address while the account is still sandboxed).

No `AWS_*`/`SES_*`/`SIGNUP_*` value exists anywhere in this environment, and no mailbox is
configured, so B1–B3 cannot be executed here. They are handed back to the owner.

## Defect found during verification (not a blocker)

The frontend sends `beta_consent` and `marketing_consent` (contract v2), but the API handler
**never reads them** — `grep -rn consent netlify/` returns nothing. The consent evidence the privacy
policy relies on reaches the server and is then discarded. This is a real integration gap between
the frontend and the backend contract; see the request-schema note in
`docs/beta-signup-operations.md` §2. It does not affect the pass/fail of any case above.
