# POST /api/beta-signup — adversarial security review

Task `t_758b20e3`. Scope: the endpoint (`netlify/functions/beta-signup.js`), the
core handler (`netlify/lib/beta-signup.js`) and the persistence/email module
(`netlify/lib/signup-service.js`, `netlify/lib/ses-provider.js`,
`netlify/lib/confirmation-email.js`, `netlify/lib/signup-errors.js`).

Method: source review plus a from-scratch adversarial harness that drives the
real handler with a Blobs-semantics store (atomic `onlyIfNew`, `{modified}`
return) and a recording provider. Reproduce with
`node scripts/security/adversarial-beta-signup.js` (also attached to the card).

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| H1 | Concurrent duplicate signups each sent a confirmation email (email-bomb race) | High | **Fixed** |
| M1 | Per-IP throttle bypassable via a client-supplied `X-Forwarded-For` | Medium | **Fixed** |
| M2 | Log injection through the attacker-controlled `source` field | Medium | **Fixed** |
| L1 | No top-level error guard in the Netlify adapter | Low | **Fixed** |
| L2 | Extension signing-key zip backup present and not git-ignored | Low | **Fixed** |
| L3 | Rate limiter fails open when the Blobs store errors | Low | Accepted (documented) |
| I1 | Honeypot is bypassable by simply omitting the field | Info | Accepted (bot trap, not a control) |
| I2 | No per-address throttle beyond the 24 h resend cooldown | Info | Mitigated by H1 fix |

### H1 — concurrent duplicate signups email-bomb (High, fixed)

The duplicate check (`getSignup` → `confirmationSentAt` within the cooldown) is a
**read**. Ten concurrent POSTs for the same address all observed "not sent yet",
all passed the per-IP throttle (5 slots) and **all sent a confirmation** — the
harness measured `sends=5` for one victim address. An attacker with a handful of
concurrent sockets can deliver a burst of mail to any address.

Fix: an atomic per-address **send claim** before the send. The handler takes
`send:<HMAC>:<cooldown-window>` with Blobs' `onlyIfNew` conditional write;
exactly one concurrent request wins and the rest return the idempotent `200`
without sending. A failed send releases the claim so a genuine retry still goes
out. Verified: `sends=1` for 10 concurrent duplicates.

### M1 — `X-Forwarded-For` bypasses the per-IP throttle (Medium, fixed)

`defaultClientIp` fell back to `x-forwarded-for` when the edge header was
absent. Netlify does **not** set `X-Forwarded-For` — anything there is client
input — so with no edge header every request could present a fresh fake IP and
get its own rate-limit bucket (harness: 8/8 requests passed). Fix: trust only
`x-nf-client-connection-ip`; honour XFF only when `TRUST_FORWARDED_FOR=1` is set
by the operator; otherwise share one `unknown` bucket so spoofing gains nothing.

### M2 — log injection via `source` (Medium, fixed)

`source` is attacker-controlled, stored verbatim and written into a `console`
log object. Newlines let a caller forge log lines (alert spoofing / log
corruption). Fix: strip C0/C1 control characters in `normalizeSource` before the
value is stored or logged.

### L1 — no top-level error guard in the adapter (Low, fixed)

`exports.handler` returned `coreHandler(...)` directly. Every expected failure is
mapped to a typed response, but an unforeseen throw would surface as a platform
error page. Fix: a `try/catch` that logs only the error name and returns the
generic 500 JSON.

### L2 — extension signing-key backup not ignored (Low, fixed)

`trackd-extension-test-keyed.zip.pre-rebuild.bak` (contains the manifest `key`
field) sat in the repo root and was **not** matched by `.gitignore`; a `git add
-A` would have committed it. Fix: ignore `trackd-extension-test-keyed.zip.*` and
`*.pre-rebuild.bak`.

### L3 — rate limiter fails open (Low, accepted)

A Blobs outage disables the throttle (`claimRateSlot` returns `true`). This is a
deliberate availability tradeoff and is not attacker-triggerable, so it is
accepted. If defence-in-depth is wanted, add a bounded in-process counter as a
secondary limiter.

## Verified clean

- **Data handling.** The raw address never reaches a log line (asserted). No
  real secret is committed (only the AWS-docs example key in tests). Keys and
  store keys are salted HMACs.
- **Injection.** Email segments are percent-encoded independently
  (`canonicalPathFromSegments`), so a `/` in an address cannot become path
  structure. `normalizeEmail` rejects whitespace and control characters.
- **Error leakage.** Provider failures (including a payload carrying an access
  key and a source path) return `{"status":"error","message":"We couldn't save
  your email just now…"}` — no provider name, key or stack token.
- **Open relay.** The only send target is the normalized submitted address; the
  From address is fixed from env. The endpoint is not an open relay.
- **Idempotency.** One contact row per address under concurrency; the marker is a
  single key per address.

## Remaining risks / follow-ups

- **Double opt-in.** Anyone can still trigger at most one confirmation to any
  address per cooldown window. A confirm-the-address link is the only complete
  fix; today the endpoint stores and sends in one step.
- **Live verification** still needs AWS SES credentials + a Netlify deploy
  (inherited from `t_8cb89494`).
- **Compliance:** `privacy-policy.html` and the consent runbook still name
  Resend as the processor; update to Amazon SES before production.
