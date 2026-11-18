# Consent, unsubscribe and data-deletion runbook — Trackd beta email list

Task t_bf47c595 · Owner: Trackd developer · Target: publish with the beta launch

**Correction notice:** the first version of this runbook described the *live* deployed page, which is a
stale deploy. The repo at `/opt/data/trackd` (commit `0f4e479`, 18 Nov 2026) already implements the
consent block, `data-netlify="true"`, the honeypot and a Resend-backed confirmation email. Everything
below is re-verified against the repo, not the served page.

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

**On the live site:** **not** done. `https://trackd.deanware.com` currently serves the older
`class="test-form"` markup with no consent block and no `data-netlify` attribute. So the form is
compliant in Git and non-compliant in production until a deploy lands. **[BLOCKING]**

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

---

## Part 2 — Unsubscribe

### What exists today

The confirmation email (`netlify/functions/submission-created.js`, sent through **Resend**,
`api.resend.com`) carries a plain-text footer:

> You are receiving this because you signed up for Trackd early access at trackd.deanware.com. To
> unsubscribe, reply to this email with the word "unsubscribe" and we will remove your address.

That is a real mechanism for the message it appears in, and it is the right shape: the message identifies
why it was sent and how to stop it. Two gaps:

- **No `List-Unsubscribe` header.** Mail providers offer one-click unsubscribe at the client level when
  this header is present. Resend supports it; add it when the message becomes anything other than
  transactional.
- **No physical postal address.** The confirmation email is a *transactional/relationship* message
  (it delivers access the user asked for), so most CAN-SPAM marketing requirements — the advertisement
  label and the opt-out — do not apply to it. **The moment a message becomes promotional, they all do**,
  including a valid physical postal address in the body. Get an address (a registered PO box or virtual
  business address is fine) and put it in both the email footer and the policy.

### Working path — mailbox route (live today)

1. Unsubscribe replies land in `trackd@deanware.com` (Google Workspace — `deanware.com` MX is
   `aspmx.l.google.com`; reply-to is already set to that address in the function).
2. Search for the sender address, remove them from any future send, and add them to the suppression
   list (below).
3. Reply to confirm removal.

Deadlines: **promptly** for GDPR, within **10 business days** for CAN-SPAM. Opt-out may not require
anything beyond an email reply or a single web page, and may not charge a fee.

### Working path — ESP route (for any actual marketing send)

Resend is already wired for **transactional** mail. If Trackd sends a launch announcement or product
news, either (a) send it as a campaign through an ESP that owns the unsubscribe link and
`List-Unsubscribe` header (Mailchimp, Buttondown, Loops, Resend Broadcasts, …), or (b) hand-roll
compliance in the function. Provider AUPs apply either way: Resend's policy requires
permission-based lists, prohibits purchased/scraped lists, and expects an unsubscribe; Mailchimp etc.
suspend accounts that generate abuse complaints. **Bulk mail must not go out from the Google Workspace
mailbox** — see compliance-notes B6.

Keep the Resend **sending domain verified** (`deanware.com`, adding Resend's SPF/DKIM records). Right
now `deanware.com`'s SPF is `include:_spf.google.com` only and DMARC is `p=none`; sending through Resend
without aligning SPF/DKIM is a deliverability problem, not a compliance one, but it decides whether your
install emails reach anyone.

### Suppression list — required, keep it even for an erasure request

Keep a small do-not-contact list (an email column, or `do-not-contact.csv` in the repo) containing only
the address that opted out, so the person is never re-imported from an old Netlify CSV export. On a GDPR
erasure request, delete everything else about them and keep this one entry, telling them exactly why: the
bare address is retained solely to honour their objection.

---

## Part 3 — Data deletion request (the "Delete my data" path)

### Promise in the policy

Email `trackd@deanware.com` with the subject **"Delete my data"** → deletion + confirmation **within
30 days**.

### Internal steps

1. **Log it.** Note the date received. The clock (GDPR: one month; CCPA: 45 days, extendable) starts on
   receipt — don't leave it in the inbox.
2. **Locate the record.** Netlify UI → site `trackd-deanware` → **Forms** → `trackd-test-group`, search
   the address. (Or via API — Part 3a.)
3. **Delete it.** Tick the submission → **Delete submission** → confirm. Deletion is permanent; export
   first only if you need it, and keep the *request* log, not the data.
4. **Remove from mailing lists.** Remove from the update list and add to the suppression list (Part 2).
   If an ESP holds the contact, delete it *and* suppress it so a later import cannot resurrect it.
5. **Check the spam store too.** Search `?state=spam` — a deleted-then-marked-spam submission can sit
   there. (Note: Netlify keeps deleted file uploads reachable at their direct URL for 24 h. The beta
   form has no upload field, so this does not bite here.)
6. **Confirm in writing**, stating what was deleted and when.
7. **Log the completion** (request date, completion date, nothing else) as compliance evidence.

### Part 3a — Programmatic deletion (Netlify REST API v1)

Verified endpoints (base `https://api.netlify.com/api/v1`):

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

### Retention sweep — on a calendar, not on request

Netlify has no automatic expiry of form submissions and recommends exporting and deleting PII regularly.
Set a recurring reminder to: export the beta list to CSV (store the backup somewhere you control),
delete submissions older than the policy's stated retention, and remove the whole list when the beta
closes plus 12 months. That sweep is what makes the policy's retention commitment true.

---

## Part 4 — Access requests, and honest gaps

1. **Access / portability.** Export the CSV from Netlify and send only the requester's rows. The only
   other holder is Resend (for one send) and the ESP, if one is ever adopted.
2. **Rectification.** Netlify cannot edit a submission in place — delete and re-capture, or correct your
   own CSV and note the discrepancy.
3. **Verify on the deployed site, not locally.** The old inline error on the live page said it out loud:
   "Netlify Forms only works on the live trackd-deanware.netlify.app page." Confirm a real submission
   appears under Forms → `trackd-test-group` **with `beta_consent: on`**.
4. **Resend is not yet switched on in production** unless `RESEND_API_KEY` is set in Netlify's env vars.
   Without it the function logs a warning and returns 200: submissions are stored but **no confirmation
   email is sent** — which would silently break the policy's promise that we email install instructions.
   Set `RESEND_API_KEY` and `SIGNUP_FROM_EMAIL` (a verified sender; the default `onboarding@resend.dev`
   only delivers to the account owner), then redeploy. **[BLOCKING]**
5. **Physical postal address still missing** — needed in marketing emails and in the policy's controller
   section. Fill the `[TODO]` markers in `privacy-policy.html` / `privacy-policy.md`.

---

*I am an AI compliance bot, not your attorney. Verify critical documents before deployment.*
