# Beta signup operations guide

Operator reference for the Trackd beta signup feature: the HTTP endpoint, the
request and response contract, the email service, where the signup list lives,
the configuration keys, the confirmation email contents, and the rate-limit and
duplicate semantics.

Everything here is derived from the code and was verified by running the test
suite (`npm test`, 48/48 pass) and by rendering the confirmation email through
`netlify/lib/confirmation-email.js`.

## 0. Deployment status (verified 23 Nov 2026)

**The endpoint is written and committed but NOT deployed.** This document
describes the code's behaviour; the live site does not yet run it.

| | |
| --- | --- |
| `POST https://trackd.deanware.com/api/beta-signup` | **404** (route not deployed) |
| `origin/main` | `98ff5c2` — API commits are **not** on main |
| Backend commits | local `main` `78b694b` (5 ahead of `origin/main`); pushed as branch `beta-signup-api` |
| Live capture today | the page's 404-only fallback POSTs to the registered Netlify Form `trackd-test-group` |

Deploying `main` **before** the SES environment variables are set (section 5) is
unsafe: the handler returns `500` when the provider is not configured, and the
frontend falls back only on `404`, so a premature deploy replaces a working
capture path with inline errors. Set the env vars, then deploy.

End-to-end evidence for the above (live checks + local harness) is in
`docs/beta-signup-e2e-verification.md`.

Design rationale and background live in `docs/beta-signup-email-capture.md`.
This guide is the operational view: enough to call the endpoint, find a stored
signup, and follow the email send, without opening the source.

## Quick reference

| | |
| --- | --- |
| Endpoint | `POST https://trackd.deanware.com/api/beta-signup` |
| Handler | `netlify/functions/beta-signup.js` (Netlify adapter) |
| Core logic | `netlify/lib/beta-signup.js` (transport-free request handler) |
| Persistence + email | `netlify/lib/signup-service.js` |
| Email transport | `netlify/lib/ses-provider.js` + `netlify/lib/aws-sigv4.js` |
| Email content | `netlify/lib/confirmation-email.js` |
| Route | `netlify.toml` rewrites `/api/beta-signup` to `/.netlify/functions/beta-signup` (`status = 200`) |
| Email service | AWS SES v2 (REST-JSON API, SigV4-signed in-repo, no AWS SDK) |
| The list | AWS SES contact list named by `SES_CONTACT_LIST` (for example `trackd-beta`) |
| Operational store | Netlify Blobs store `beta-signups` (rate-limit slots + hashed signup markers) |
| Tests | `npm test` (48 tests) |

## 1. Endpoint

```
POST /api/beta-signup
```

- Public URL: `https://trackd.deanware.com/api/beta-signup`
- Method: `POST` only. Any other method returns `405` with an `Allow: POST`
  header.
- Route registration: `netlify.toml` rewrites the public path to the Netlify
  Function. `status = 200` makes this a rewrite, so the URL the browser sees
  stays `/api/beta-signup`.
- Same-origin only: no CORS headers are emitted. The form is served from the same
  site, so no preflight is needed. A cross-origin caller receives no
  `Access-Control-Allow-Origin` header and the browser blocks the response.

## 2. Request and response contract

### Request

`Content-Type: application/json` is required. The handler accepts
`application/json` and any `application/<subtype>+json` value; anything else
returns `400`.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `email` | string | yes | The address to sign up. Trimmed and lowercased before storage. |
| `honeypot` | string | yes | Spam trap. Must be an empty string. A non-empty value is treated as a bot. |
| `source` | string | no | Free-form attribution label. Trimmed to 120 characters. Absent or empty becomes `unknown`. |
| `beta_consent` | boolean | yes | Must be exactly `true`. Missing, `false`, `"true"`, `1` and `null` all return the generic `400` (same body as the honeypot). Recorded as `consent.beta` + a server-clock `consent.betaAt`. |
| `marketing_consent` | boolean | no | Promotional opt-in. `true` only on an explicit boolean `true`; anything else means no marketing consent. Recorded as `consent.marketing` + `consent.marketingAt` (server clock) when true, `null` otherwise. Only a `true` address reaches the promotional audience. |

