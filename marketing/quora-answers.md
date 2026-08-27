# Trackd — Quora Answers (paste-ready)

**Before posting:** Check each question is still open and has <100 answers (otherwise your answer gets buried).

---

## Question 1: "What's the best way to track all my subscriptions?"

Most people underestimate their subscription spend by 2–3x. CNET's 2026 survey found the average US adult wastes $252/year on subscriptions they don't use.

Here's how to find them all, ranked by effort:

**1. Email receipt search (5 minutes, free)**
Search your inbox for "your receipt," "subscription," "renewal confirmed," and "invoice." Nearly every recurring charge sends an email. This catches things bank-linked apps miss (App Store, PayPal, annual SaaS renewals).

**2. Check platform subscription managers directly**
- Apple Settings → Subscriptions
- Google Play → Payments & subscriptions
- PayPal → Automatic payments

These don't appear on your card statement until they charge — and they're the most common leak point.

**3. Bank statement review**
Download 90 days of statements and look for identical monthly amounts. Tedious but thorough.

**Tools comparison:**
- Rocket Money automates discovery but requires full bank access via Plaid — roughly 40% of consumers refuse to give it, and it's US-only.
- Manual trackers (SubTracker, Subnesio, Bobby) are privacy-friendly but you have to enter everything yourself.
- Email-based trackers (KeepMySubs, Track-Subs) work from billing emails without bank access but are web apps you have to remember to visit.

*Disclosure: I'm building Trackd, a Chrome extension that automates the email-receipt scan — read-only Gmail, no bank connection. Take the manual route first; you'll know within one inbox search whether you need a tool.*

---

## Question 2: "Is there a Rocket Money alternative without bank access?"

Yes — several, but they fall into different categories depending on how much effort you want to put in.

**The privacy problem with bank-linked tools:**
Rocket Money, Trim, and most budgeting apps use Plaid to connect to your bank account. In 2022, a federal judge approved a $58M settlement against Plaid for collecting more user data than consumers agreed to share. Roughly 40% of consumers refuse to give bank access at all (Plaid/YouGov 2025). And these tools are US-only — if you're outside the US, they simply don't work.

**Alternatives that don't need bank access:**

**Email-based tools (automatic, private):**
- Track-Subs: web app, reads billing emails, $6.99/mo, global
- KeepMySubs: web+mobile, AI bill parsing from forwarded emails, $6.99/mo
- SubBuddy: Chrome extension, manual review before save, freemium

**Manual trackers (maximum privacy, manual entry):**
- SubTracker: PWA, free unlimited, 130+ pre-loaded service prices
- Subnesio: solo-dev, free 10 subs, $29.99/yr
- Bobby: iOS only, $2.99 one-time

**The DIY route (cheapest, no tool):**
Search your Gmail for receipts. It's manual but catches everything at zero cost.

*Disclosure: I'm building a Chrome extension (Trackd) that automates the Gmail receipt scan — read-only access, no bank connection. But the manual search above will get you 90% of the way immediately.*

---

## Question 3: "How do I find out what subscriptions I'm paying for?"

In one afternoon you can map every recurring charge. Here's the process:

**Step 1: Search your email (20 min)**
In your inbox search bar, enter each of these one at a time:
- "your receipt" — finds most paid subscription confirmations
- "subscription" — casts a wide net
- "renewal" — catches automated renewals
- "invoice" — finds annual/quarterly plans
- "payment to" — finds one-off service charges
- "receipt" — broad catch-all

Take screenshots or copy results into a spreadsheet: service name, price, frequency, next charge date.

**Step 2: Check the usual hiding places (10 min)**
- Apple ID → Subscriptions (Settings → [your name] → Subscriptions)
- Google Play → Payments & subscriptions → Subscriptions
- PayPal → Settings → Payments → Automatic payments
- Your actual credit card / bank statement: look for repeating amounts at the same time each month

**Step 3: Sort by keep / maybe / cancel**
Decision framework:
- "I forgot I had this" = cancel immediately
- "I use it but $X is a lot" = check whether a cheaper plan exists
- "I use it daily and it's worth $X" = keep

**Step 4: Set a reminder to repeat this in 6 months**
Even with tools, subscriptions change. Price hikes, new services, free trials converting. A biannual audit catches most slippage.

**Estimated waste:** CNET/YouGov 2026 found the average US adult is losing $252/year this way. Most people recover $100–200 in the first audit alone.

*Disclosure: I'm building a Chrome extension (Trackd, pre-launch) that automates steps 1 and 2 — read-only Gmail access, no bank login, local-only processing. But the manual method above works right now and costs nothing.*