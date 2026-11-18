# Trackd beta email collection — compliance assessment and platform requirements

Task t_bf47c595 · Assessed 18 November 2026 · Subject: the `trackd.deanware.com` beta signup (email
address capture) and the Trackd Chrome extension it promotes.

**Correction notice:** the first version of this assessment described the *live served* page and missed
what had already landed in the repo (`/opt/data/trackd`, commit `0f4e479`): a compliant consent block,
`data-netlify="true"`, the honeypot, and a Resend-backed confirmation email. Findings below are
re-verified against the repo and the live deployment separately, because they disagree.

> Risk levels: **[HIGH]** = likely enforcement/rejection, or a false statement inside a published
> document; **[MEDIUM]** = real exposure or a documented requirement not yet met; **[LOW]** = housekeeping.

> I am an AI compliance bot, not your attorney. Verify critical documents before deployment.

---

## A. Data inventory (map before you write, never after)

| # | Data element | Collected at | Purpose | Lawful basis (GDPR) | Processed by | Stored where / region | Retention | Shared with |
|---|---|---|---|---|---|---|---|---|
| 1 | Email address | Beta signup form | Add to testing group; send install instructions | Consent + Art. 6(1)(b) service request | Netlify Forms | Netlify submissions DB, **US** | Beta run + max 12 months | Netlify (processor) |
| 2 | Email address | Same form, optional tick | Product news | Consent (separate, optional tick) | Developer / ESP | Mailing list | Until unsubscribe | ESP, once one is used |
| 3 | IP address, user-agent, timestamp | Beta signup form (auto-added by Netlify) | Spam/abuse filtering | Legitimate interest | Netlify, Akismet | Netlify submissions DB, **US** | Deleted with the submission | Netlify, Akismet (processors) |
| 4 | Email address (transient) | Netlify event function → Resend API | Deliver the install-instructions email | Art. 6(1)(b) service request | Netlify function, Resend | Transit only; Resend logs for delivery | Provider log retention | Resend (processor) |
| 5 | Page views, referrer, browser/OS/device, country | Website | Measure promotion effectiveness | Legitimate interest | Self-hosted Umami (`umami.andreakis.org`) | Our server | Aggregated, cookieless | None (self-hosted) |
| 6 | Anonymous usage events (event type + random session id) | Extension (`ea08a004-…`) | Reliability / feature measurement | Legitimate interest | Self-hosted Umami | Our server | Aggregated | None (self-hosted) |
| 7 | Gmail metadata + billing email content (restricted scope `gmail.readonly`) | User's browser, after OAuth | Detect subscriptions | Consent (OAuth grant) | Trackd extension, client-side only | `chrome.storage.local`, on device | Until uninstall | **None** — never leaves the device |
| 8 | Email + Gumroad licence key | Gumroad checkout (Pro) | Licence verification | Contract | Gumroad | Gumroad, **US** | Gumroad's own policy | Gumroad (independent controller / merchant of record) |

