# Signup consent copy (canonical, for the frontend team)

Task: **t_791777d5**. Companion to `docs/beta-email-consent-runbook.md` (part 1) and
`docs/consent-live-verification.md`.

**Status: already live.** This copy is what `trackd.deanware.com` serves today (verified against the
served HTML — the live `<form id="signup-form">` contains both labels verbatim). No frontend change is
required; this file is the canonical record so future edits do not drift from the compliance spec.

## The consent block, as deployed (inside `<form … name="trackd-test-group">`)

```html
<div class="signup-consent">
  <label class="signup-consent__row">
    <input type="checkbox" name="beta_consent" id="beta-consent" required />
    <span>Send me the Trackd install instructions and messages about the beta testing group. I have read
    the <a href="/privacy-policy">Privacy Policy</a>.</span>
  </label>
  <label class="signup-consent__row">
    <input type="checkbox" name="marketing_consent" id="marketing-consent" />
    <span>Optional: also send me occasional Trackd product news and tips. You can unsubscribe at any time
    by replying to any email. See the <a href="/privacy-policy">Privacy Policy</a>.</span>
  </label>
</div>
```

## The rules this copy encodes (do not "clean these up" later)

| Rule | Why |
|---|---|
| `beta_consent` is **`required`** and **starts unticked** | Consent must be an affirmative act; a pre-ticked box is invalid (GDPR Recital 32). Required-and-unticked also means the `required` attribute, not a pre-tick, is what blocks submit. |
| `marketing_consent` is **separate and optional** | Bundling a declinable purpose into the non-declinable tick makes marketing consent neither "freely given" nor "specific". |
| The two purposes must not overlap | Required tick = install instructions + beta-testing-group messages. Optional tick = product news/tips. Overlapping wording erodes "specific" consent — do **not** reintroduce "beta updates" in the required tick. |
| Agreement is to **processing**, not to a policy | A privacy policy is *acknowledged as read*, not contracted to. Hence "I have read the Privacy Policy", never "I accept the Privacy Policy". |
| Both labels link `/privacy-policy` | The link must open the published policy; Netlify rewrites `/privacy-policy.html` → `/privacy-policy` in served HTML. |
| Field names/IDs are fixed: `beta_consent`/`beta-consent`, `marketing_consent`/`marketing-consent` | The stored submission records `beta_consent: on` (and `marketing_consent: on` only when ticked) with Netlify's timestamp. That pair **is** the consent evidence trail. Renaming a field breaks the evidence. |
| Never default either field to `on` in the markup, never strip unknown fields from the POST | An unticked checkbox simply omits its key, which is the evidence it was not consented to. |
| Fields must exist in the **built** HTML | Netlify registers fields at deploy time; a field it never saw is silently dropped from the stored row. This is why the block is static markup, not JS-rendered. |

## Optional single-sentence fallback (not currently used)

If a future design drops the checkboxes in favour of one line under the input, this is the wording that
survives review — it still needs a tick or an explicit action to be consent, and it must not merge the two
purposes:

> By entering your email you agree to receive install instructions for the Trackd Chrome extension and
> messages about the beta testing group. We will not send you product news unless you opt in. See our
> [Privacy Policy](/privacy-policy); unsubscribe at any time by replying to any email.

Do **not** ship this without the policy's contact address and an actual unsubscribe path in place: the
"unsubscribe at any time" promise is only true because replies route to `trackd@deanware.com`.

## Verification after any change to this block

Submit a real address on the deployed form and confirm the row in Netlify **Forms → `trackd-test-group`**
shows `beta_consent: on` (and `marketing_consent: on` only when ticked). Read-back helper:

```bash
export NETLIFY_TOKEN=nfp_...
python3 scripts/verify-netlify-forms-consent.py
```

---

*I am an AI compliance bot, not your attorney. Verify critical documents before deployment.*
