# Trackd — Planning Document

> Chrome extension that scans your Gmail to find every subscription you're paying for. No bank login required.

**Status:** Pre-validation (landing page live, waitlist collecting)
**Name:** Trackd (placeholder — can change)
**Last updated:** 2026-08-25

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
- **High pain awareness:** Personal finance communities, frugal living forums, and comment sections on subscription-related content — daily discussion about forgotten subscriptions. Twitter/X and Facebook Groups show the same signal density.

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
| **KeepMySubs** | Free (10 subs, AI parse 25/day) / $6.99/mo or $69.99/yr | Live — **most serious email-automation threat** | Web app + iOS/Android. Automated from billing emails: AI bill parsing (paste/PDF), mailbox forwarding import on Pro, price-hike alerts, testimonials. Also ships an MCP server + CLI for AI agents (2026). Not a Chrome extension; uses a forwarding address rather than direct Gmail OAuth. |
| **SubTracker** (subtracker.io) | Free (unlimited subs, manual entry) / Plus $5.90/mo / Family $9.90/mo | Live, strong SEO play | PWA/web + mobile. Manual entry with 130+ pre-loaded services & prices. NOT automatic scanning. Swiss GmbH, GDPR positioning, heavy /best/ content hub targeting "subscription tracker" searches. Shows manual trackers are commoditized — differentiation must come from automation. |
| **Subnesio** | Free (10 subs) / $29.99/yr / $59 lifetime | Early, solo dev | Web app. Manual entry only — markets "no email scraping" as a privacy feature. Telegram + calendar reminders. Signals that some privacy-minded users distrust inbox access — a messaging risk to manage. |
| **SubBuddy** | Freemium (signup required) | Early (v1.5.2, Jul 2026) | Chrome extension. Gmail + Outlook. Manual review before save. Privacy-first positioning. Spanish developer. |
| **SaaS Subscription Tracker** | Free (10 subs) / $3/mo or $25/yr | Very early (v1.0.1, Jun 2026) | Chrome extension. Runs locally in browser. 5 ratings, solo dev. Minimal marketing. |
| **Bobby** | $2.99 one-time (iOS only) | Live | Manual entry only. No auto-scan. Mobile-only. |

### Key competitive insight

The landscape is more crowded than initially mapped (updated 2026-08-25):

- **Manual-entry trackers are commoditized** — SubTracker gives unlimited subs free, Subnesio/Bobby are cheap. A manually-populated dashboard alone is not a product.
- **Email automation is owned at the web-app level** — Track-Subs and KeepMySubs both do it at ~$6.99/mo. KeepMySubs is effectively "Trackd's positioning as a web app" and is further along.
- **The email-scan × Chrome extension intersection remains unowned** — nobody in the set ships a browser extension that reads Gmail directly. That is still the wedge.
- **Pricing validation:** two independent competitors landed at $6.99/mo; our proposed $3.99 undercuts the whole email-automation field.
- **Messaging risk discovered:** Subnesio sells "no email scraping" as a feature — meaning inbox-access trust objections are real and must be answered head-on (local processing, read-only scope, revoke anytime).

A polished Chrome extension could win on:
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
| Competitive rivalry | Higher than first mapped | Fragmented but converging. Rocket Money dominates bank-linked. Email-automation has two live players (~$6.99/mo); manual trackers are commoditized. Extension wedge still open. |

---

## 4. Positioning & Messaging

### Core positioning

> "The subscription tracker that works without your bank. Just your email."

### Taglines / headlines

| Context | Line |
|---|---|
| Landing page hero | **Find every subscription you're paying for. Without connecting your bank.** |
| Social / DM opener | *"The average American wastes $252/year on unused subs. I'm building a tool that finds them from your Gmail — no bank login needed."* |
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

### Primary channels

