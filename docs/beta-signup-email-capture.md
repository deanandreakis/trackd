# Beta signup email capture

How the email capture on the Trackd landing page (`trackd.deanware.com`) works,
where the list lives, and what still needs to be switched on.

## Frontend component — `BetaSignupForm` (page/route: `/`, hero)

The capture form is a self-contained component on the landing page **`/`**
(`index.html`): markup in the hero `<section>`, styles in `<style>` (`.signup-form*`),
and the behaviour in the inline `<script>` at the bottom of the file. There is no
build step on this site, so the component ships as HTML + CSS + vanilla JS rather
than as a framework component; it has no dependencies.

**Wired endpoint (frozen contract, owned by the backend card):**

```
POST /api/beta-signup
  request   { email: string, honeypot: string, source: string,
              beta_consent: boolean, marketing_consent: boolean }   source = "homepage-hero"
  200       { status: "ok" }
  400       { status: "error", message: string }
```

**States:** idle → client validation → loading (button disabled, label `Sending…`,
`aria-busy="true"`) → success (form replaced by `Check your inbox for install
instructions.`) or error (form stays, inline `#signup-error` shows the server's
`message` or a generic line, submit re-enabled so the user can retry).

**Validation:** a single client-side email format check runs before any network
call; an unticked `beta_consent` also blocks submit. Both failures are inline and
never hit the network.

**Consent transport (contract v2):** the JSON body to `/api/beta-signup` carries the
consent evidence as well — `beta_consent` (from `#beta-consent`) and
`marketing_consent` (from `#marketing-consent`), both read with `.checked === true`
and sent as **booleans**, not `"on"`/strings. Consent is therefore not only a
client-side gate: the server can record the lawful basis for the signup and the
install email (§9 of the policy), and an unticked marketing opt-in leaves an
explicit `false` rather than no trace. The legacy Netlify Forms fallback is
unchanged: it serialises the whole `FormData`, so it still posts
`beta_consent=on` (and `marketing_consent=on` only when ticked).

**Spam:** the honeypot is a field literally named `honeypot`, positioned off-screen
(`.signup-form__hp`), `aria-hidden`, `tabindex="-1"`, never pre-filled. A non-empty
value short-circuits to a fake success with **no network request** (tarpit).

**Accessibility:** the label is tied to the input (`label[for="signup-email"]`,
visually hidden), the success message is a `role="status" aria-live="polite"` live
region, the inline error is `role="alert"` with `aria-invalid` on the input, and the
form is submittable with Enter from the email field.

**Migration safety net (remove once the API is deployed):** while the
`/api/beta-signup` route answers **404** (not deployed yet), the submit handler falls
back to the legacy Netlify Forms POST to `/` so live signups are still stored; it
logs `beta-signup: /api/beta-signup is not deployed; stored via the Netlify Forms
fallback.` and fires the Umami event `beta-signup-fallback`. Any other failure
(400/5xx/network) shows the inline error. When the API is live, delete
`submitToLegacyForm()` and the `data-netlify` / `netlify-honeypot` / `name` /
hidden `form-name` attributes from the `<form>`.

## Flow

1. Visitor enters an email in the above-the-fold form (`index.html`, hero section).
2. The form POSTs JSON to `/api/beta-signup` (see the component section above). If
   that route is not deployed yet (404) it falls back to the legacy Netlify Forms
   POST (`name="trackd-test-group"`, `fetch("/", …)`, urlencoded) — the only path
   that is still live until the API ships.
3. Netlify stores the submission and fires the event function
   `submission-created` (`netlify/functions/submission-created.js`).
4. That function sends the beta confirmation email (install instructions) to the
   submitted address via **Resend**.
5. The page shows `Check your inbox for install instructions.` on success, or an
   inline error on failure.

## Endpoint / service

| Concern | Where |
| --- | --- |
| Submission endpoint | `POST /api/beta-signup` (JSON) — primary. Legacy fallback while that route 404s: `POST https://trackd.deanware.com/` with `form-name=trackd-test-group` (Netlify Forms). |
| Storage (the list) | Netlify UI → **Forms → `trackd-test-group`** → Submissions. Exportable as CSV. |
| Confirmation email | Netlify event function `netlify/functions/submission-created.js`, sent through the **Resend** HTTP API (`https://api.resend.com/emails`) |
| Client logic | Inline `<script>` at the bottom of `index.html` |

There is no separate database. The authoritative list of signups is the Netlify
Forms submissions table; the address copy also lands in whoever the Netlify form
notification emails, if one is configured (Forms → Submission notifications).

## Spam protection

- **Honeypot** field `bot-field`, matched by `netlify-honeypot="bot-field"` on the
  form. The field is positioned off-screen, removed from the tab order
  (`tabindex="-1"`), and hidden from assistive tech (`aria-hidden`). If it is
  filled, the client pretends to succeed and Netlify discards the submission.
- Native HTML5 validation: `type="email" required` plus CSRF-free same-origin POST.

## Note on the served HTML (not a bug)

`curl https://trackd.deanware.com/` shows a `<form>` tag with **no**
`data-netlify="true"` and **no** `netlify-honeypot`, and single-quoted attributes.
That is Netlify's own form post-processing re-serializing the tag on the way out.
The attributes are present in the source (`index.html`) and were seen when Netlify
built the form definition, so form registration, the server-side honeypot and the
`form-name` all keep working. A POST to `/` with `form-name=trackd-test-group`
returns 200 and is recorded. Do not "fix" the served tag.

## Consent (field names owned by the compliance task)

- `beta_consent` — **required**, starts unticked. Blocks submission until ticked.
- `marketing_consent` — optional, separate tick. Never bundled with the beta opt-in.
- Both are declared on the static form, so Netlify registers them at deploy time and
  stores them with each submission (a field Netlify never sees at build time is
  dropped from the stored record).
- Both are also sent to `/api/beta-signup` as booleans (`beta_consent`,
  `marketing_consent`) since contract v2, so the primary path records consent
  evidence and not just the address.

## Required setup to finish (one step)

The form, storage and consent work as deployed. **The confirmation email needs a
Resend API key:**

1. Create a Resend account and (recommended) verify `deanware.com` as a sending
   domain (adds SPF/DKIM DNS records).
2. Create an API key (`re_…`).
3. In Netlify: **Site configuration → Environment variables** add
   - `RESEND_API_KEY` = the key
   - `SIGNUP_FROM_EMAIL` = `Trackd <hello@deanware.com>` (a verified sender;
     defaults to the sandbox `onboarding@resend.dev`, which only delivers to the
     account owner's own address)
   - optional `SIGNUP_REPLY_TO` (defaults to `trackd@deanware.com`)
4. Redeploy so the function picks up the variables.

Until the key is set the function logs a warning and returns 200 without sending:
**submissions are still stored**, but no confirmation email goes out.

## Verifying

1. Submit a real email from the live page.
2. Netlify → Forms → `trackd-test-group` → confirm the row shows `email`,
   `beta_consent: on`, and `marketing_consent: on` only when that box was ticked.
3. Confirm the install-instructions email arrives.

## Unsubscribe / deletion

The confirmation email tells the recipient to reply with "unsubscribe"; deletions
are done by deleting the row in the Netlify Forms table (and, for the marketing
list, by removing the address from any future send).