The body is capped at 2048 bytes. An oversized body is rejected with `400`
before any storage happens.

Example request:

```bash
curl -sS -i -X POST https://trackd.deanware.com/api/beta-signup \
  -H 'Content-Type: application/json' \
  --data '{"email":"you@example.com","honeypot":"","source":"curl-test"}'
```

### Response

All responses are JSON with `Content-Type: application/json; charset=utf-8`,
`Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.

| Status | Body | When |
| --- | --- | --- |
| `200` | `{ "status": "ok" }` | Address stored (or already stored) and confirmation sent (or already sent within the cooldown). |
| `400` | `{ "status": "error", "message": "Please enter a valid email address." }` | Missing, malformed, or structurally invalid email. |
| `400` | `{ "status": "error", "message": "Signup could not be processed." }` | Wrong content type, unparseable or non-object JSON, oversized body, a filled honeypot, or a `beta_consent` that is not exactly `true`. |
| `400` | `{ "status": "error", "message": "Too many signup attempts. Please try again in a few minutes." }` | Per-IP rate limit exceeded. |
| `405` | `{ "status": "error", "message": "Method not allowed." }` | Method other than `POST` (adds `Allow: POST`). |
| `500` | `{ "status": "error", "message": "We couldn't save your email just now. Please try again in a minute." }` | Email provider unconfigured, storage write failure, or send failure. |

Error bodies never contain stack traces, provider names, error codes, or the raw
address. The messages above are the complete set a client can receive.

### Field semantics

- `honeypot`: checked first, before the email. A non-empty value returns `400`
  with the generic "could not be processed" message and writes nothing to
  storage. The response does not reveal that the honeypot was the reason.
- `beta_consent`: required. Only the exact boolean `true` passes; every other
  value returns the same generic "could not be processed" `400` as the honeypot
  (deliberately indistinguishable), and nothing is stored. The captured value is
  the lawful-basis evidence the privacy policy relies on (GDPR Art. 6(1)(a)),
  and the stored `consent.betaAt` is how it is demonstrated (Art. 7(1)).
- `marketing_consent`: optional, separate purpose. It is never inferred from
  another field. An unticked box records `consent.marketing: false` (a recorded
  refusal) rather than being silently dropped.
- `source`: stored in the operational Blobs marker record only. It is never sent
  to the email provider, so it does not appear in the SES contact list.
- `email`: a repeat signup is accepted and handled idempotently (see section 7).

### Request processing order

This order matters when you are diagnosing a response:

1. Method check (`405` on non-POST).
2. Content-type check (`400`).
3. Body size check, max 2048 bytes (`400`).
4. JSON parse and object check (`400`).
5. Honeypot check (`400`, nothing stored).
6. `beta_consent` check — must be exactly `true` (`400`, nothing stored).
7. Email normalization (`400`).
8. Rate-limit slot claim (`400`). Runs after email validation, so invalid
   submissions do not consume a slot.
9. Provider readiness check (`500` if SES is unconfigured). A slot has already
   been claimed at this point.
10. Existing-marker read and resend-cooldown check (early `200` if a confirmation
    was sent recently).
11. `storeSignup`: the address is added to the SES transactional contact list
    (and the promotional list only when `marketing_consent` is true, or the Blobs
    fallback when no contact list is configured), and the `consent` block is
    recorded.
12. `sendConfirmation`: the confirmation email is sent through SES.
13. `markConfirmationSent`: the send time and delivery id are recorded.
14. `200 { "status": "ok" }`.

## 3. Email service

**AWS SES**, using the SES v2 REST-JSON API, signed with SigV4 by
`netlify/lib/aws-sigv4.js`. The AWS SDK is deliberately not used, which keeps the
function bundle small for a service that makes two API calls.

Why SES: the endpoint needs exactly two capabilities, send one transactional
message and hold an address list. SES provides both, and the AWS account was
already available, so there was no new vendor, no new data-processing agreement,
and no new bill. The transport sits behind a three-method interface in
`netlify/lib/ses-provider.js` (`ready`, `addContact`, `sendConfirmation`), so
swapping providers later means writing one file and changing one `require` in the
Netlify adapter.

Two SES operations are used:

| Operation | SES v2 call |
| --- | --- |
| Add the address to the transactional list | `POST /v2/email/contact-lists/{SES_CONTACT_LIST}/contacts` (address in the body) |
| Add a marketing-consented address to the promotional list | `POST /v2/email/contact-lists/{SES_PROMO_CONTACT_LIST}/contacts` — only when `marketing_consent` is true |
| Send the confirmation | `POST /v2/email/outbound-emails` |

The address is written to the contact list before the email is sent. If the send
fails, the request returns `500` and the address stays in the list. A retry finds
it already present (no duplicate row) and re-sends the confirmation.

Required IAM permissions: `ses:SendEmail` on the sending identity, and
`ses:CreateContact` on the contact list when `SES_CONTACT_LIST` is set (scope it
to the promotional list too when `SES_PROMO_CONTACT_LIST` is set). Scope both to
the specific resource ARN. Do not use root credentials.

## 4. Where the signup list lives and how to inspect it

There are two stores, with different roles.

| Store | Role | Contents |
| --- | --- | --- |
| AWS SES contact list named by `SES_CONTACT_LIST` (for example `trackd-beta`) | Authoritative transactional list | One contact per address. This is the list you export or read. |
| AWS SES contact list named by `SES_PROMO_CONTACT_LIST` (optional) | Promotional audience | Only addresses whose request carried `marketing_consent: true`. Absent when unset. |
| Netlify Blobs store `beta-signups` (`SIGNUP_BLOBS_STORE`) | Operational state + consent evidence | Rate-limit slot keys (`rl:<ipHash>:<bucket>:<slot>`) and one signup marker per address (`signup:<HMAC>`), including the `consent` block. |

When `SES_CONTACT_LIST` is set, the Blobs marker holds no raw address. The SES
contact list is the only place the raw address is persisted. If
`SES_CONTACT_LIST` is not set, the endpoint still sends the email and stores the
raw address in the Blobs marker as a fallback so the signup stays durable, but
there is no SES console or CSV list. Set the contact list in production.

The Blobs signup marker records `source`, `createdAt`, `updatedAt`, `audience`,
`contactId`, `confirmationSentAt`, the `consent` block (`beta`, `betaAt`,
`marketing`, `marketingAt`), and (only in the fallback case) `email`. The
`consent` block is the demonstrable-consent record (GDPR Art. 7(1)); both
timestamps are taken from the server clock.

### Inspect the list

SES console: **Configuration → Contact lists → [list]**.

AWS CLI:

```bash
aws sesv2 list-contacts --contact-list-name trackd-beta
```

CSV export (pages through the full list, columns `email,created_at,unsubscribe_all`):

```bash
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1 \
  SES_CONTACT_LIST=trackd-beta node scripts/export-beta-signups.mjs > beta-signups.csv