| Channel | Why |
|---|---|
| **Twitter/X** | Real-time pain signals: "just realized I'm paying for..." High-intent audience. Easy to reply to existing threads. |
| **Indie Hackers** | Built for early-stage validation. Narrative-driven, supportive community. Good for building audience pre-launch. |
| **Hacker News (Show HN)** | Technical/privacy angle resonates. "Show HN: privacy-first alternative" gets traction. 10K-50K visits on front page. |
| **Product Hunt** | Launch-day spike (1K-3K upvotes, 5K-20K installs). Diminishing returns — best after some traction, not first. |
| **Chrome Web Store SEO** | Long-term organic channel. Optimize title, description, screenshots. Most installs come from CWS search. |

### Community & forum channels

| Channel | Why |
|---|---|
| **Facebook Groups** | Personal finance & frugal living groups (millions of members). Active, engaged communities. Search for "subscription tracking," "frugal living," "budgeting" groups. |
| **Indie Hackers forum** | Post build-in-public updates. Engage with other founders. Good for early validation and feedback. |
| **Quora** | Answer questions about forgotten subscriptions / Rocket Money alternatives. Long-tail SEO value. |
| **Dev.to** | Write tutorials: "How I built a Gmail subscription scanner" — dev audience + SEO. |
| **LinkedIn** | Build-in-public posts about the journey. Connect with personal finance creators. |

### Outreach & directory channels

| Channel | Why |
|---|---|
| **AlternativeTo** | List Trackd as an alternative to Rocket Money / Track-Subs. High-intent traffic from people actively switching. |
| **SaaSHub** | High-authority directory for SaaS tools. SEO backlinks + referral traffic. |
| **YouTube comments** | Videos asking for Rocket Money alternatives. Reply with the stat + waitlist link. |
| **YouTube (own content)** | Short video showing the extension scanning Gmail. "No bank login" angle works well for discovery. |

### Direct outreach targets

- People who comment on Rocket Money, Track-Subs, or Bobby — active dissatisfaction, looking for alternatives
- Track-Subs users complaining about missing features (they want an extension, not a web app)
- People searching "Rocket Money alternative without bank access" on Google, YouTube
- Product Hunt comment sections of Rocket Money / Truebill / Bobby — complaints about bank access
- Twitter/X: search `"just realized I'm paying for" OR "forgot to cancel" OR "Rocket Money alternative"`

---

## 7. Marketing & Outreach Plan

### Phase 1: Social search & reply (now — this week)

The highest-leverage action right now is replying to people already expressing pain. No account-age gate, no filter issues.

**Action 1** — Twitter/X search & reply (~20 min)

Search queries:
- `"just realized I'm paying for" OR "forgot to cancel"`
- `"Rocket Money alternative" OR "subscription tracker"`
- `"need to cancel" subscription`

Find 10 recent posts. Reply with the pain stat + waitlist link. Don't pitch — offer the solution.

*Example reply:*
> *"The average person wastes $252/yr on forgotten subs. I'm building a Chrome extension that finds them from Gmail receipts — no bank login needed. Might help: [link]"*

**Action 3** — YouTube comment replies (~15 min)

Search for "Rocket Money alternative" or "forgotten subscriptions" on YouTube. Find recent videos (last month). Reply with: "If you're looking for something that doesn't need bank access, I'm building a Chrome extension that works from Gmail. [link]"

### Phase 2: Indie Hackers + community posts (next week)

**Indie Hackers** — Post a narrative thread:
- "I built a landing page to validate a Chrome extension idea. Here's what happened."
- Share the stats, the privacy angle, the waitlist count
- Ask for feedback on positioning and pricing
- Indie Hackers audience is founders, many will sign up for the waitlist

**Facebook Groups** — Join and engage in:
- Personal finance groups ("Subscriptions" is a frequent topic)
- Frugal living groups
- Privacy / security groups

Post format: "Question for the group — does anyone use a subscription tracker? I'm building one that works from Gmail without bank access, curious what you all use."

**Quora** — Answer questions:
- "What's the best way to track all my subscriptions?"
- "Is there a Rocket Money alternative without bank access?"
- "How do I find out what subscriptions I'm paying for?"

### Phase 3: Directory listing + CWS prep (before launch)

**Directories to list on:**
1. **AlternativeTo** — List as alternative to Rocket Money, Track-Subs, Bobby
2. **SaaSHub** — High-authority SaaS directory
3. **Chrome Web Store** — Only after build is complete. SEO-optimize title, description, screenshots

