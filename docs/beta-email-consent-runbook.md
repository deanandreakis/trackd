# Consent, unsubscribe and data-deletion runbook — Trackd beta email list

Task t_bf47c595 · Owner: Trackd developer · Target: publish with the beta launch

**Correction notice:** the first version of this runbook described the *live* deployed page, which was a
stale deploy. The repo at `/opt/data/trackd` (commit `0f4e479`, 18 Nov 2026) already implements the
consent block, `data-netlify="true"`, the honeypot and a confirmation email (then sent through Resend).
Everything below is re-verified against the repo, not the served page.

**Second correction (19 Nov 2026, task t_791777d5):** the stale-deploy gap is closed. The live site now
serves the consent block verbatim, and `https://trackd.deanware.com/privacy-policy` byte-matches
`privacy-policy.html` in `main`. Anything below that still says "on the live site: not done" is historical;
see `docs/signup-consent-copy.md` for the deployed copy and `docs/consent-live-verification.md` for the
live verification record. The deletion path now has its own file:
`docs/signup-list-data-deletion-procedure.md` (executable via `scripts/delete-signup-data.py`).

**Third correction (23 Nov 2026, task t_b3048688): the email provider is AWS SES, not Resend.** The
confirmation email is no longer sent through Resend. The live path is `netlify/lib/ses-provider.js` (AWS
SES v2 REST API, SigV4-signed in-repo by `netlify/lib/aws-sigv4.js`, no AWS SDK);
`netlify/lib/resend-provider.js` is deleted and there is no Resend code path left. The authoritative design
note is `docs/beta-signup-email-capture.md`. Where this runbook named Resend as the live processor it has
been rewritten for SES; the only remaining "Resend" strings are deliberate *possible-future-ESP* examples,
never a description of what ships. **Note the policy side is only half-done until it is deployed:** the
corrected `privacy-policy.html` is committed locally, but `main` (and therefore the live site) is not
pushed, so the *served* policy still says Resend until that deploy lands.

This is the operational half of the privacy policy. The policy makes three promises; each one has a
concrete path below. A promise with no path is a false statement, so do not publish the policy until the
items marked **[BLOCKING]** are done.

---

## Part 1 — Consent at the point of collection

### State of play

**In the repo (`index.html`, `signup-form`):** already done, and it matches the compliance spec.

| Field | Required? | Starts | Purpose |
|---|---|---|---|
| `beta_consent` | **yes** | unticked | Install instructions + beta messages |
| `marketing_consent` | no | unticked | Product news, separate and optional |

Both are declared on the **static** form in `index.html`, so Netlify sees them when it parses the built
HTML and stores them with each submission. `data-netlify="true"`, `netlify-honeypot="bot-field"` and the
hidden `form-name` are all present. `docs/beta-signup-email-capture.md` in the repo documents the same.

**On the live site:** **done as of 19 Nov 2026** — `https://trackd.deanware.com` serves the consent block
with the wording below, `name="trackd-test-group"`, and both ticks unticked on a fresh load (Netlify
re-serialises the `<form>` tag and drops `data-netlify` / `netlify-honeypot`; that is expected, not a bug).
Verification record: `docs/consent-live-verification.md`. Canonical copy for the frontend:
`docs/signup-consent-copy.md`.

### Two wording fixes before this ships

1. **"and I accept the Privacy Policy"** — a privacy policy is something you *acknowledge having read*,
   not a contract the user accepts, and "accepting a policy" is not consent to a described processing
   purpose. Reword to make the *processing* the thing being agreed to.
2. **"beta updates" in the required tick overlaps "tips and product news" in the optional one.** Two
   ticks with overlapping purposes erode the "specific" element of consent, and the overlap means a user
   who declines marketing is still opted into something marketing-shaped.

Recommended replacement for the two labels (keep the field names and IDs exactly as they are):

```html
<label class="signup-consent__row">
  <input type="checkbox" name="beta_consent" id="beta-consent" required />
  <span>Send me the Trackd install instructions and messages about the beta testing group. I have read
  the <a href="/privacy-policy">Privacy Policy</a>.</span>
</label>
<label class="signup-consent__row">
  <input type="checkbox" name="marketing_consent" id="marketing-consent" />
  <span>Optional: also send me occasional Trackd product news and tips. I can unsubscribe at any time
  with one click. See the <a href="/privacy-policy">Privacy Policy</a>.</span>
</label>
```

