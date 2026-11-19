# Signup-list data-deletion procedure — Trackd beta email list

**Purpose:** the operational record for deleting a beta signup email. This is the "how it is deleted"
half of the promise in `privacy-policy.html` §6 ("How to get your data deleted (beta email list)").
A promise with no procedure behind it is a false statement, so this file is what makes the policy true.

- **Data covered:** the email address submitted on the `trackd.deanware.com` beta signup form, plus the
  submission metadata Netlify records with it (IP address, user-agent, timestamp), plus the address's
  presence on any marketing/update list.
- **Not covered here:** extension/Gmail data (never leaves the user's browser — nothing to delete),
  Gumroad purchase records (Gumroad is an independent controller; route the request to them), Umami
  analytics (aggregate only, no identifier retained).
- **Where the list lives:** Netlify, site `trackd-deanware` (team `deanware`), **Forms → `trackd-test-group`**.
  It is *not* in any product database and there is no Trackd account system.
- Companion files: `docs/beta-email-consent-runbook.md` (consent + unsubscribe),
  `scripts/delete-signup-data.py` (this procedure, executable),
  `scripts/verify-netlify-forms-consent.py` (read-only consent read-back).

## 0. Open item that changes this document (checked 19 Nov 2026)

A new endpoint `POST /api/beta-signup` (backend card **t_8cb89494**) is being deployed to replace the
Netlify Forms transport. Until it is live (today `https://trackd.deanware.com/api/beta-signup` answers
**404** and the page falls back to the Netlify Forms POST), **Netlify Forms is the store and this document
is accurate as written**.

Two things must be settled before that endpoint becomes the primary path, or this document becomes a
description of a store that no longer holds the addresses:

1. **The store moves.** If the endpoint keeps the address in a provider audience (rather than Netlify
   Forms), deletion runs in that provider's UI/API, not in Netlify Forms — parts 3, 3a and 5 below must be
   re-pointed. Tracked on card **t_791777d5's follow-ups**.
2. **The consent record must move with it.** The frozen contract currently sends only
   `{email, honeypot, source}`; the consent values never leave the browser, so the endpoint stores no
   proof of consent for the processing the policy describes in §9. Amending the contract is card
   *"Carry consent evidence through /api/beta-signup"* (backend-developer + frontend-developer).

Deleting a record that never recorded consent is easy; proving consent for the records you keep is not.
Do not let the migration ship without item 2.

---

## 1. Receiving a request

The public path (published in the policy) is:

> email **trackd@deanware.com** with the subject line **"Delete my data"**

Also treat these as erasure requests: a reply to any Trackd email saying "unsubscribe" **and** "delete my
data" / "remove everything" (unsubscribe alone = suppression only, see §5), a GDPR Art. 17 request naming
erasure, or a CCPA/CPRA deletion request.

**Log it on the day it arrives** before doing anything else — a one-line entry (date received, request
type, ticket/email thread reference). The response clock starts on receipt:

| Regime | Deadline |
|---|---|
| GDPR (EEA/UK) | **1 month** from receipt, extendable by 2 months for complex/multiple requests (tell the person if you extend) |
| CCPA/CPRA (California) | **45 days**, extendable to 90 with notice |
| Our own published promise (policy §6) | **30 days** — stricter than both, so it governs |

Do not delete the *request* itself; keep the log entry as compliance evidence. The log must contain no
data beyond "request received / request completed + dates".

## 2. Locate the record

**UI path (no tooling needed):** Netlify UI → site `trackd-deanware` → **Forms** → `trackd-test-group` →
search the email address. Check both tabs:

- **Verified submissions** — normal rows.
- **Spam submissions** — reachable in the API as `?state=spam`. A submission Akismet flagged (or one
  marked spam later) is invisible on the default tab; a deferred spam row is still stored PII.

**API path:** `python3 scripts/delete-signup-data.py --email <address>` (dry run — it prints matches and
deletes nothing). See §4.

## 3. Delete

1. Delete **every** matching submission, in both the verified and spam lists. Netlify cannot edit a
   submission in place, so a correction is delete-and-recapture — never leave a "corrected" duplicate
   behind.
2. Deletion is **permanent and immediate**. Export first only if you actually need the data for something
   else; otherwise do not create a copy, because a backup you keep is still personal data you must then
   delete.
3. Remove the address from any update/marketing list. If an ESP (Mailchimp/Loops/Resend Broadcasts/…) ever
   holds the contact, delete it there **and** add it to the suppression list so a later CSV import cannot
   resurrect it.
4. If Netlify ever gains a **file-upload field** on this form, note that deleted uploads stay reachable at
   their direct URL for 24 hours. The beta form has no upload field today, so this does not apply.
5. Keep the address on the **suppression list** (§5) — this is the one retention that survives an erasure
   request, and the confirmation reply must say so.

## 4. The API route (programmatic, auditable)

Verified endpoints (base `https://api.netlify.com/api/v1`):

```
GET    /sites/{site_id}/forms                     # find the form_id for trackd-test-group
GET    /forms/{form_id}/submissions               # verified submissions (100/page; paginate via Link header)
GET    /forms/{form_id}/submissions?state=spam    # spam submissions
DELETE /submissions/{submission_id}               # delete one submission
```

Auth: header `Authorization: Bearer <PAT>` plus a `User-Agent`. Create the token at
Netlify → Applications → **Personal access tokens**. A Netlify password reset invalidates existing tokens.

Using the script (preferred — it does the dry run, the spam sweep and the pagination for you):

```bash
export NETLIFY_TOKEN=nfp_...        # never commit, never paste into a ticket or CI log
python3 scripts/delete-signup-data.py --email someone@example.com              # dry run: matches only
python3 scripts/delete-signup-data.py --email someone@example.com --confirm    # deletes matches
```

Raw equivalent for one known submission id:

```bash
curl -X DELETE \
  -H "Authorization: Bearer $NETLIFY_TOKEN" \
  -H "User-Agent: trackd-compliance (trackd@deanware.com)" \
  https://api.netlify.com/api/v1/submissions/<SUBMISSION_ID>
```

**Secrets rule:** `NETLIFY_TOKEN` lives in the shell environment only — never in the repo, never in a
worker's printed output, never in a comment on the board.

## 5. Suppression list (do not delete this)

Keep the **bare address** of anyone who opted out or asked for erasure, in `do-not-contact.csv`
(git-ignored, kept outside the repo) or the ESP's own suppression list. Purpose: honour the objection
permanently — without it, a future export/import re-adds the person and we re-contact someone who asked
us not to.

- Contains: the address only. No name, no notes, no request history.
- Say so in the confirmation reply: "we've deleted your data and kept only your email address on a
  do-not-contact list so we never mail you again."
- GDPR basis: Art. 17(3)(b)/(e)-style retention for legal claims and for honouring the objection; it is
  a legitimate-interest retention (Art. 6(1)(f)) that we disclose.

## 6. Retention sweep (on a calendar, not on request)

Netlify **never expires form submissions on its own**, so the policy's stated retention ("while the beta
runs, max 12 months after it ends") is fiction without a scheduled sweep. Diarise every 6 months:

```bash
python3 scripts/delete-signup-data.py --list                    # see what is stored
python3 scripts/delete-signup-data.py --sweep --older-than-days 395 --confirm
```

1. Export the current list to CSV and store it somewhere the operator controls (that backup is now
   personal data you are responsible for — delete it when the beta closes).
2. Delete submissions older than the policy's stated retention.
3. When the beta closes: **stop collecting** (remove the form or the endpoint), then delete the whole list
   once the 12-month period from §6 lapses.
4. Record the sweep date and how many rows were removed.

## 7. Confirmation and closing the request

1. Reply in writing to the requester: what was deleted (the signup submission and its metadata; any
   mailing-list entry), when, and the fact that the bare address stays on the do-not-contact list and why.
2. Log completion: request date, completion date, nothing else.
3. If any part of the request could not be met (e.g. the address also appears in a Gumroad purchase
   record), say so explicitly and name the controller to contact.

---

*I am an AI compliance bot, not your attorney. Verify critical documents before deployment.*
