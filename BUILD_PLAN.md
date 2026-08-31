# Trackd MVP Build Plan

## Goal
Build a working Chrome Extension MVP that can be published to the Chrome Web Store. Priority: get something shippable, not perfect.

## MVP Scope (from PLAN.md §9)

| Feature | Priority | Notes |
|---|---|---|
| Gmail OAuth (read-only, billing emails) | P0 | Core requirement |
| Detect 20–30 major merchants via receipt pattern matching | P0 | Core value prop |
| Dashboard popup showing detected subscriptions | P0 | The UI |
| Manual add/categorize for missed subscriptions | P0 | Completeness |
| Free trial alerts | P1 | Nice differentiator |
| Local processing (no cloud account) | P0 | Privacy promise |
| ~200 KB extension size | P0 | Keep it lean |

## After MVP (P2, skip for now)
- Cancellation guides / one-click cancel links
- AI-based detection for non-standard merchants
- CSV export
- Multi-account / Outlook support
- Cloud sync

## Build Order

### Phase 1: Scaffold
- Chrome Extension Manifest V3 skeleton
- Extension popup HTML/CSS/JS
- Build tooling (no framework needed — plain JS)

### Phase 2: Gmail Integration
- Gmail API OAuth flow (read-only scope)
- Fetch billing-related emails via Gmail API
- Parse email sender/subject/date for receipt patterns

### Phase 3: Subscription Detection
- Known merchant list (Netflix, Spotify, Adobe, etc.)
- Regex/pattern matching for receipt emails
- Merchant detection + price extraction

### Phase 4: Dashboard UI
- Display detected subscriptions in popup
- Name, price, renewal date, status
- Manual add form for missed subscriptions
- Local storage (chrome.storage.local)

### Phase 5: Free Trial Alerts
- Detect "free trial" language in emails
- Parse trial end date
- Set chrome.alarms for reminders

### Phase 6: Polish & Ship
- Privacy policy link in extension
- Chrome Web Store assets (screenshots, icon, description)
- Submit to Chrome Web Store ($5 one-time fee)

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Extension framework | Manifest V3 | Chrome Web Store requirement |
| Email access | Gmail API (gmail.readonly) | OAuth2, user consent |
| Subscription detection | Pattern matching + known merchant list | No AI needed for MVP (20-30 merchants) |
| Data storage | chrome.storage.local | Privacy-first, no cloud |
| UI | Plain HTML/CSS/JS | No framework, <200KB |
| Build | No build step | Vanilla JS, just zip it |