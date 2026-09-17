# Trackd Test-Group Invite Email

Reusable onboarding email for the 100-person Trackd test group. One placeholder:
`[FirstName]` (drop it and open with "Hi there," if you prefer no personalization).

Owner: @customer-support. Send in plain text, no HTML template needed.

---

## Subject line (recommended)

You're in: here's your Trackd install link

## Alternative subject lines

- Your Trackd test-group invite (install link inside)
- Get Trackd set up in about two minutes
- Trackd early access: your install link

---

## Email body (plain text, paste-ready)

Hi [FirstName],

Thanks for joining the Trackd test group. You are one of 100 people getting early access, and what you report back will shape what this turns into.

Trackd is a Chrome extension that scans your Gmail for subscriptions. There is no bank login and no account to create. You connect your Gmail, it looks for subscription emails, and it shows you what you are paying for.

Two things to check before you install:

1. Open Chrome and make sure you are signed in with the same Google account whose email you signed up with. We whitelisted that exact address for this test group, so a different account will hit a wall.

2. Install Trackd here:
   https://chromewebstore.google.com/detail/lenaajfmejfgdjjdepbcnpakmakcbkgc

Once it is installed, click the Trackd icon in your toolbar and then click "Connect Gmail". Chrome will ask for read-only access to your Gmail. Approve it, and the first scan runs on its own.

The free tier tracks up to 10 subscriptions, which is plenty to see how it works.

This is an early test build, so a rough edge or two is possible. If the "Add to Chrome" button gives you trouble, or the Gmail connect step stalls or sends you back to the same screen, just reply to this email and tell me what you saw. I will sort it out with you directly.

Thanks for helping us test.

[Your name]
Trackd

---

## Notes for whoever sends this

- Keep `[FirstName]` only if you have a real first name from the signup form. Otherwise
  send "Hi there," so nobody gets a broken placeholder.
- Complete the whitelisting steps in `TEST_GROUP_ONBOARDING.md` (GCP test user + Chrome
  Web Store trusted tester) before sending. The email promises access, so the account
  needs to be live first. Test users can take a few minutes to propagate.
- If you send straight from a mail client, the install URL may wrap across two lines. Check
  that it stays clickable before you hit send.
- Writing rules held throughout the email body: no em-dashes, and no "it is not X, it is Y"
  style contrasts. Assertions are stated plainly.

---

## Optional add-on: fallback paragraph (only include if you want it)

Context: the live store build is v1.0.0, which carries a known OAuth-connect bug. v1.0.1 is
built and held pending Google's OAuth client review. Until then a tester can install from the
store and still fail to connect Gmail.

Two ways to handle testers who hit that. Pick one, do not send both.

**Option A, keep the default email as-is.** The existing failure ask ("stalls or sends you
back to the same screen") already catches the symptom, and you resolve the case in the reply
thread. Best if you expect most testers to be fine and want the first email short.

**Option B, add this paragraph** directly after the "Connect Gmail" paragraph, before the free
tier line:

    If the store link will not install for you, or the Gmail connect step keeps failing, reply
    and tell me. I can send you a test build you load directly into Chrome instead, and we will
    get you running that way.

Option B sets the expectation up front and saves a round trip for anyone who needs the local
build. It also risks nudging testers toward the manual path when the store path would have
worked, so only add it if the OAuth review is likely to drag on.