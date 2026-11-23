# Beta signup: endpoint, storage and confirmation email

How the email capture on the Trackd landing page (`trackd.deanware.com`) works,
where the list lives, and what has to be switched on.

> **Operator runbook:** `docs/beta-signup-operations.md` is the day-to-day guide
> (request/response contract, config keys, list inspection, confirmation email
> contents, rate-limit and duplicate behavior). This document covers the design
> and rationale behind those choices.

**At a glance**

| | |
| --- | --- |
| Endpoint | `POST https://trackd.deanware.com/api/beta-signup` |
| Email service | **AWS SES** (SES v2 REST API, SigV4-signed in-repo, no AWS SDK) |
| Where the list lives | **AWS SES contact list** named by `SES_CONTACT_LIST` (e.g. `trackd-beta`); Netlify Blobs store `beta-signups` is the operational/fallback store |
| Code | `netlify/functions/beta-signup.js` (adapter) + `netlify/lib/*` (core, signup service, SES transport, SigV4 signer) |
| Tests | `npm test` — 48 tests, including a local SES stub with every on-the-wire signature re-checked against the official AWS signer |

## Endpoint (frozen contract v2)

```
POST /api/beta-signup
Content-Type: application/json

request   { "email": string, "honeypot": string, "source": string,
            "beta_consent": boolean, "marketing_consent": boolean }
success   200 { "status": "ok" }
error     400 { "status": "error", "message": string }   // validation, spam, throttle
error     500 { "status": "error", "message": string }   // provider/storage outage
```

| Field | Type | Required | Server behaviour |
| --- | --- | --- | --- |
| `email` | string | yes | Trimmed and lowercased; structural garbage is a `400`. |
| `honeypot` | string | yes | Must be empty. A non-empty value is the bot signal — see the spam section. |
| `source` | string | no | Attribution label; control characters stripped; default `unknown`. |
| `beta_consent` | boolean | **yes** | Must be exactly `true`. Every other value (missing, `false`, `"true"`, `1`, `null`) is rejected with the same `400` the honeypot uses, so the response never reveals which check failed. Stored as `consent.beta` with a server-clock `consent.betaAt`. |
| `marketing_consent` | boolean | no | Marketing opt-in. `true` only on an explicit boolean `true`; absent, `false`, `"true"` and `1` all mean **no marketing consent**. Stored as `consent.marketing` with `consent.marketingAt` (server clock) when true, `null` otherwise. |

- **Public URL:** `https://trackd.deanware.com/api/beta-signup`
- **Implementation:** `netlify/functions/beta-signup.js`
- **Route:** `netlify.toml` rewrites `/api/beta-signup` to
  `/.netlify/functions/beta-signup` with `status = 200` (a rewrite; the browser
  URL stays `/api/beta-signup`).
- **Same-origin only.** No CORS headers are emitted. The form is served from the
  same site, so no preflight is needed. A cross-origin caller gets no
  `Access-Control-Allow-Origin` and the browser blocks the response.

The handler is split into a transport-free core (`netlify/lib/beta-signup.js`),
a reusable persistence + confirmation-email service
(`netlify/lib/signup-service.js`), a typed error module
(`netlify/lib/signup-errors.js`), and a thin Netlify adapter. Everything is
covered by `tests/beta-signup.test.js` and `tests/signup-service.test.js`; run
`npm test`.

> **Consent evidence is captured (contract v2).** The live form sends
> `beta_consent` and `marketing_consent`; the endpoint validates `beta_consent`
> (exactly `true`) and records both values with server-clock timestamps in the
> stored marker. See the *Consent* section below and `docs/signup-consent-copy.md`
> for the wording the form presents.

## Consent (contract v2)

The lawful basis for the beta signup and the install email is **consent**
(GDPR Art. 6(1)(a)); a controller must be able to *demonstrate* it
(Art. 7(1)). The endpoint therefore turns the two checkboxes the form already
renders into durable evidence:

- `beta_consent` is required and must be exactly boolean `true`. Anything else
  gets the generic `400 {"status":"error"}` — the same body as a filled
  honeypot — so the response does not disclose which check failed.
- `marketing_consent` is optional and is true only on an explicit boolean
  `true`. It is never derived from another field, and an unticked box leaves a
  recorded refusal rather than a silent omission.

The stored marker (Netlify Blobs `beta-signups`, keyed by the address HMAC)
gains a `consent` block whose two timestamps are the evidence trail:

```js
consent: {
  beta: true,           // always true here: the handler rejects false first
  betaAt: <epoch ms>,   // server clock at capture
  marketing: <boolean>, // the explicit opt-in, if any
  marketingAt: <epoch ms | null>
}
```

Both timestamps come from the server clock, never from client input. A repeat
signup keeps the earliest recorded times, so the original consent act is
preserved rather than being silently re-dated. On a repeat inside the
resend-cooldown window the confirmation is not re-sent, but a *changed* marketing
choice is still written to the marker, so a later opt-in or opt-out is never
dropped.

**Audience rule.** Every beta signup joins the transactional SES contact list
(`SES_CONTACT_LIST`). Only an address whose request carried
`marketing_consent: true` is additionally added to the promotional list
(`SES_PROMO_CONTACT_LIST`), so list membership *is* the consent gate: a
beta-only contact can never reach a promotional send. When
`SES_PROMO_CONTACT_LIST` is unset there is no promotional audience at all,
which is the safe default. The confirmation email is transactional and needs no
marketing consent.

## Flow

1. Visitor submits the hero form (`index.html`, `#signup-form`).
2. The inline script validates the address and the required consent tick, then
   POSTs JSON to `/api/beta-signup`.
3. The function validates the honeypot, the required `beta_consent: true`, and
   the address, applies the per-IP throttle, records the consent evidence, adds
   the address to the transactional SES contact list (and, only when
   `marketing_consent` is true, the promotional list), and sends the
   confirmation email through SES.
4. The page shows `Check your inbox for install instructions.` on success, or an
   inline error on failure. The form stays usable for a retry.

## Storage — where the list lives

| Concern | Where |
| --- | --- |
| **The list (authoritative, transactional)** | **AWS SES contact list** named by `SES_CONTACT_LIST`. Every beta signup joins it. SES console → **Configuration → Contact lists → [list]**. Also via `aws sesv2 list-contacts --contact-list-name trackd-beta` or `scripts/export-beta-signups.mjs`. |
| **Promotional audience (optional)** | **AWS SES contact list** named by `SES_PROMO_CONTACT_LIST`. Only contacts whose request carried `marketing_consent: true` are added. When unset, there is no promotional audience. |
| **Consent evidence** | The `consent` block in the Blobs signup marker (below): `beta`/`betaAt` and `marketing`/`marketingAt`, both timestamps from the server clock. This is the demonstrable-consent record (GDPR Art. 7(1)). |
| **Operational store** | **Netlify Blobs**, store name `beta-signups` (override with `SIGNUP_BLOBS_STORE`). Holds rate-limit slot keys and a signup marker keyed by an HMAC of the address. It does **not** hold a second copy of the address when `SES_CONTACT_LIST` is set. |
| **Fallback store** | If `SES_CONTACT_LIST` is not set, the Blobs record also stores the raw address so the signup is still durable. This is a fallback, not the intended production setup — without a contact list there is no SES UI/CSV list. |
| **Confirmation email** | AWS SES v2, `POST https://email.<region>.amazonaws.com/v2/email/outbound-emails`, sent synchronously in the request path. Transactional: it needs no marketing consent. |

The address is written to the contact list **before** the email is sent. If the
send fails the request returns 500; the address remains in the list, and a retry
finds it already present (no duplicate row) and retries the send.

### Why SES and not a list-first provider

