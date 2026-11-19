# Beta signup: endpoint, storage and confirmation email

How the email capture on the Trackd landing page (`trackd.deanware.com`) works,
where the list lives, and what has to be switched on.

## Endpoint (frozen contract)

```
POST /api/beta-signup
Content-Type: application/json

request   { "email": string, "honeypot": string, "source": string,
            "beta_consent": boolean, "marketing_consent": boolean }
success   200 { "status": "ok" }
error     400 { "status": "error", "message": string }   // validation, spam, throttle
error     500 { "status": "error", "message": string }   // provider/storage outage
```

The two consent booleans are the consent evidence the privacy policy relies on
(§9): `beta_consent` is required client-side and `marketing_consent` is an optional
separate opt-in. Both are sent as booleans (`true`/`false`), never `"on"`/strings,
so the server can tell an unticked marketing box apart from a missing one. The
legacy Netlify Forms fallback still posts them as `beta_consent=on` /
`marketing_consent=on`.

- **Public URL:** `https://trackd.deanware.com/api/beta-signup`
- **Implementation:** `netlify/functions/beta-signup.js`
- **Route:** `netlify.toml` rewrites `/api/beta-signup` to
  `/.netlify/functions/beta-signup` with `status = 200` (a rewrite; the browser
  URL stays `/api/beta-signup`).
- **Same-origin only.** No CORS headers are emitted. The form is served from the
  same site, so no preflight is needed. A cross-origin caller gets no
  `Access-Control-Allow-Origin` and the browser blocks the response.

The handler is split into a transport-free core
(`netlify/lib/beta-signup.js`) and a thin Netlify adapter. The core is covered by
`tests/beta-signup.test.js`; run `npm test`.

## Flow

1. Visitor submits the hero form (`index.html`, `#signup-form`).
2. The inline script validates the address and the required consent tick, then
   POSTs JSON to `/api/beta-signup`.
3. The function validates the address, checks the honeypot, applies the per-IP
   throttle, adds the address to the Resend Audience (the list), and sends the
   confirmation email through Resend.
4. The page shows `Check your inbox for install instructions.` on success, or an
   inline error on failure. The form stays usable for a retry.

## Storage — where the list lives

| Concern | Where |
| --- | --- |
| **The list (authoritative)** | **Resend Audience** identified by `RESEND_AUDIENCE_ID`. Resend dashboard → **Audiences → [audience] → Contacts**. Exportable via the Resend API or `scripts/export-beta-signups.mjs`. |
| **Operational store** | **Netlify Blobs**, store name `beta-signups` (override with `SIGNUP_BLOBS_STORE`). Holds rate-limit slot keys and a signup marker keyed by an HMAC of the address. It does **not** hold a second copy of the address when an audience is configured. |
| **Fallback store** | If `RESEND_AUDIENCE_ID` is not set, the Blobs record also stores the raw address so the signup is still durable. This is a fallback, not the intended production setup — without an audience there is no Resend UI/CSV list. |
| **Confirmation email** | Resend HTTP API, `POST https://api.resend.com/emails`, sent synchronously in the request path. |

The address is stored in the audience **before** the email is sent. If the send
fails the request returns 500; the address remains in the audience, and a retry
finds it already present (no duplicate row) and retries the send.

### Duplicate handling (idempotent)

- The audience is keyed by address. A repeat signup is "already present", not a
  second row.
- A signup marker keyed by the address HMAC records when the confirmation was
  sent. A repeat within `SIGNUP_RESEND_COOLDOWN_SECONDS` (default 24 h) returns
  `200 {"status":"ok"}` without sending another email or storing anything twice.
- After the cooldown, a repeat sends the confirmation again (allowed by the
  contract) but still does not duplicate the audience row.
- Resend duplicate responses (`409`, or a message containing "already exists")
  are treated as success.

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
- If the Blobs store is unavailable the throttle fails open: the signup still
  works and the outage is logged. Availability is preferred over a best-effort
  throttle during a storage outage.

## Privacy

- The raw email address is **never logged**. Log lines carry a short HMAC-SHA256
  prefix (`emailHash`) so a failed send can be correlated without PII.
- Store keys for signups and rate-limit slots are HMACs too. Set
  `SIGNUP_HASH_SALT` to a stable secret so the hashes are not guessable from the
  public source. Changing the salt changes the keys and resets duplicate
  suppression; set it once.
- The audience is the only place the raw address is persisted in production.

## Required setup (Netlify + Resend)

1. Create a Resend account and verify `deanware.com` as a sending domain (adds
   SPF/DKIM DNS records).
2. Create an API key (`re_…`).
3. Create an **Audience** in Resend (e.g. "Trackd beta"). Copy its id.
4. In Netlify: **Site configuration → Environment variables** add:
   - `RESEND_API_KEY` = the key (required)
   - `RESEND_AUDIENCE_ID` = the audience id (required for the list)
   - `SIGNUP_FROM_EMAIL` = `Trackd <hello@deanware.com>` (a verified sender;
     defaults to the sandbox `onboarding@resend.dev`, which only delivers to the
     account owner's own address)
   - `SIGNUP_REPLY_TO` = `trackd@deanware.com` (optional; this is the default)
   - `SIGNUP_HASH_SALT` = a long random string (recommended; set once)
   - optional tuning: `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`,
     `SIGNUP_RESEND_COOLDOWN_SECONDS`, `SIGNUP_BLOBS_STORE`
5. Redeploy so the function and the new route pick up the variables.

Without `RESEND_API_KEY` the endpoint cannot send, so it returns a generic `500`
and does not store the address. That is deliberate: the contract's success means
"stored and email sent".

## Verifying

Local contract tests (no network, no Netlify):

```bash
npm test
```

Against the deployed site:

```bash
# Valid address: expect 200 {"status":"ok"} and an email within ~60s.
curl -sS -i -X POST https://trackd.deanware.com/api/beta-signup \
  -H 'Content-Type: application/json' \
  --data '{"email":"you@example.com","honeypot":"","source":"curl-test"}'

# Filled honeypot: expect 400 and nothing stored.
curl -sS -i -X POST https://trackd.deanware.com/api/beta-signup \
  -H 'Content-Type: application/json' \
  --data '{"email":"bot@example.com","honeypot":"x","source":"curl-test"}'

# Invalid address: expect 400 with a clear message.
curl -sS -i -X POST https://trackd.deanware.com/api/beta-signup \
  -H 'Content-Type: application/json' \
  --data '{"email":"not-an-email","honeypot":"","source":"curl-test"}'
```

Then confirm the address appears in Resend → Audiences → the configured audience
→ Contacts, and that the confirmation email arrived with the Chrome Web Store
link and the numbered install steps.

## Exporting the list

```bash
RESEND_API_KEY=re_... RESEND_AUDIENCE_ID=... node scripts/export-beta-signups.mjs > beta-signups.csv
```

The script pages through `GET /audiences/{id}/contacts` and writes
`email,created_at,unsubscribed`.

## Legacy Netlify Forms path

`netlify/functions/submission-created.js` still exists for the old Netlify Forms
submission path (`form-name=trackd-test-group`). The current landing page no
longer posts to Netlify Forms, so this function is dormant unless a form
submission is created another way. It sends the same confirmation copy from
`netlify/lib/confirmation-email.js`.

## Unsubscribe / deletion

The confirmation email tells the recipient to reply with "unsubscribe" and
includes a `List-Unsubscribe` mailto header. To delete an address, remove the
contact from the Resend Audience (dashboard or API) and delete the signup marker
from the `beta-signups` Blobs store if present. For the marketing list, remove the
address from any future send.