```

The export script needs `ses:ListContacts` in addition to the endpoint's
permissions.

### Inspect the operational store

The Netlify Blobs store `beta-signups` holds rate-limit slots and HMAC-keyed
signup markers. Keys and values are not human-readable addresses; that is by
design so logs and the store carry no PII. To confirm duplicate suppression is
working, look for a `signup:<hash>` key whose record has a non-null
`confirmationSentAt`.

### Remove an address (manual, once the endpoint is the live path)

When the endpoint is deployed, the raw address lives in the **SES contact list**
(`SES_CONTACT_LIST`), not in Netlify Forms, so deletion targets SES:

1. **SES console** — Configuration → Contact lists → [list] → select the contact →
   Delete. This removes the address from the authoritative list.
2. **AWS CLI** —
   `aws sesv2 delete-contact --contact-list-name trackd-beta --email-address someone@example.com`
3. **Operational marker** — the Blobs `signup:<HMAC>` record holds no raw address;
   it expires with the beta and needs no per-address deletion, but you can remove
   it with the export script's store handle if you want the throttle/cooldown
   state cleared too.
4. Keep the bare address on the **do-not-contact/suppression list** so a later
   import cannot re-add it.

The full erasure procedure (request handling, deadlines, Netlify Forms legacy
path, retention sweep) is in `docs/signup-list-data-deletion-procedure.md`.
That document still describes the **Netlify Forms** store, which is correct while
the endpoint is undeployed; once the endpoint goes live, its parts 3/3a/5 must be
re-pointed at the SES contact list as described above.

## 5. Configuration

Set these in the Netlify UI under **Site configuration → Environment variables**,
then redeploy so the function picks them up. Names only; never commit values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `AWS_ACCESS_KEY_ID` | yes | IAM access key id used to sign SES requests. |
| `AWS_SECRET_ACCESS_KEY` | yes | IAM secret access key used to sign SES requests. |
| `AWS_REGION` | yes (in practice) | SES region, for example `us-east-1`. `AWS_DEFAULT_REGION` is accepted as a fallback; the code default is `us-east-1`. |
| `SIGNUP_FROM_EMAIL` | yes | SES-verified sender identity, for example `Trackd <hello@deanware.com>`. Without it the endpoint returns a generic `500` and sends nothing. |
| `SES_CONTACT_LIST` | yes for the list | Name of the SES contact list that holds the beta (transactional) list. Every beta signup joins it. Optional at the code level; without it there is no SES list and the address falls back to Blobs. |
| `SES_PROMO_CONTACT_LIST` | no | Name of a second SES contact list acting as the promotional audience. Only addresses whose request carried `marketing_consent: true` are added. Unset means no promotional audience, which is the safe default. |
| `SIGNUP_REPLY_TO` | no | Reply-to address. Defaults to `trackd@deanware.com`. |
| `SIGNUP_HASH_SALT` | recommended | Secret used to HMAC addresses and IPs before they become store keys or log values. Set it once; changing it changes the keys and resets duplicate suppression. |
| `AWS_SESSION_TOKEN` | no | Only for temporary (STS) credentials. |
| `AWS_ENDPOINT_URL_SES` | no | Full endpoint base URL override. Falls back to `AWS_ENDPOINT_URL`, then `email.<region>.amazonaws.com`. Used by tests and stubs. |
| `SIGNUP_BLOBS_STORE` | no | Overrides the Blobs store name. Defaults to `beta-signups`. |
| `RATE_LIMIT_MAX` | no | Max requests per IP per window. Defaults to `5`. |
| `RATE_LIMIT_WINDOW_SECONDS` | no | Rate-limit window length in seconds. Defaults to `600` (10 minutes). |
| `SIGNUP_RESEND_COOLDOWN_SECONDS` | no | Suppression window for repeat sends to the same address. Defaults to `86400` (24 hours). |
| `EXTENSION_DOWNLOAD_URL` | no | Chrome Web Store listing URL used in the confirmation email. See section 6 for the default. |
| `SIGNUP_EMAIL_SUBJECT` | no | Confirmation email subject line. See section 6 for the default. |
| `SIGNUP_INSTALL_STEPS` | no | Newline-separated steps that replace the default five. The literal `{url}` interpolates `EXTENSION_DOWNLOAD_URL`. |

`AWS_REGION` is required in practice. The SES provider defaults the region to
`us-east-1` when neither `AWS_REGION` nor `AWS_DEFAULT_REGION` is set, but the
signer then targets that region's endpoint, so set the variable explicitly to
match where the sending identity is verified.

Without `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `SIGNUP_FROM_EMAIL`, the
provider reports `ready = false`, the endpoint returns a generic `500`, and it
does not store the address. This is deliberate: a `200` means "stored and email
sent".