The endpoint needs exactly two things from an email provider: send one
transactional message, and hold an address list. AWS SES does both, and the AWS
account was already available — no new vendor, no new DPA, no new bill. The
The transport is behind `netlify/lib/ses-provider.js`'s interface
(`ready`, `addContact(email, { marketing })`, `sendConfirmation`), so swapping
providers later means writing one file and changing one `require` in the Netlify
adapter. `addContact` is SES v2 `CreateContact` (`POST
/v2/email/contact-lists/{list}/contacts`, address in the body); only when
`marketing` is true is the address also created in `SES_PROMO_CONTACT_LIST`.

### Reusable module — `netlify/lib/signup-service.js`

The persistence and email work lives behind one interface so the HTTP handler,
and anything else, never talks to SES or Blobs directly:

```js
const { createSignupService } = require('./signup-service');
const svc = createSignupService({ store, provider, logger, env, now });

await svc.storeSignup(email, source, { marketing: false }); // idempotent upsert
await svc.sendConfirmation(email);         // send the install email
```

| Member | Purpose |
| --- | --- |
| `ready` | true when the provider can send (`provider.ready`) |
| `normalizeEmail(v)` / `normalizeSource(v)` | trim/lowercase; reject structural garbage |
| `hash(v)` / `emailHash(email)` / `signupKey(email)` | salted HMAC meant for keys and logs (never the raw address) |
| `getSignup(email)` | read the durable marker, or `null` |
| `storeSignup(email, source, consent)` | idempotent upsert into the audience **and** the keyed marker; `consent` is `{ marketing: boolean }`; returns `{ emailHash, duplicate, stored, audience, contactId, marketing, promotional, createdAt, confirmationSentAt }` |
| `sendConfirmation(email)` | send the confirmation; returns `{ id }` |
| `markConfirmationSent(email, meta)` | record the send time / delivery id |

Failures are typed (`netlify/lib/signup-errors.js`): `ProviderError` (audience
or send), `StoreError` (durable store read/write), `ConfigError` (bad input or
an unconfigured provider). The handler maps every one to a generic
`500 {"status":"error"}`; no code, message, or provider name reaches the client.
The module never logs or returns the raw address.

### Duplicate handling (idempotent)

- The contact list is keyed by address. A repeat signup returns SES's
  `AlreadyExistsException`, which is treated as success — not a second row.
- A signup marker keyed by the address HMAC records when the confirmation was
  sent. A repeat within `SIGNUP_RESEND_COOLDOWN_SECONDS` (default 24 h) returns
  `200 {"status":"ok"}` without sending another email or storing anything twice.
- **Atomic send claim.** The cooldown check alone is a read, so concurrent
  requests for the same address would all see "not sent yet" and all send. Before
  sending, the handler takes a per-address claim (`send:<HMAC>:<window>`) with
  Blobs' `onlyIfNew` conditional write; exactly one concurrent request wins and
  the rest return the idempotent `200` without sending. A failed send releases
  the claim so a genuine retry can still go out inside the window.
- After the cooldown, a repeat sends the confirmation again (allowed by the
  contract) but still does not duplicate the contact.

## Spam protection

- **Honeypot** field named `honeypot`. The client hides it off-screen, removes it
  from the tab order and marks it `aria-hidden`; a bot that fills it gets a fake
  success and no network request. The API also rejects a non-empty honeypot with
  `400` and stores nothing.
- **Per-IP throttle.** Fixed-window claim in Netlify Blobs: `RATE_LIMIT_MAX`
  requests (default 5) per `RATE_LIMIT_WINDOW_SECONDS` (default 600) per IP. The
  IP is taken from Netlify's edge-set `x-nf-client-connection-ip` header. Each
  request atomically creates one of N slot keys with `onlyIfNew`, so concurrent
  requests cannot all pass on the same slot. Exceeding the limit returns `400`
  (the contract only defines 200/400) with a "try again" message.
  - `X-Forwarded-For` is **not** trusted by default: Netlify does not set it, so
    a client can supply it freely and would otherwise mint a fresh bucket per
    request. Set `TRUST_FORWARDED_FOR=1` only when a trusted proxy in front of
    the function sets it. With no trustworthy header the caller shares a single
    `unknown` bucket, so spoofing gains nothing.
