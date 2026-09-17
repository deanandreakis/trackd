# Trackd Test-Group Onboarding Runbook

How to onboard a person who submits their email on the Trackd landing page to the
100-person test group.

**Form in play:** Netlify form `trackd-test-group` on the Trackd landing page.
**Store extension ID:** `lenaajfmejfgdjjdepbcnpakmakcbkgc`
**Install URL (see URL section):** https://chromewebstore.google.com/detail/lenaajfmejfgdjjdepbcnpakmakcbkgc

---

## Step 1 — Watch the Netlify form for new submissions

- Go to Netlify -> your site `trackd-deanware` -> **Forms** -> **trackd-test-group**.
- The list defaults to **Verified submissions**. New signups land here.
- If a signup does not appear: check the **Spam submissions** filter (Akismet sometimes files
  one-off emails there), and confirm form detection is enabled under
  **Forms -> Usage and configuration -> Form detection**.
- Copy the `email` value from each new row.

## Step 2 — Add the email as a Google OAuth test user

- Open the Google Auth Platform audience page:
  https://console.cloud.google.com/auth/audience?project=trackd-507217
- Under **Test users**, click **Add users** and paste the new email address. Save.
- Why: the OAuth consent screen is still in **Testing** mode, so only listed test users can
  complete the Gmail connection. Unlisted accounts get the "access blocked" screen.
- Note: test users can take a few minutes (occasionally longer) to propagate.

## Step 3 — Add the email as a Chrome Web Store trusted tester

- Open the Trackd developer dashboard settings page:
  https://chrome.google.com/webstore/devconsole/dc90590e-3a8c-4127-8cb3-2fd31f9d42cb/settings
- In the **Management** section, add the email address as a **trusted tester** account.
- Why: grants that account access to the (private/test) listing for install.

## Step 4 — Email the user install instructions

- Send the onboarding email (template owned by @customer-support).
- Include: the install URL (below), the note that they must sign in to Chrome with the same
  Google account you whitelisted, and how to connect Gmail inside the extension.
- Ask them to reply if the "Add to Chrome" button or the Gmail connect step gives trouble.

---

## The install URL

Use this exact URL (verified publicly installable; Google's update endpoint returns a valid CRX):

```
https://chromewebstore.google.com/detail/lenaajfmejfgdjjdepbcnpakmakcbkgc
```

Important prerequisites for the URL to work for a tester:
1. They must be signed in to Chrome with the **same Google account** added in Steps 2 and 3.
2. They must be added as a GCP **test user** (step 2) AND a **trusted tester** (step 3).
3. If the listing is private/trusted-tester-only, only whitelisted accounts can open it.

If the extension is publishing as a standard public listing, the URL works for anyone. Current
state: the listing resolves and the package is downloadable from CWS.

---

## Caveat to keep in mind

The **live store build is v1.0.0**, which has the known OAuth-connect issue. v1.0.1 (the fix) is
built and held pending the Google OAuth client Production review. Until 1.0.1 ships, a tester who
installs the public store build may hit the "connect Gmail returns to the same screen" bug.

Until then, if a tester must be able to connect, the fallback is the local keyed test build
(`extension_test/`, Load-Unpacked) rather than the store URL. Once Google approves the OAuth
client and 1.0.1 is live, the store URL is the path for everyone.

---

## Quick checklist per signup

- [ ] Email copied from Netlify Forms -> trackd-test-group
- [ ] Email added to GCP auth platform -> Test users
- [ ] Email added to CWS developer dashboard -> trusted testers
- [ ] Onboarding email sent with install URL + same-account note
- [ ] Tester confirmed install + Gmail connect