Cross-check with the delivered policy: items 1–4 are the beta-signup sections; 5–6 analytics; 7 the
extension; 8 the Pro purchase. **Item 3 (IP + user-agent) and item 4 (Resend) were disclosed nowhere** in
the previous policy — both are now in it, and item 3 is also a CWS disclosure obligation ("all parties
the user data will be shared with").

---

## B. Risk register

### B1. Live form has no consent mechanism — **[HIGH]**

`https://trackd.deanware.com` serves the older `class="test-form"` markup: no consent checkbox, no
privacy-policy link, only the "No spam, unsubscribe anytime" note. GDPR needs a freely given, specific,
informed, unambiguous affirmative act (Recital 32); a note is not one, and CPRA requires notice at
collection. **Cause is deployment staleness, not missing code** — the repo already implements it
(see B7). **Fix:** deploy `index.html` from `main` and verify on the live page.

### B2. The published policy's promises have no mechanism until the wordings and deploy land — **[HIGH]**

"Unsubscribe anytime" and "we email you install instructions" are unqualified promises. Today, on the
live site, neither is backed by a working mechanism. **Fix:** deploy (B1/B7), set the Resend environment
variables (B7b), and keep the mailbox unsubscribe path documented in
`consent-and-unsubscribe-runbook.md` parts 2–3. The delivered policy now names the exact deletion route
("Delete my data" → `trackd@deanware.com` → 30 days), so that route must actually be operated.

### B3. Google API Limited Use affirmative statement was absent — **[HIGH] (fixed in delivered policy)**

CWS Limited Use requires an affirmative statement on a website belonging to the extension: *"The use of
information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the
Limited Use requirements."* The previous policy cited the policies but did not carry that sentence.
Added verbatim in section 12 of the delivered policy. Do not paraphrase or delete it.

### B4. Two-tick consent wording is imprecise — **[MEDIUM]**

In the repo's consent block: the required tick says *"Email me the Trackd install instructions and beta
updates, and I accept the Privacy Policy"* while the optional tick says *"Also send me occasional Trackd
tips and product news."*

- "I accept the Privacy Policy" frames a policy as a contract to accept; policies are acknowledged, not
  accepted, and that phrase is not consent to a described processing purpose.
- "beta updates" (required, cannot be declined) overlaps "tips and product news" (optional, declinable),
  which weakens the "specific" element of consent and leaves a marketing-shaped purpose in the
  non-declinable tick.

**Fix:** use the replacement labels in `consent-and-unsubscribe-runbook.md` part 1. Field names/IDs stay
exactly as they are, so nothing else needs to change.

### B5. Extension analytics under the tightened Limited Use policy — **[MEDIUM]**

The 1 July 2026 CWS policy update (enforcement from **1 August 2026**, so live now) requires extension
data collection to be strictly necessary to the disclosed single purpose. The published Limited Use text
still allows "related operational purposes, such as maintaining, securing, or measuring the performance
and reliability of those features" — the hook the extension's anonymous scan/confirm events sit on.
**Action:** audit the event list; keep events that measure whether subscription detection works, drop
anything engagement-marketing-shaped, and make sure the CWS "Privacy practices" answers match the
policy's analytics section.

### B6. Google Workspace mailbox must not be used for bulk marketing — **[MEDIUM]**

`deanware.com` is Google Workspace (MX `aspmx.l.google.com`, SPF `include:_spf.google.com` only, DMARC
`p=none`). Its acceptable-use terms prohibit unsolicited bulk mail and there are daily recipient caps.
One-to-one beta emails from the mailbox are fine; a launch blast to the whole list is not. Route anything
promotional through an ESP that owns the unsubscribe link and `List-Unsubscribe` header — Resend is
already wired for transactional mail and offers broadcasts/audiences if you want one provider for both.

### B7. Deployment/code gaps in the live form — **[MEDIUM]**

**a. Live is stale.** Repo `main` (`index.html`) has `data-netlify="true"`, `netlify-honeypot`,
hidden `form-name`, the consent block and the honeypot field; the live page has none of them. The
earlier investigation into "the form doesn't work" concluded the markup is correct and a POST returns
**HTTP 303 → Netlify's recorded-submission path**, so the fix is to ship the current build, not to debug
the handler.

**b. The confirmation email is not switched on in production.** `netlify/functions/submission-created.js`
sends through Resend and requires `RESEND_API_KEY` (plus `SIGNUP_FROM_EMAIL`; the default sandbox sender
`onboarding@resend.dev` only delivers to the account owner). Unset → submissions stored, **no email
sent**, i.e. the policy's install-instructions promise silently fails. **Blocking.**

**c. SPF/DKIM for Resend** are not in DNS yet (SPF is Google-only), so even once the key is set, sends
from `deanware.com` via Resend will not align. Deliverability, and it decides whether beta emails arrive
at all.

### B8. Restricted-scope OAuth verification for `gmail.readonly` — **[MEDIUM]**

`gmail.readonly` is a **restricted** scope. Restricted-scope use requires Google's OAuth app
verification; a third-party security assessment (CASA) is required where restricted-scope data is stored
on or transmitted to servers. Trackd's design keeps email client-side and stores only in
`chrome.storage.local`, so the server-storage trigger should not apply. The project's own setup notes
record the OAuth client as being in **GCP "testing" mode** with a 100-test-user cap, and the CASA
assessment (~$540/yr) deliberately **deferred**. That is a reasonable bet for a closed beta, but two
consequences belong on the record: the beta cannot grow past ~100 users without completing verification,
and section 12's assertion of Limited Use compliance must stay true as the extension evolves. Get the
position confirmed in writing with Google when you scale.

### B9. Controller identity and physical postal address incomplete — **[MEDIUM]**

The policy names "Trackd" with an email only. A GDPR policy should name the controller (legal name/sole
trader); CAN-SPAM requires a valid physical postal address in every marketing message. Both are left as
clear `[TODO]` markers in the delivered documents.

### B10. Retention has no automation — **[LOW]**

Netlify submissions never expire by themselves; its own docs tell you to export and delete PII
regularly. Calendar the sweep (runbook part 3) so the policy's 12-month maximum is real.

### B11. Gumroad as merchant of record — **[LOW]**

Gumroad is an independent controller for checkout data; the policy says so. Keep the link accurate and
remember Trackd never sees the buyer's payment data.

### B12. COPPA / children — **[LOW]**

Not child-directed; collecting only an email keeps the exposure small. The policy adds an
under-13/under-16 statement and a deletion-on-notice path.

---

## C. Platform and legal requirements that apply to collecting beta emails

### C1. Chrome Web Store — Developer Program Policies

CWS policies govern "the entire user experience of your application/extension/theme, including any …
landing pages", so the marketing site and its email form are in scope, not just the extension.

- **Privacy policy** — if the product handles any user data it must post an accurate, up-to-date policy
  that comprehensively discloses how data is collected, used and shared, plus **all parties it is shared
  with**, and link it in the designated Developer Dashboard field. → Delivered policy now lists Netlify,
  Akismet, Resend, Umami and Gumroad and discloses the IP/user-agent metadata. Verify the Dashboard field
  still points at `/privacy-policy`.
- **Disclosure requirements** — prior to installation the product must prominently disclose what user
  data is collected and how it is used and obtain affirmative, informed consent; post-install changes in
  data practices must be disclosed too. → Drives the consent tick (B1/B4) and the extension's
  install-time disclosures.
- **Limited Use** — no transfers to ad platforms, brokers or resellers; no human reading of user data;
  the affirmative Limited Use statement on the extension's website (B3); collection limited to the single
  purpose (B5).
- **Handling** — secure handling, modern cryptography in transit (HTTPS is already true), no public
  disclosure of auth information (keep Netlify/Resend/Gumroad keys out of the repo and out of logs).
- **Account hygiene** — 2-Step Verification is mandatory on the developer account; keep the contact email
  monitored, since Google removes items from unresponsive developers.

### C2. Google API Services User Data Policy (Gmail)

Restricted-scope verification (B8); the privacy-policy URL must be listed in the OAuth client
configuration and must document access/use/storage/sharing of Google user data; minimum relevant
permissions, requested in context where possible; no sale or transfer, no human reading, no ads,
credit-worthiness or lending use.

### C3. Email marketing and anti-spam law

- **CAN-SPAM (US)** covers *all* commercial messages, not just bulk, and B2B too: accurate
  From/To/Reply-To and routing, non-deceptive subject line, clear identification as an advertisement,
  a valid physical postal address, and a clear and conspicuous opt-out honoured within **10 business
  days**, requiring nothing beyond a reply email or one web page and no fee. Transactional/relationship
  messages (the install-instructions email the user asked for) are exempt from the ad label and opt-out
  requirements but still need accurate headers and subject. Promotional sends are not exempt — this is
  the dividing line covered in B6.
- **GDPR/PECR (EU/UK)** — marketing email needs prior consent; the soft opt-in only covers existing
  customers and similar products, which does not stretch to a beta waitlist; unsubscribing must be as
  easy as subscribing.
- **ESP acceptable use** — Resend, Mailchimp and peers all require permission-based lists, prohibit
  purchased or scraped lists, require a working unsubscribe for campaigns, and suspend accounts that
  exceed abuse-complaint rates. Their policies become part of Trackd's compliance surface once adopted.

### C4. Data-protection law for the signup itself

- **GDPR** — controller identified; purpose specific; lawful basis recorded (consent + legitimate
  interest, now written into the policy); retention capped; rights and contact path published; processors
  under contract with SCCs for US transfers. **Verify a Netlify DPA is accepted on the account** and that
  Resend's DPA/terms are in place, rather than assuming.
- **CCPA/CPRA** — notice at collection, policy content requirements, and rights to know, delete, correct
  and opt out of sale/share. Trackd does not sell or share for behavioural advertising, so no
  "Do Not Sell or Share" link is required, but the "we do not sell" statement must stay true. Threshold
  note: a solo beta is unlikely to meet the CCPA's business thresholds, but the disclosures cost nothing
  and the under-16 statement matters if promotion ever reaches teens.
- **COPPA** — not child-directed; keep the audience general and keep the policy statement.

---

## D. Delivered in this task

| File | Purpose | Ready to publish? |
|---|---|---|
| `privacy-policy.html` | Full policy, same styling as the live page — drop-in replacement. Also written to the repo at `/opt/data/trackd/privacy-policy.html` and committed. | Yes, after filling the two `[TODO]` markers and the publish date |
| `privacy-policy.md` | Markdown source of the same policy | Yes, same condition |
| `signup-consent-snippet.html` | Consent block reference markup for the signup form | Repo already implements it (commit `0f4e479`); use the runbook wording fixes on top |
| `consent-and-unsubscribe-runbook.md` | Working unsubscribe path, "Delete my data" procedure, verified Netlify API deletion endpoints, retention sweep, deploy gaps | Yes — operational |
| `compliance-notes.md` | This assessment, data inventory, risk register, platform requirements | N/A |

## E. Blocking actions before publishing (owner)

1. Fill in the controller legal name + physical postal address in the policy, then publish.
2. **Deploy `main`** so the live form carries the consent block, `data-netlify="true"` and the honeypot;
   confirm a real submission stores `beta_consent: on`. *(card t_aea9766e)*
3. Apply the two wording fixes to the consent labels (B4 / runbook part 1).
4. **Set `RESEND_API_KEY` + `SIGNUP_FROM_EMAIL`** in Netlify and redeploy, or the promised confirmation
   email never sends; verify a real install-instructions email arrives.
5. Add Resend's SPF/DKIM records for `deanware.com`.
6. Point the CWS Developer Dashboard privacy-policy field at `/privacy-policy`; align the privacy-practices
   answers with section 1 of the delivered policy.
7. Verify the Netlify DPA is accepted; confirm the OAuth verification / CASA position (B8).
8. Start the retention-sweep reminder and keep the suppression list.