- If the Blobs store is unavailable the throttle fails open: the signup still
  works and the outage is logged. Availability is preferred over a best-effort
  throttle during a storage outage (a store outage is not attacker-triggerable).

## Privacy

- The raw email address is **never logged**. Log lines carry a short HMAC-SHA256
  prefix (`emailHash`) so a failed send can be correlated without PII.
- The attacker-controlled `source` field is stripped of control characters
  (CR/LF/tab/NUL and C0/C1) before it is stored or logged, so it cannot forge
  extra lines in a log stream.
- Store keys for signups and rate-limit slots are HMACs too. Set
  `SIGNUP_HASH_SALT` to a stable secret so the hashes are not guessable from the
  public source. Changing the salt changes the keys and resets duplicate
  suppression; set it once.
- The SES contact list is the only place the raw address is persisted in
  production.

## AWS SigV4 without the AWS SDK

`netlify/lib/aws-sigv4.js` signs SES requests with `node:crypto` only. It exists
because the whole AWS SDK would add roughly a megabyte to a function that makes
two API calls.

This is not "trust me" cryptography: `npm test` cross-checks every signature the
module produces against the **official AWS signer** (`@smithy/signature-v4`, a
devDependency) and asserts byte-identical `Authorization` headers across normal
requests, `+`/`@` in the path, encoded query strings, path-normalisation edge
cases and temporary-credential requests. The end-to-end test additionally
re-signs the requests that actually arrive at a local SES stub, so what is
verified is the bytes on the wire, not a self-consistent reimplementation. If the
oracle package is missing the affected tests report a skip and say so.

Path segments are encoded independently (`pathSegments`), so an address
containing `/` or `..` can never be re-interpreted as path structure.

## Required setup (AWS SES + Netlify)

1. **Verify a sending identity in SES** for `deanware.com` (Easy DKIM: SES gives
   you CNAME records to add to DNS). Until the domain is verified you can only
   send from a verified single address.
2. **Leave the SES sandbox.** A new SES account is sandboxed: it can only send
   *to* addresses you have verified, and has a low daily quota. Request
   production access (SES console → Account dashboard → Request production
   access) before opening the signup to the public, or confirmations to real
   visitors will be rejected.
3. **Create a contact list** in SES (e.g. `trackd-beta`). This is the
   transactional list. Optionally create a second list (e.g. `trackd-promo`)
   for the promotional audience — only marketing-consented addresses land there.
4. **Create an IAM user** with a programmatic access key, and the minimum
   permissions:
   - `ses:SendEmail` on the sending identity
   - `ses:CreateContact` on the contact list (only needed when
     `SES_CONTACT_LIST` is set; scope it to the promotional list too when
     `SES_PROMO_CONTACT_LIST` is set)

   Nothing else. Do not use root credentials. Prefer an IAM policy scoped by
   resource ARN over a wildcard.
