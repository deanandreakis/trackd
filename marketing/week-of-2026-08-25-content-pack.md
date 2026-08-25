# Trackd — Weekly Content Pack (week of 2026-08-25)

**How to use:** Every draft below is paste-ready with its tracking link already baked in. Log what you post in §7 so we can update the scorecard.

**Landing page note:** I couldn't verify your live URL from the repo — replace `https://trackd-deanware.netlify.app` everywhere with your real Netlify URL.

---

## 1. X / Twitter — search & reply (~20 min)

Run these searches while logged in (paste into X's search bar):

```
"forgot to cancel" subscription -filter:replies  min_faves:1
"just realized I've been paying" min_faves:1
"rocket money alternative" -filter:replies
"how do i find all my subscriptions"
"free trial charged me" min_faves:1
```

Sort by Latest. Pick **10 posts from the last 3 days** with any engagement (replies to dead posts are wasted effort).

### Reply drafts by scenario

**Scenario A — generic complaint about a forgotten subscription:**
> The average person wastes $252/yr on subs they forgot about (CNET's number, not mine). I'm building a Chrome extension that finds them all from your Gmail receipts — no bank login needed. Might be useful when it ships: https://trackd-deanware.netlify.app/?utm_source=x&utm_campaign=w34

**Scenario B — someone asks for a Rocket Money alternative:**
> Rocket Money needs full bank access via Plaid, which ~40% of people refuse to give. There's another way: scanning your email receipts instead. I'm building exactly that as a Chrome extension — read-only Gmail, nothing else: https://trackd-deanware.netlify.app/?utm_source=x&utm_campaign=w34

**Scenario C — got charged after forgetting a free trial:**
> This exact pain is why I'm building Trackd — it reads your Gmail for trial signups and alerts you *before* they convert to paid. No bank login required. Waitlist here if useful: https://trackd-deanware.netlify.app/?utm_source=x&utm_campaign=w34

**Scenario D — "how do I even find everything I'm subscribed to":**
> Trick most people miss: search your inbox for receipts ("your receipt", "subscription", "renewal"). I'm building a tool that automates exactly that scan — free Chrome extension, Gmail-only: https://trackd-deanware.netlify.app/?utm_source=x&utm_campaign=w34

**Tone rules:** never post the same reply twice verbatim (spam detection); drop the link on posts that look ban-sensitive and just ask "DM me if you want the waitlist link."

---

## 2. YouTube (~15 min)

Search these URLs (sorted by upload date), open videos <30 days old with views >1K:

- https://www.youtube.com/results?search_query=rocket+money+alternative&sp=CAI%253D
- https://www.youtube.com/results?search_query=forgotten+subscriptions&sp=CAI%253D
- https://www.youtube.com/results?search_query=stop+wasting+money+subscriptions&sp=CAI%253D

**Comment drafts:**

> Honest question — has anyone found one that doesn't require handing over bank credentials? Everything I've seen wants Plaid access. I'm actually building a Chrome extension that finds subscriptions from Gmail receipts instead, no bank login at all.

> The crazy part is most of this waste is invisible because charges hide across App Store, PayPal, and card statements. I'm working on a tool that pulls it all from email receipts — happy to share the waitlist if anyone wants in.

**Note:** comments with links often get auto-flagged as spam. Post without the link first; edit the link in 10 minutes later, or put the landing page in your channel profile/bio and reference "link in my profile." After posting, check each comment logged-out to confirm it's visible.

---

## 3. Quora (~15 min) — Phase 2 kickoff

Answer existing questions. Search:
- https://www.quora.com/search?q=best%20way%20to%20track%20subscriptions
- https://www.quora.com/search?q=rocket%20money%20alternative%20without%20bank
- https://www.quora.com/search?q=find%20all%20my%20subscriptions

**Full answer draft (works for all three question types):**

> Most people underestimate their subscription spend by 2–3x. CNET's 2026 survey found the average US adult wastes $252/year on subscriptions they don't use.
>
> Here's how to find them all, ranked by effort:
>
> 1. **Email receipt search (5 minutes, free):** Search your inbox for "your receipt," "subscription," "renewal confirmed," and "invoice." Nearly every recurring charge sends an email. This catches things bank-linked apps miss (App Store, PayPal, annual SaaS renewals).
>
> 2. **Check platform subscription managers directly:** Apple Settings → Subscriptions; Google Play → Payments & subscriptions; PayPal → Automatic payments. These don't appear on your card statement until they charge.
>
> 3. **Bank statement review:** Download 90 days of statements and look for identical monthly amounts. Tedious but thorough.
>
> Tools: Rocket Money automates discovery but requires full bank access via Plaid — which roughly 40% of consumers refuse to give, and it's US-only. If you're privacy-conscious or outside the US, the email-search approach above gets you ~90% of the way manually.
>
> Disclosure: this pain point is why I'm building Trackd, a Chrome extension that automates the email-receipt scan — read-only Gmail access, no bank connection. Take the manual route first; you'll know within one inbox search whether you need a tool.

The disclosure line matters — Quora collapses promotional answers without them, and honest disclosure builds credibility.

---

## 4. Indie Hackers validation post (Phase 2, ~30 min) — highest leverage this week

Post to indiehackers.com under **#validation** or **#share-your-product**. Full draft:

---

**Title:** I built a landing page to validate a Chrome extension idea. 0 signups in week 1 — roast my funnel.

I'm validating Trackd: a Chrome extension that scans your Gmail for every subscription you're paying for — no bank login required.

**Why I think the problem is real:**
- CNET/YouGov 2026: average US adult wastes **$252/year** on unused subscriptions, up 24% YoY
- ~40% of consumers refuse to give banks access via Plaid (Plaid/YouGov 2025)
- Rocket Money — the category leader — requires exactly that, and is US-only

**Why I think the gap is real:**
The closest competitor (Track-Subs) does email-based detection but as a web app. Nobody owns the *email-scan × Chrome extension* intersection yet. Extensions live where subscriptions get managed — the browser.

**Pricing plan:** Free tier (10 subs, monthly scan) / Pro at $3.99/mo or $29.99/yr — deliberately under Track-Subs' $6.99.

**What I did last week:** replied to ~20 people on X and YouTube expressing this exact pain, with the landing page linked.

**Result: 0 waitlist signups.**

So — founders of IH — where's the break?

1. Wrong audience? Are people complaining about forgotten subs actually looking for tools?
2. Weak hook? Is "$252/yr wasted" not compelling enough?
3. Trust gap? Would you grant a random extension read-only Gmail access?
4. Wrong channel entirely?

Roast away. Landing page: https://trackd-deanware.netlify.app/?utm_source=indiehackers&utm_campaign=w34 — What would make you sign up — or what makes this a "nice idea, would never install"?

---

**Why this framing works:** leading with 0 signups and asking for a roast invites the engagement IH rewards; questions #3 (Gmail trust) is the objection you *need* answered before writing code.

---

## 5. Directory listings (prep now, submit after IH feedback)

### AlternativeTo
List as alternative to: **Rocket Money, Trim, Bobby, Track-Subs**

> **Trackd** — Find every subscription you're paying for, straight from your Gmail. A Chrome extension that scans email receipts and renewal notices to build a complete subscription dashboard: name, price, renewal date, status. Unlike bank-linked trackers (Rocket Money, Trim), Trackd needs no Plaid connection, works worldwide, supports multiple currencies, and keeps data on your device. Free trial alerts warn you before trials convert to paid.

### SaaSHub blurb

> Trackd is a privacy-first Chrome extension that discovers all your subscriptions from Gmail receipts — no bank login, no Plaid, no cloud account. Free tier tracks 10 subscriptions with monthly scans; Pro ($3.99/mo) adds unlimited tracking, weekly scans, CSV export, and cancellation guides.

Both directories require account creation + form submission — copy/paste job, ~15 min total.

---

## 6. UTM link scheme (set up once, use everywhere)

| Channel | Link |
|---|---|
| X replies | `https://trackd-deanware.netlify.app/?utm_source=x&utm_campaign=w34` |
| YouTube comments | `https://trackd-deanware.netlify.app/?utm_source=youtube&utm_campaign=w34` |
| Quora answers | `https://trackd-deanware.netlify.app/?utm_source=quora&utm_campaign=w34` |
| Indie Hackers | `https://trackd-deanware.netlify.app/?utm_source=indiehackers&utm_campaign=w34` |

This is how we'll tell "nobody clicked" apart from "clicked but didn't convert" next week. If you add analytics later, these tags carry through automatically.

---

## 7. Execution log (fill in as you go)

| Date | Channel | Where / link | Posted? | Visible logged-out? |
|---|---|---|---|---|
| 2026-08-24/25 | X | pain-post replies | ✅ Posted | check incognito |
| 2026-08-24/25 | YT | video comments | ✅ Posted | check incognito |
| | Quora | | | |
| 2026-08-25 | IH | validation thread ("roast my funnel") | ✅ Posted | n/a |
| 2026-08-26 | IH | 2 likes, 1 comment (aryan_sinh: Gmail-trust = main barrier?) | ✅ Engaged | n/a |
| | AltTo | | | |
| | SaaSHub | | | |