### One-time SES setup

1. Verify a sending identity for `deanware.com` in SES (Easy DKIM, add the CNAME
   records to DNS). Until the domain is verified, you can only send from a single
   verified address.
2. Request production access to leave the SES sandbox. A sandboxed account can
   only send to verified addresses, so confirmations to real visitors will be
   rejected until production access is granted.
3. Create the contact list (for example `trackd-beta`). This is the
   transactional list. Optionally create a promotional list (for example
   `trackd-promo`) and set `SES_PROMO_CONTACT_LIST` to it.
4. Create an IAM user with programmatic credentials and only the permissions
   in section 3.
5. Set the environment variables above and redeploy.

## 6. Confirmation email contents

The email is rendered by `netlify/lib/confirmation-email.js` and sent
synchronously in the request path. From and reply-to come from
`SIGNUP_FROM_EMAIL` and `SIGNUP_REPLY_TO`.

Defaults (verified by rendering `buildConfirmation({})`):

- Subject: `You're in: here's your Trackd install link`
- `List-Unsubscribe` header: `<mailto:trackd@deanware.com?subject=unsubscribe>`
- Chrome extension download URL:
  `https://chromewebstore.google.com/detail/lenaajfmejfgdjjdepbcnpakmakcbkgc`

Install steps (numbered 1 to 5 at render time):