5. **In Netlify:** *Site configuration → Environment variables* add:
   - `AWS_ACCESS_KEY_ID` — the IAM access key id (required)
   - `AWS_SECRET_ACCESS_KEY` — the IAM secret access key (required)
   - `AWS_REGION` — the SES region, e.g. `us-east-1` (required)
   - `SIGNUP_FROM_EMAIL` — the verified sender, e.g. `Trackd <hello@deanware.com>` (required)
   - `SES_CONTACT_LIST` — e.g. `trackd-beta` (required for the list)
   - `SES_PROMO_CONTACT_LIST` — optional; the promotional audience. Only
     addresses with `marketing_consent: true` are added. Leave unset for no
     promotional audience.
   - `SIGNUP_REPLY_TO` — optional; defaults to `trackd@deanware.com`
   - `SIGNUP_HASH_SALT` — a long random string (recommended; set once)
   - `AWS_SESSION_TOKEN` — only for temporary credentials
   - optional tuning: `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`,
     `SIGNUP_RESEND_COOLDOWN_SECONDS`, `SIGNUP_BLOBS_STORE`
   - optional email copy (no code edit needed):
     `EXTENSION_DOWNLOAD_URL` (the Chrome Web Store listing),
     `SIGNUP_EMAIL_SUBJECT` (subject line),
     `SIGNUP_INSTALL_STEPS` (newline-separated steps that replace the default
     five; the literal `{url}` interpolates `EXTENSION_DOWNLOAD_URL`)
   - `AWS_ENDPOINT_URL_SES` — only to point at a non-AWS endpoint (tests/stubs)
6. **Redeploy** so the function picks up the variables.

Without the credentials or `SIGNUP_FROM_EMAIL` the endpoint cannot send, so it
returns a generic `500` and does not store the address. That is deliberate: the
contract's success means "stored and email sent".

> **Compliance follow-up — RESOLVED (23 Nov 2026, task t_b3048688).** `privacy-policy.html`
> §4/§6/§7 and `docs/beta-email-consent-runbook.md` have been updated to name **Amazon SES (AWS)** as the
> email processor and beta-contact-list store, and to match the SES transport, env vars, AUP and DKIM
> guidance in this document. Note the corrected `privacy-policy.html` is committed locally but `main` is not
> pushed, so the **live** policy still says Resend until the deploy lands.

## Verifying

Local contract tests — no network, no AWS, no Netlify:

```bash
npm install   # once, to get the @smithy oracle used by the signature tests
npm test      # 48 tests
```

The suite starts real local HTTP servers that stand in for SES, so the handler,
the SES provider, the SigV4 signer and the CSV export are all exercised over
actual sockets.

Against the deployed site:

```bash
# Valid address with the required beta consent: expect 200 {"status":"ok"} and
# an email within ~60s.
curl -sS -i -X POST https://trackd.deanware.com/api/beta-signup \
  -H 'Content-Type: application/json' \
  --data '{"email":"you@example.com","honeypot":"","source":"curl-test","beta_consent":true,"marketing_consent":false}'

# Missing beta_consent: expect 400 {"status":"error"} and nothing stored.
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

Then confirm the address appears in the SES contact list (and, only when
`marketing_consent: true`, in the promotional list), and that the confirmation
email arrived with the Chrome Web Store link and the numbered install steps.

## Exporting the list

```bash
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1 \
  SES_CONTACT_LIST=trackd-beta node scripts/export-beta-signups.mjs > beta-signups.csv
```

The script pages through `GET /v2/email/contact-lists/{list}/contacts` using the
same in-repo SigV4 signer, and writes `email,created_at,unsubscribe_all`. It
needs `ses:ListContacts` in addition to the endpoint's permissions.

## Legacy Netlify Forms path

`netlify/functions/submission-created.js` still exists for the old Netlify Forms
submission path (`form-name=trackd-test-group`). The current landing page no
longer posts to Netlify Forms, so this function is dormant unless a form
submission is created another way. It sends the same confirmation copy from
`netlify/lib/confirmation-email.js` through the same SES provider. It does not
add contacts to the list — the Netlify Forms store already holds the address.

## Unsubscribe / deletion

The confirmation email tells the recipient to reply with "unsubscribe" and
includes a `List-Unsubscribe` mailto header. To delete an address, remove the
contact from the SES contact list:

```bash
aws sesv2 delete-contact --contact-list-name trackd-beta --email-address user@example.com
```

and delete the signup marker from the `beta-signups` Blobs store if present. For
the marketing list, remove the address from any future send. The full procedure
is in `docs/signup-list-data-deletion-procedure.md`.