**Content marketing (long-term):**
- Write a Dev.to post: "How I built a Gmail subscription scanner as a Chrome extension"
- Write a LinkedIn post: "The $252/yr problem most people don't know they have"

### Outreach scripts

**Twitter/X reply template:**
> *"$252/yr wasted on forgotten subs is the stat that got me. Building a Chrome extension that catches them from Gmail — no bank login, no Plaid. [link]"*

**YouTube comment template:**
> *"If you want a privacy-first option, I'm building a Chrome extension that works from Gmail alone — no bank credentials needed. Might be worth checking out: [link]"*

**Facebook group post template:**
> *"Quick question for the group — anyone here use a subscription tracker? I keep forgetting what I'm paying for. I'm looking at options that don't need bank access (privacy thing). What do you all use?"*

**Indie Hackers post template:**
> *"I'm validating a Chrome extension idea: scan Gmail for forgotten subscriptions, no bank login. Landing page is live. 0 signups so far — trying to figure out if I'm solving the wrong problem or just not reaching the right people. Thoughts?"*

---

## 8. Validation Scorecard

| Metric | Target | Current | Notes |
|---|---|---|---|
| Twitter/X engagements (replies to pain posts) | 10+ | Done 2026-08-24/25, awaiting engagement data | Replies posted; check impressions + whether links carried UTM tags. |
| Indie Hackers discussion engagement | 10+ replies | 2 likes, 1 substantive comment (2026-08-25) | First comment flags Gmail-trust as probable main conversion barrier — matches hypothesis #3. Reply + keep thread alive. |
| Waitlist signups | 20+ | 0 | Landing page + Netlify Forms live. |
| People saying "I'd pay $X/mo" | 5+ | 0 | Not yet asked. |
| People who actually joined a beta | 5+ | 0 | No beta to join yet. |
| Facebook group comments / DMs | 5+ conversations | 0 | Join and engage in personal finance groups. |

**Decision rules:**
- **4+ targets hit** → build the Chrome extension
- **2–3 targets hit** → keep validating, refine messaging
- **< 2 targets hit** → seriously consider switching to Idea #3 (freelance client communication trail)

**Current assessment:** Phase 1 (Now) executed on Twitter/X and YouTube; Bluesky skipped by choice. Scorecard now tracks 6 targets. Initial Reddit approach was blocked by new-account posting restrictions.

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
| Track-Subs / KeepMySubs / SubBuddy capture the niche first | **High** | High | KeepMySubs already does automated email detection as web+mobile with agent integrations. They could ship an extension. Differentiate on extension-native UX, local-only processing, and price ($3.99 vs $6.99). Speed matters more than before. |
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
- KeepMySubs website — keepmysubs.com (reviewed 2026-08-25)
- SubTracker website — subtracker.io (reviewed 2026-08-25)
- Subnesio website — subnesio.one (reviewed 2026-08-25)
- Rocket Money pricing page — rocketmoney.com
- Business Insider (2025) — Plaid screen-scraping scrutiny
- CNET Rocket Money review (2025) — cnet.com
- Bluesky and Mastodon for Developer Marketing (2026) — daily.dev
- How to Promote Your Chrome Extension (2026 Playbook) — Dupple
- Side Project Launch Strategy 2026 (Product Hunt / HN / X / Bluesky / Indie Hackers) — youngju.dev
- Best Directories to Submit Your Chrome Extension (2026) — SaaSCity

---

## Appendix: Idea #3 (Freelance Client Communication Trail)

Kept as a fallback if subscription tracker doesn't validate.

**Pitch:** A Chrome extension that automatically records every client approval, revision request, and scope decision — so you can prove what was agreed.

**Why it might work better:**
- Authenticity — you've lost money to scope creep
- Acute pain — single $2–5K losses vs $21/mo drip
- Tight communities — freelance Slack/Discord servers, LinkedIn freelance groups

**Validation threshold:** 20+ freelancer waitlist signups before building.

---

*Built from research on 2026-08-14. Updated with validation results 2026-08-20.*