1. Open Chrome and make sure you are signed in with the same Google account
   whose email you signed up with.
2. Open the Trackd listing in the Chrome Web Store:
   `https://chromewebstore.google.com/detail/lenaajfmejfgdjjdepbcnpakmakcbkgc`
3. Click "Add to Chrome", then "Add extension".
4. Pin Trackd: click the puzzle-piece icon in the toolbar and pin Trackd, then
   click the Trackd icon.
5. Click "Connect Gmail". Chrome will ask for read-only access to your Gmail.
   Approve it, and the first scan runs on its own.

The message body also states that the free tier tracks up to 10 subscriptions,
invites a reply if the store link or the Gmail step fails, and includes the
unsubscribe note. Both a text and an HTML version are sent; the HTML version
renders the download URL as a link.

Overrides, no code edit required:

- `EXTENSION_DOWNLOAD_URL` replaces the store link everywhere it appears.
- `SIGNUP_EMAIL_SUBJECT` replaces the subject.
- `SIGNUP_INSTALL_STEPS` replaces all five default steps. It is split on
  newlines, leading `N.` or `N)` numbering is stripped, and `{url}` is replaced
  with `EXTENSION_DOWNLOAD_URL`.

If a step in `SIGNUP_INSTALL_STEPS` does not contain `{url}`, the download link
does not appear in that step. Keep at least one step with `{url}`.

## 7. Rate limiting and duplicate handling

### Rate limiting

Fixed-window, per IP, using Netlify Blobs:

- Window: `floor(now / RATE_LIMIT_WINDOW_SECONDS)`. The window resets on a
  boundary, not on a rolling basis.
- Limit: `RATE_LIMIT_MAX` requests per IP per window, default 5 per 10 minutes.
- Mechanism: each request atomically creates one of N slot keys
  (`rl:<ipHash>:<bucket>:<slot>`) with `onlyIfNew`. There is no
  read-modify-write race, so concurrent requests cannot all pass on the same
  slot.
- Client IP: taken from the Netlify edge header `x-nf-client-connection-ip`,
  which Netlify sets and overwrites. `x-forwarded-for` is a local and
  development fallback only.
- Over the limit: `400` with the "too many signup attempts" message. The contract
  defines only `200` and `400`, so a `429` is not used.
- Failure mode: if the Blobs store is unavailable, the throttle fails open. The
  signup still succeeds and the outage is logged. Availability is preferred over
  a best-effort throttle during a storage outage.

The slot is claimed after the consent and email validation and before the
provider-ready check, so a submission that passes validation but hits an
unconfigured provider still consumes a slot.

### Duplicate handling (idempotent)

A repeat signup never double-stores. Two independent layers guarantee this:

1. **The list is keyed by address.** A repeat `addContact` returns SES's
   `AlreadyExistsException`, which the provider treats as success with
   `duplicate: true`. No second row is created.
2. **The marker is a single key per address** (`signup:<HMAC>`), so a write
   overwrites the same record instead of adding another.

The consent block is part of the overwritten marker. A repeat keeps the earliest
recorded `betaAt`/`marketingAt`, so the original consent act is preserved rather
than re-dated; a later signup that turns `marketing_consent` on sets
`marketingAt` for the first time, and one that turns it off records
`marketing: false, marketingAt: null`.

