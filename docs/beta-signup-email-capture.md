# Beta signup email capture

How the email capture on the Trackd landing page (`trackd.deanware.com`) works,
where the list lives, and what still needs to be switched on.

## Flow

1. Visitor enters an email in the above-the-fold form (`index.html`, hero section).
2. The form is a **Netlify Form** (`name="trackd-test-group"`). It is submitted by
   JavaScript via `fetch("/", …)` as `application/x-www-form-urlencoded`; with JS
   disabled the browser does the same POST natively.
3. Netlify stores the submission and fires the event function
   `submission-created` (`netlify/functions/submission-created.js`).
4. That function sends the beta confirmation email (install instructions) to the
   submitted address via **Resend**.
5. The page shows `Check your inbox for install instructions.` on success, or an
   inline error on failure.

## Endpoint / service

| Concern | Where |
| --- | --- |
| Submission endpoint | `POST https://trackd.deanware.com/` with `form-name=trackd-test-group` (Netlify Forms) |
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

## Consent (field names owned by the compliance task)

- `beta_consent` — **required**, starts unticked. Blocks submission until ticked.
- `marketing_consent` — optional, separate tick. Never bundled with the beta opt-in.
- Both are declared on the static form, so Netlify registers them at deploy time and
  stores them with each submission (a field Netlify never sees at build time is
  dropped from the stored record).

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
