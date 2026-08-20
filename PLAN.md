# Trackd — Planning Document

> Chrome extension that scans your Gmail to find every subscription you're paying for. No bank login required.

**Status:** Pre-validation (landing page live, waitlist collecting)
**Name:** Trackd (placeholder — can change)
**Last updated:** 2026-08-20

---

## Table of Contents

1. [Problem & Market](#1-problem--market)
2. [Product Concept](#2-product-concept)
3. [Competitive Landscape](#3-competitive-landscape)
4. [Positioning & Messaging](#4-positioning--messaging)
5. [Pricing](#5-pricing)
6. [Customer Channels](#6-customer-channels)
7. [Marketing & Outreach Plan](#7-marketing--outreach-plan)
8. [Validation Scorecard](#8-validation-scorecard)
9. [Technical Approach](#9-technical-approach)
10. [Key Risks](#10-key-risks)
11. [Sources](#11-sources)

---

## 1. Problem & Market

### The problem

People have 12+ active subscriptions and no idea what they're paying for. The average US adult wastes **$252/year** on unused subscriptions — up 24% from last year. That's **$21/month** disappearing to forgotten Netflix, Spotify, gym memberships, and SaaS tools.

Existing tools either:
- Require full bank access via Plaid (Rocket Money, Trim) — which ~40% of consumers refuse to give
- Are web apps you have to remember to visit (Track-Subs)
- Don't exist in the browser where subscriptions are actually managed

**The gap:** A Chrome extension that finds everything from your Gmail inbox — no bank login, no separate dashboard to check.

### Key market evidence

| Metric | Value | Source |
|---|---|---|
| Avg monthly waste on unused subscriptions | **$21/mo ($252/yr)** | CNET/YouGov 2026 |
| Waste increase YoY | **+24%** ($17 → $21) | CNET/YouGov 2025→2026 |
| Millennials waste (worst cohort) | **$29/mo ($348/yr)** | CNET/YouGov 2026 |
| Gen Z waste | **$27/mo ($324/yr)** | CNET/YouGov 2026 |
| Avg total monthly subscription spend | **$111/mo ($1,332/yr)** | CNET/YouGov 2026 |
| YoY spend increase | **+23%** ($90→$111) | CNET/YouGov 2025→2026 |
| Consumers who won't share bank data via Plaid | **~40%** | Plaid/YouGov 2025 |
| Subscription management software market (2026) | **$5.04B** (18.83% CAGR) | Mordor Intelligence |

### Demand signals

- **CNET survey:** $252/yr waste, +24% YoY. Subscription spending at all-time high. FTC click-to-cancel rule blocked by appeals court, making cancellation harder.
- **Plaid privacy backlash:** Plaid faces ongoing scrutiny over screen-scraping (Business Insider, 2025). 40% of consumers won't share financial data. Reddit threads consistently ask for alternatives "without bank login."
- **YouTube search volume:** Videos titled "Rocket Money alternative without bank access" get 10K–100K+ views.
- **Reddit signal density:** r/personalfinance (20M+), r/Frugal (4M+), r/ynab (200K+), r/budgeting (100K+) — daily discussion about forgotten subscriptions.

### What people do instead (substitutes)

| Approach | Prevalence | Why they'd switch |
|---|---|---|
| Manual credit card statement review | High | Time-consuming, easy to miss small charges |
| Apple App Store / Google Play subscription manager | Medium | Only catches in-app purchases, not SaaS or streaming |
| Spreadsheet tracking | Medium | Requires discipline to maintain |
| Rocket Money / Plaid-linked apps | High (among tracking-app users) | Privacy concerns, US-only, requires bank credentials |
| Doing nothing | High | Losing actual money ($21/mo avg) |

---

## 2. Product Concept

### One-sentence pitch

> A Chrome extension that finds all your subscriptions by scanning your Gmail — no bank login required.

### How it works

1. **Install the Chrome extension** — one click from Chrome Web Store.
2. **Grant read-only Gmail access** — scan inbox for receipts, renewal notices, free trial confirmations. Never reads personal emails.
3. **See all subscriptions in one dashboard** — name, price, renewal date, status. Cancel what you don't need.

### Core features

| Feature | Free tier | Pro tier |
|---|---|---|
| Subscription detection from Gmail | ✅ Up to 10 subs | ✅ Unlimited |
| Dashboard (name, price, renewal date) | ✅ | ✅ |
| Scan cadence | Monthly | Weekly |
| Free trial alerts (before they convert) | ✅ 30-day reminders | ✅ |
| Cancellation guides | ❌ | ✅ |
| CSV export | ❌ | ✅ |
| Multi-currency support | ✅ | ✅ |

### Key differentiators

1. **No Plaid, no bank credentials** — read-only Gmail access only
2. **Works globally** — not US-only like Rocket Money
3. **Privacy-first** — local processing where possible, no data selling
4. **Multi-currency** — many users have subscriptions in different currencies
5. **Chrome extension** — lives in your browser, not a web app you have to remember to visit

---

## 3. Competitive Landscape

### Bank-linked incumbents

| Competitor | Pricing | Phase | Key limitation |
|---|---|---|---|
| **Rocket Money** | Free / $3–12/mo sliding | Dominant (10M+ users) | Requires Plaid bank login. US-only. |
| **Trim** | Free / paid tiers | Smaller | Same Plaid dependency. |
| **Hiatus / PocketGuard** | Freemium | Budgeting apps with sub detection as feature | Not primary product. |

### Email-based competitors (direct substitutes)

| Competitor | Pricing | Phase | Assessment |
|---|---|---|---|
| **Track-Subs** | Free (10 subs, 1 scan/mo) / $6.99/mo or $59.99/yr | Live, most mature email competitor | **Closest competitor.** Web app (not extension). Two-layer AI detection, multi-currency, global. Explicitly positions "no Plaid." Most mature product with real testimonials. |
| **SubBuddy** | Freemium (signup required) | Early (v1.5.2, Jul 2026) | Chrome extension. Gmail + Outlook. Manual review before save. Privacy-first positioning. Spanish developer. |
| **SaaS Subscription Tracker** | Free (10 subs) / $3/mo or $25/yr | Very early (v1.0.1, Jun 2026) | Chrome extension. Runs locally in browser. 5 ratings, solo dev. Minimal marketing. |
| **Bobby** | $2.99 one-time (iOS only) | Live | Manual entry only. No auto-scan. Mobile-only. |

### Key competitive insight

The **email-only × Chrome extension intersection is unowned.** Track-Subs is the closest competitor but it's a web app, not an extension. A polished Chrome extension could win on:
- **Convenience** — always in the browser, no separate app to remember
- **Privacy** — local processing, no cloud account needed
- **Global reach** — Rocket Money is US-only, we work anywhere Gmail works

### Porter's Five Forces

| Force | Assessment | Notes |
|---|---|---|
| Threat of new entrants | Moderate | Low technical barrier (Gmail API + email parsing). High distribution barrier. |
| Bargaining power of buyers | High | Zero switching cost. Free alternatives exist. |
| Threat of substitutes | High | Credit card review, spreadsheets, doing nothing. |
| Bargaining power of suppliers | Low | Gmail API free within rate limits. Chrome Web Store free. |
| Competitive rivalry | Moderate | Fragmented. Rocket Money dominates bank-linked but different positioning. Track-Subs closest email competitor — also early. |

---

## 4. Positioning & Messaging

### Core positioning

> "The subscription tracker that works without your bank. Just your email."

### Taglines / headlines

| Context | Line |
|---|---|
| Landing page hero | **Find every subscription you're paying for. Without connecting your bank.** |
| Reddit / DM opener | *"The average American wastes $252/year on unused subs. I'm building a tool that finds them from your Gmail — no bank login needed."* |
| Privacy angle | *"No Plaid. No bank credentials. Just read-only Gmail access."* |
| Global angle | *"Works everywhere your email does — not US-only like Rocket Money."* |

### Key stat to lead with

> **$252/yr** wasted per US adult on unused subscriptions (CNET/YouGov 2026)

This stat:
- Is specific and sourced
- Makes the problem concrete ("that's $21/mo")
- Creates a "wait, am I that average?" reaction
- Has authority (CNET)
- Is getting worse (+24% YoY)

### Messaging hierarchy

1. **Hook** — $252/yr waste stat
2. **Problem** — You're paying for subscriptions you forgot about
3. **Solution** — Chrome extension that scans Gmail, no bank login
4. **Differentiator** — Privacy-first, works globally, lives in your browser
5. **Social proof** — CNET stat, Plaid survey (40% won't share data)

---

## 5. Pricing

### Market pricing landscape

| Product | Free Tier | Paid Tier | Annual Option |
|---|---|---|---|
| Rocket Money | Basic tracking + cancellation | $3–12/mo (pay-what-you-want) | No |
| Track-Subs | 10 subs, 1 scan/mo | $6.99/mo | $59.99/yr |
| SaaS Subscription Tracker | 10 subs, 30-day reminders | $3/mo | $25/yr |
| SubBuddy | Freemium (signup required) | Unknown | Unknown |
| Bobby (iOS) | — | $2.99 one-time | N/A |

### Proposed pricing

| Tier | Price | Features |
|---|---|---|
| **Free** | $0 | 10 subscriptions tracked, monthly scan, free trial alerts |
| **Pro** | **$3.99/mo or $29.99/yr** | Unlimited subs, weekly scans, CSV export, cancellation guides |

**Rationale:** Positions at the low end of the accepted $3–7/mo band. $3.99 undercuts Track-Subs ($6.99) while matching SaaS Subscription Tracker's value perception. Annual at $29.99 = ~$2.50/mo effective.

### Competitive pricing comparison (monthly)

```
Rocket Money      ───── $3–12/mo  (pay-what-you-want)
Track-Subs        ───── $6.99/mo
SaaS Sub Tracker  ───── $3.00/mo
Trackd (proposed) ───── $3.99/mo  ← we are here
```

---

## 6. Customer Channels

### Reddit (primary)

| Subreddit | Members | Why it works |
|---|---|---|
| r/personalfinance | 20M+ | Daily posts about forgotten subscriptions |
| r/Frugal | 4M+ | Actively cutting costs, canceling unused subs |
| r/ynab | 200K+ | Budgeting users frustrated with subscription creep |
| r/budgeting | 100K+ | Same — actively managing money |
| r/macapps | 400K+ | Subscription tracker threads get high engagement |
| r/SideProject | 2M+ | "Validating an idea" posts |
| r/SomebodyMakeThis | 100K+ | Literally built for idea validation |
| r/privacy | 1.5M+ | Privacy angle, Plaid alternatives |
| r/adhdwomen | 1M+ | ADHD tax / forgotten subscription overlap |
| r/GoogleGeminiAI | — | Recent high-pain thread ($1,950 autopay charge) |

### Secondary channels

| Channel | Why |
|---|---|
| **Product Hunt** | Subscription tracker category does well; privacy angle gets traction |
| **Hacker News** | "Show HN: privacy-first alternative" trends consistently |
| **Twitter/X** | Real-time pain signals: "just realized I'm paying for..." |
| **YouTube comments** | Videos asking for Rocket Money alternatives — high-intent audience |
| **Chrome Web Store SEO** | "subscription tracker," "gmail subscription scanner," "find forgotten subscriptions" |

### Direct outreach targets

- People who comment on Rocket Money, Truebill, or subscription cost threads — actively searching for a solution
- Track-Subs users complaining about missing features (they want an extension, not a web app)
- People searching "Rocket Money alternative without bank access" on Google, YouTube, Reddit
- Product Hunt comment sections of Rocket Money / Truebill / Bobby — complaints about bank access

---

## 7. Marketing & Outreach Plan

### Week 1: Community listening (done — mixed results)

**What was executed:**
- 7 Reddit threads commented on (r/Frugal × 3, r/GoogleGeminiAI, r/GrowthHacking, r/adhdwomen, r/marvelcomics)
- **Result:** 0 responses on old threads. 1 meaningful conversation on r/GrowthHacking with u/Jeeennss (Untilly founder).

**Lesson learned:** Comments on existing threads have low ROI. Most threads were cold by the time we posted. Even fresh threads are noisy. Shift to DMs and original posts.

### Week 2: Direct DMs + original posts

**Action 1** — DM the people who already expressed pain (today, ~30 min)

Three active targets identified:

1. **u/infiunfi** (r/GoogleGeminiAI) — Got charged $1,950 for forgetting to cancel Gemini autopay. Huge pain, very recent.
   > *"Saw your post about the $1,950 Gemini charge — glad the refund came through. That exact scenario is why I'm building a Chrome extension that catches forgotten subscriptions from Gmail before they renew. Would you be open to 3 quick questions about how you manage subscriptions now?"*

2. **u/NomadicSlave** (r/amex) — Literally posted hours ago "completely forgot to cancel" Peacock/Apple TV bundle.
   > *"Saw your thread about the Peacock bundle — the 'completely forgot to cancel' thing is so relatable. I'm working on a tool that catches these from Gmail before they hit your card. Mind if I ask you 3 quick questions?"*

3. **u/Jeeennss** (r/GrowthHacking) — Already have rapport. Learn from their launch experience.
   > *"Hey — appreciate the convo on the GrowthHacking thread. I'm curious — when you were building Untilly, did you talk to users before launching? I'm trying to decide if I should build this thing or validate first. Would love to hear your experience."*

**Action 2** — Post your own validation thread (~15 min each)

Post to:
- **r/SomebodyMakeThis** — "A Chrome extension that finds every subscription you're paying for. No bank login, just Gmail."
- **r/SideProject** — "I built a landing page before writing any code — am I doing this right?"
- **r/privacy** — "How do you feel about Plaid-style bank access? I'm building a read-only Gmail alternative."

**Action 3** — Twitter/X search & reply (~20 min)

Search: `"just realized I'm paying for" OR "forgot to cancel" OR "subscription I don't use"`
Find 10 recent posts. Reply with the stat + early access offer.

### Week 3: Land the landing page + secondary channels

**Landing page** — `index.html` in this repo. Currently live at [NEED URL].

Post it to:
- r/SideProject (as "validating an idea," not a launch)
- r/macapps
- r/personalfinance (if rules allow)

Also:
- Product Hunt comment sections of Rocket Money / Truebill / Bobby
- YouTube comments on "Rocket Money alternative" videos
- Google blog posts / Medium articles about Rocket Money alternatives

### DM Scripts

**Template A — Privacy concerns / "I don't want to give bank access"**
> *"Saw your comment about subscription tracking. I'm looking into building a privacy-first option that works through Gmail instead — read-only, no bank login, no Plaid. Would you be open to a quick 3-question chat about what you actually need?"*

**Template B — "I keep forgetting to cancel things"**
> *"Saw your comment — the forgetting-to-cancel thing is so relatable. I'm exploring building a Chrome extension that auto-detects subscriptions from your Gmail so you never miss one. Mind if I ask you 3 quick questions?"*

**Template C — Landing page referral**
> *"Hey — saw your comment about [subscriptions / forgetting to cancel]. I threw together a landing page for what I'm building — a Chrome extension that finds forgotten subscriptions from Gmail without bank access. Would this solve your problem? [link]"*

---

## 8. Validation Scorecard

| Metric | Target | Current | Notes |
|---|---|---|---|
| DM conversations started | 15+ | 0 | Reddit comments didn't convert. Need to DM directly. |
| Conversations completed | 5 | 1 (r/GrowthHacking) | Mostly peer chat, not validation interview. |
| People describing the same pain unprompted | 3+ | 0 | No unprompted pain in replies. |
| Waitlist signups | 20+ | 0 | Landing page just created, no backend yet. |
| People saying "I'd pay $10/mo" | 5+ | 0 | Not yet asked. |
| People who actually joined a beta | 5+ | 0 | No beta to join yet. |

**Decision rules:**
- **All 6 targets hit** → build the Chrome extension
- **3–4 targets hit** → keep validating, refine messaging
- **< 3 targets hit** → seriously consider switching to Idea #3 (freelance client communication trail)

**Current assessment:** 0 of 6 targets hit. The Week 1 approach (commenting on old threads) was ineffective. Week 2 pivot to DMs + original posts should produce better signal.

---

## 9. Technical Approach

### Chrome extension stack

| Layer | Technology | Notes |
|---|---|---|
| Extension framework | Manifest V3 | Chrome Web Store requirement |
| Email access | Gmail API (read-only scope) | OAuth2, user consent |
| Subscription detection | Email parsing + merchant matching | Regex patterns for receipt templates, known merchant list |
| Data storage | Local (chrome.storage.local or IndexedDB) | Privacy-first, no cloud storage |
| Sync across devices | Optional (if user creates account) | Later concern |
| AI layer | Optional (LLM for ambiguous emails) | Later concern — Track-Subs has this |

### MVP scope

- Gmail OAuth (read-only, billing-related emails only)
- Detect 20–30 major subscription merchants (Netflix, Spotify, Adobe, etc.) via receipt pattern matching
- Display detected subscriptions in a popup dashboard
- Manual add/categorize for missed subscriptions
- Free trial alert (detect "free trial" language, set reminder before conversion date)
- No cloud account required
- ~200 KB extension size

### Nice-to-have (post-launch)

- Cancellation guides / one-click cancel links
- AI-based detection for non-standard merchant emails
- CSV export
- Multi-account / Outlook support
- Cloud sync (optional account)

### Gmail API policy considerations

- Requires read-only scope (no send/delete)
- Must have privacy policy
- Must limit data use to the extension's stated purpose
- Must allow user to revoke access
- Current policy allows this, but Google could tighten restrictions on email scanning extensions

---

## 10. Key Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Rocket Money builds email-scanning feature | Low | High | Unlikely soon — their model is Plaid/bank aggregation. Unlikely to pivot. |
| Track-Subs or SubBuddy captures the niche first | Medium | High | Track-Subs is live with more complete product. They could wrap as extension. Differentiate on polish + privacy. |
| Low conversion from free to paid | Medium | High | Free tier limits discovered. SaaS Sub Tracker has 5 ratings vs Rocket Money's 200K+. Need strong paid hook. |
| Gmail API policy changes | Low | Critical | Google could restrict email scanning. Currently allowed with user consent. Monitor policy changes. |
| Churn (users clean subs then leave) | Medium | Medium | Subscription fatigue applies to tracking tool itself. Mitigate with ongoing alerts + new sub detection. |
| Landing page gets 0 signups | Medium | High | Currently 0 signups. Need to drive targeted traffic. If <20 after 1 week, reconsider messaging or idea. |

---

## 11. Sources

- CNET/YouGov Subscription Survey 2026 (n=2,522 US adults, May 2026) — cnet.com
- Mordor Intelligence Subscription Management Software Market Report (2026) — mordorintelligence.com
- Plaid/YouGov Money Talks Consumer Survey 2025 (n=2,000+ consumers) — plaid.com
- SaaS Subscription Tracker Chrome Web Store listing — chromewebstore.google.com
- SubBuddy Chrome Web Store listing — chromewebstore.google.com
- Track-Subs website — track-subs.com
- Rocket Money pricing page — rocketmoney.com
- Business Insider (2025) — Plaid screen-scraping scrutiny
- CNET Rocket Money review (2025) — cnet.com
- r/personalfinance, r/Frugal, r/ynab, r/budgeting, r/macapps, r/SideProject, r/adhdwomen — Reddit thread analysis

---

## Appendix: Idea #3 (Freelance Client Communication Trail)

Kept as a fallback if subscription tracker doesn't validate.

**Pitch:** A Chrome extension that automatically records every client approval, revision request, and scope decision — so you can prove what was agreed.

**Why it might work better:**
- Authenticity — you've lost money to scope creep
- Acute pain — single $2–5K losses vs $21/mo drip
- Tight communities — r/freelance (1M+), active Slack/Discord

**Validation threshold:** 20+ freelancer waitlist signups before building.

---

*Built from research on 2026-08-14. Updated with validation results 2026-08-20.*