On the resend-cooldown path (a repeat within `SIGNUP_RESEND_COOLDOWN_SECONDS`)
the handler returns the idempotent `200` without re-sending, but it still writes a
changed consent value to the marker, so a repeat signup that flips the marketing
box is recorded rather than silently ignored.

On top of that, the marker records `confirmationSentAt`. If a confirmation was
already sent within `SIGNUP_RESEND_COOLDOWN_SECONDS` (default 24 hours), the
handler returns `200 { "status": "ok" }` immediately without storing or sending
anything again.

After the cooldown expires, a repeat signup sends the confirmation again (allowed
by the contract) and still does not duplicate the contact.

If the send fails, the address remains in the list and the marker has no
`confirmationSentAt`. A retry then finds the contact already present and re-sends
the confirmation, producing one stored row and one successful send.

## 8. Verifying the feature

Local, with no network, AWS, or Netlify:

```bash
npm install
npm test
```

The suite starts real local HTTP servers standing in for SES, so the handler, the
SES provider, the SigV4 signer, and the CSV export are all exercised over actual
sockets. Expected: 48 tests, 48 pass.

Against a deployed site:

```bash
# Valid address with the required beta consent: expect 200 {"status":"ok"} and an
# email within about a minute.
curl -sS -i -X POST https://trackd.deanware.com/api/beta-signup \
  -H 'Content-Type: application/json' \
  --data '{"email":"you@example.com","honeypot":"","source":"curl-test","beta_consent":true,"marketing_consent":false}'

# Missing beta_consent: expect 400 and nothing stored.
curl -sS -i -X POST https://trackd.deanware.com/api/beta-signup \
  -H 'Content-Type: application/json' \
  --data '{"email":"you@example.com","honeypot":"","source":"curl-test"}'

# Filled honeypot: expect 400 and nothing stored.
curl -sS -i -X POST https://trackd.deanware.com/api/beta-signup \
  -H 'Content-Type: application/json' \
  --data '{"email":"bot@example.com","honeypot":"x","source":"curl-test","beta_consent":true}'

# Invalid address: expect 400 with a clear message.
curl -sS -i -X POST https://trackd.deanware.com/api/beta-signup \
  -H 'Content-Type: application/json' \
  --data '{"email":"not-an-email","honeypot":"","source":"curl-test","beta_consent":true}'
```

Then confirm the address appears in the SES transactional contact list (and,
only when `marketing_consent: true`, in the promotional list) and that the
confirmation email arrived with the Chrome Web Store link and the five numbered
steps.

### Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `500` "couldn't save your email" on every request | Provider not ready: missing `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `SIGNUP_FROM_EMAIL`, or the variables were added without a redeploy. |
| `500` only for real addresses | SES is still in the sandbox, so it can only send to verified addresses. Request production access. |
| `500` with a region or endpoint error in the logs | `AWS_REGION` does not match the region of the verified sending identity. |
| `400` "could not be processed" from a working client | Wrong `Content-Type`, body over 2048 bytes, the form's honeypot field is being filled, or `beta_consent` is not exactly boolean `true` (a missing/false/stringified tick fails here). |
| `400` "too many signup attempts" during manual testing | You hit `RATE_LIMIT_MAX` within `RATE_LIMIT_WINDOW_SECONDS` from one IP. Wait for the window to reset or raise the limit. |
| Confirmation not re-sent to the same address | A confirmation was sent within `SIGNUP_RESEND_COOLDOWN_SECONDS` (default 24 hours). This is the idempotent path. |
| Address stored but no email | The send failed; the request returned `500` and the address stayed in the list. Retry the same signup to re-send without duplicating the contact. |

## Related documents

- `docs/beta-signup-email-capture.md`: design rationale, SigV4 verification
  detail, and the legacy Netlify Forms path.
- `docs/signup-list-data-deletion-procedure.md`: how to remove a signup.
- `docs/beta-email-consent-runbook.md`: consent and compliance context.