Do **not** pre-tick either box: a pre-ticked box is not valid consent (GDPR Recital 32).

### Evidence trail

Checkbox values are submitted only when ticked, so a stored submission reads `beta_consent: on` and,
when given, `marketing_consent: on`, with Netlify's timestamp on the row. That combination is the
consent record — never default the fields to `on` in markup and never strip unknown fields from the
POST. A field Netlify has never seen in the built HTML is silently dropped from the stored submission,
so if the form is ever moved to JS-rendered markup, mirror the field names in a static skeleton (the
repo's documented convention would be `public/__forms.html`).

> **Open item — consent evidence on the new endpoint.** The live page now also POSTs JSON to
> `POST /api/beta-signup`, whose frozen contract carries only `{email, honeypot, source}`. That endpoint
> does not read or store the consent values yet, so a signup captured through it has no server-side
> consent record (GDPR Art. 7(1)). Persisting `beta_consent` / `marketing_consent` and gating any
> promotional send on them is card **t_30b0eae6**. Until it lands, the Netlify Forms row above remains
> the only consent evidence.

---

## Part 2 — Unsubscribe

### What exists today

The confirmation email is built by `netlify/lib/confirmation-email.js` and sent through **AWS SES**
(`netlify/lib/ses-provider.js` → `POST https://email.<region>.amazonaws.com/v2/email/outbound-emails`),
synchronously from the signup endpoint (`netlify/lib/beta-signup.js`). The legacy Netlify Forms event
function `netlify/functions/submission-created.js` is dormant but sends the same copy through the same
provider. The message carries a plain-text footer:

> You are receiving this because you signed up for Trackd early access at trackd.deanware.com. To
> unsubscribe, reply to this email with the word "unsubscribe" and we will remove your address.

That is a real mechanism for the message it appears in, and it is the right shape: the message identifies
why it was sent and how to stop it. Two points:

- **`List-Unsubscribe` header — present.** `confirmation-email.js` sets
  `List-Unsubscribe: <mailto:trackd@deanware.com?subject=unsubscribe>`, and the SES provider forwards the
  message's headers on the send, so the header is on the wire today (a mailto one-click target). When the
  message becomes anything other than transactional, also add `List-Unsubscribe-Post` / an HTTPS
  one-click URL.
- **No physical postal address.** The confirmation email is a *transactional/relationship* message
  (it delivers access the user asked for), so most CAN-SPAM marketing requirements — the advertisement
  label and the opt-out — do not apply to it. **The moment a message becomes promotional, they all do**,
  including a valid physical postal address in the body. Get an address (a registered PO box or virtual
  business address is fine) and put it in both the email footer and the policy.

### Working path — mailbox route (live today)

1. Unsubscribe replies land in `trackd@deanware.com` (Google Workspace — `deanware.com` MX is
   `aspmx.l.google.com`; reply-to is already set to that address in the SES provider).
2. Remove the address from the **AWS SES contact list** (the beta list) and from any future send, and add
   it to the suppression list (below).
3. Reply to confirm removal.

Deletion command for the beta list (SES v2):

```bash
aws sesv2 delete-contact --contact-list-name trackd-beta --email-address user@example.com
```

Deadlines: **promptly** for GDPR, within **10 business days** for CAN-SPAM. Opt-out may not require
anything beyond an email reply or a single web page, and may not charge a fee.

### Working path — ESP route (for any actual marketing send)

AWS SES is wired for **transactional** mail only. If Trackd sends a launch announcement or product
news, either (a) send it as a campaign through an ESP that owns the unsubscribe link and
`List-Unsubscribe` header (Mailchimp, Buttondown, Loops, Resend Broadcasts, …), or (b) hand-roll
compliance in the function. **Provider AUPs apply either way.** AWS's **Acceptable Use Policy** and
**Service Terms** prohibit unsolicited bulk mail, require permission-based lists with a working
unsubscribe, and enforce a complaint-rate threshold that can pause sending — the same abuse rules that
apply to Mailchimp and peers apply to SES. Mailchimp etc. likewise suspend accounts that generate abuse
complaints. **Bulk mail must not go out from the Google Workspace mailbox** — see compliance-notes B6.

Keep the AWS SES **sending identity verified** for `deanware.com`. AWS verifies a domain with **SES Easy
DKIM**, which publishes **three CNAME records**:

```
<token1>._domainkey.deanware.com.  CNAME  <token1>.dkim.amazonses.com.
<token2>._domainkey.deanware.com.  CNAME  <token2>.dkim.amazonses.com.
<token3>._domainkey.deanware.com.  CNAME  <token3>.dkim.amazonses.com.
```

These do **not** touch the apex SPF record. As verified on 23 Nov 2026, `deanware.com`'s SPF is
`v=spf1 include:_spf.google.com ~all` (Google-only) and DMARC is
`v=DMARC1; p=none; rua=mailto:dean@deanware.com`. DKIM signs with `d=deanware.com`, which **aligns with
DMARC on its own**, so SPF alignment is *not* required for the message to authenticate — this is a
deliverability concern, not a compliance one, but it decides whether install emails reach anyone. Only if
you want SPF alignment as well: add a **custom MAIL FROM subdomain** (e.g. `mail.deanware.com` with an MX
to `feedback-smtp.<region>.amazonses.com` and TXT `v=spf1 include:amazonses.com ~all`). Adding
`include:amazonses.com` to the apex SPF *alone* makes SPF pass but aligns it with `amazonses.com`, not
`deanware.com` — so it does not help DMARC alignment by itself.

### Suppression list — required, keep it even for an erasure request

Keep a small do-not-contact list (an email column, or `do-not-contact.csv` in the repo) containing only
the address that opted out, so the person is never re-imported from an old export. On a GDPR
erasure request, delete everything else about them and keep this one entry, telling them exactly why: the
bare address is retained solely to honour their objection.

---

## Part 3 — Data deletion request (the "Delete my data" path)

**Full procedure: `docs/signup-list-data-deletion-procedure.md`** — the standalone SOP (receive → locate →
delete → suppress → confirm → sweep), with `scripts/delete-signup-data.py` as its executable form for the
Netlify Forms store (`--list`, `--email X [--confirm]`, `--sweep --older-than-days N [--confirm]`; dry run
by default). The summary below is retained for context.

### Promise in the policy

Email `trackd@deanware.com` with the subject **"Delete my data"** → deletion + confirmation **within
30 days**.

### Internal steps

1. **Log it.** Note the date received. The clock (GDPR: one month; CCPA: 45 days, extendable) starts on
   receipt — don't leave it in the inbox.
2. **Locate the record.** Search **both** stores: the **AWS SES contact list** (SES console → Configuration
   → Contact lists → `trackd-beta`, or `aws sesv2 list-contacts --contact-list-name trackd-beta`) and any
   legacy Netlify Forms submission (Netlify UI → site `trackd-deanware` → Forms → `trackd-test-group`).
3. **Delete it.** Remove the contact from the SES list (`aws sesv2 delete-contact …`, above) and delete any
   matching Netlify submission. Deletion is permanent; export first only if you need it, and keep the
   *request* log, not the data.
4. **Remove from mailing lists.** Remove from the update list and add to the suppression list (Part 2).
   If an ESP holds the contact, delete it *and* suppress it so a later import cannot resurrect it.
5. **Check the spam store too.** Search Netlify `?state=spam` — a deleted-then-marked-spam submission can
   sit there. (Note: Netlify keeps deleted file uploads reachable at their direct URL for 24 h. The beta
   form has no upload field, so this does not bite here.)
6. **Confirm in writing**, stating what was deleted and when.
7. **Log the completion** (request date, completion date, nothing else) as compliance evidence.

### Part 3a — Programmatic deletion

**SES beta list (the authoritative store):**

```bash
aws sesv2 delete-contact --contact-list-name trackd-beta --email-address user@example.com
```

**Legacy Netlify Forms store (Netlify REST API v1, base `https://api.netlify.com/api/v1`):**

```
GET    /sites/{site_id}/forms                       # find the form_id for trackd-test-group
GET    /forms/{form_id}/submissions                 # list verified submissions
GET    /forms/{form_id}/submissions?state=spam      # list spam submissions
DELETE /submissions/{submission_id}                 # delete one submission
```

Auth: `Authorization: Bearer <personal access token>` (Netlify: Applications → Personal access tokens)
plus a `User-Agent` header. Paginate via the `Link` header (100 per page by default).

```bash
# Delete one submission — run from a trusted shell only, never echo the token into CI logs
curl -X DELETE \
  -H "Authorization: Bearer $NETLIFY_PAT" \
  -H "User-Agent: trackd-compliance (trackd@deanware.com)" \
  https://api.netlify.com/api/v1/submissions/<SUBMISSION_ID>
```

Secrets rule: the PAT goes in an environment variable — never in the repo, never in output a worker
prints. A Netlify password reset invalidates existing tokens.

> **Open item.** `scripts/delete-signup-data.py` deletes only from the Netlify Forms API — it does **not**
> yet remove a contact from the SES list. Until a SES-aware path is added, every erasure request must run
> the `aws sesv2 delete-contact` step by hand. Track as a follow-up to the SES migration.

### Retention sweep — on a calendar, not on request

Neither Netlify nor SES expires list entries on its own. Set a recurring reminder to: export the beta list
to CSV (`scripts/export-beta-signups.mjs`), delete entries older than the policy's stated retention, and
remove the whole list when the beta closes plus 12 months. That sweep is what makes the policy's retention
commitment true.

---

## Part 4 — Access requests, and honest gaps

1. **Access / portability.** Export the SES contact list (`scripts/export-beta-signups.mjs`, needs
   `ses:ListContacts`) and the legacy Netlify CSV, and send only the requester's rows. The only other
   holder is AWS SES (the beta contact list and the one send) and the ESP, if one is ever adopted.
2. **Rectification.** Neither SES contacts nor Netlify submissions can be edited in place — delete and
   re-capture, or correct your own CSV and note the discrepancy.
3. **Verify on the deployed site, not locally.** Confirm a real submission appears in the SES contact list
   `trackd-beta` **and** that the confirmation email arrives (on the legacy Forms path, confirm the row
   under Forms → `trackd-test-group` **with `beta_consent: on`**).
4. **The SES-backed endpoint is not yet switched on in production.** The live page still falls back to the
   Netlify Forms POST until `main` is deployed with the SES code, and even then the endpoint cannot send
   until the AWS environment variables are set in Netlify. Required: `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `SIGNUP_FROM_EMAIL` (a SES-verified sender) and
   `SES_CONTACT_LIST` (the beta list), plus `SIGNUP_HASH_SALT`; optional `SIGNUP_REPLY_TO`,
   `AWS_SESSION_TOKEN`. Without the credentials or `SIGNUP_FROM_EMAIL` the endpoint returns a generic `500`
   and stores nothing, so the policy's "we email you install instructions" promise silently fails.
   **[BLOCKING]**
5. **Leave the SES sandbox before opening signup to the public.** A new SES account is sandboxed: it can
   only send *to* addresses you have verified, with a low daily quota. Until production access is granted
   (SES console → Account dashboard → Request production access), confirmations to real visitors are
   rejected — so "the confirmation email arrives" is currently false for anyone who has not pre-verified
   their address. **[BLOCKING for public launch]**
6. **AWS processor/transfer position.** The AWS Data Processing Addendum incorporating the SCCs is part of
   the AWS Service Terms and applies automatically when AWS processes customer data — no separate signature
   is required in the AWS account, so the policy's SCC claim holds for AWS. Still confirm **which AWS
   contracting entity** the account is under (Amazon Web Services, Inc. vs Amazon Web Services EMEA SARL):
   the policy names the US entity. See `docs/privacy-compliance-assessment.md` §C4.
7. **Physical postal address still missing** — needed in marketing emails and in the policy's controller
   section. Fill the `[TODO]` markers in `privacy-policy.html` (the published file; there is no separate
   Markdown copy).

---

*I am an AI compliance bot, not your attorney. Verify critical documents before deployment.*
