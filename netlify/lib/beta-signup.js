'use strict';

// Core request handler for POST /api/beta-signup.
//
// This module is transport-agnostic: it takes a Netlify-style event
// ({ httpMethod, headers, body, isBase64Encoded }) and returns a Netlify-style
// response ({ statusCode, headers, body }). Persistence and email sending are
// delegated to the reusable signup service (netlify/lib/signup-service.js),
// which is injected, so the contract can be tested without Netlify or AWS.
//
// Frozen API contract v2 (frontend built against this in parallel):
//   POST /api/beta-signup
//   request  { email: string, honeypot: string, source: string,
//              beta_consent: boolean, marketing_consent: boolean }
//   200      { "status": "ok" }
//   400      { "status": "error", "message": string }
//
// Consent (contract v2, frozen by compliance 19 Nov 2026):
// - `beta_consent` must be exactly boolean true. Missing, false, "true", 1 and
//   null are all rejected with the generic MESSAGES.invalidRequest — the same
//   message the honeypot case returns, so the response never reveals which
//   check failed.
// - `marketing_consent` is optional and true only on an explicit boolean true.
//   It is never derived from any other field.
// - The handler records the consent decision (consent.beta / consent.marketing)
//   with server-clock timestamps in the stored marker, and only a consented
//   address is added to a promotional audience. These two timestamps are the
//   evidence trail for GDPR Art. 7(1); they never come from client input.
//
// Design notes:
// - The raw email is never logged. Logs carry a salted HMAC prefix of the
//   address so a failed send can be correlated without storing PII in logs.
// - Rate limiting is a fixed-window claim: each request atomically creates one
//   of N slot keys via the store's onlyIfNew condition. No read-modify-write
//   race, so concurrent requests cannot all pass on the same slot.
// - Duplicate signups are idempotent; the service owns that guarantee. A
//   confirmation already sent within the cooldown window is not re-sent.
// - If the rate-limit store is unavailable the request fails open (the signup
//   still works) and the failure is logged. Availability wins over a
//   best-effort throttle during a storage outage.
// - Provider/store failures surface as typed errors from the service and are
//   mapped here to a generic 500; nothing internal reaches the client.

const {
  createSignupService,
  normalizeEmail,
  normalizeSource,
} = require('./signup-service');

const MAX_BODY_BYTES = 2048;

const DEFAULTS = {
  rateLimitMax: 5,
  rateLimitWindowMs: 10 * 60 * 1000,
  resendCooldownMs: 24 * 60 * 60 * 1000,
};

const MESSAGES = {
  invalidEmail: 'Please enter a valid email address.',
  invalidRequest: 'Signup could not be processed.',
  rateLimited: 'Too many signup attempts. Please try again in a few minutes.',
  unavailable:
    "We couldn't save your email just now. Please try again in a minute.",
  method: 'Method not allowed.',
};

function json(statusCode, payload, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
      extraHeaders || {}
    ),
    body: JSON.stringify(payload),
  };
}

function header(event, name) {
  const headers = (event && event.headers) || {};
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return undefined;
}

function readBody(event) {
  let body = event && event.body;
  if (body == null) return '';
  if (event.isBase64Encoded) {
    body = Buffer.from(body, 'base64').toString('utf8');
  }
  return typeof body === 'string' ? body : '';
}

function defaultClientIp(event, env) {
  // Netlify sets x-nf-client-connection-ip at the edge and overwrites any
  // client-supplied value, so it is the only header we can trust by default.
  // Netlify does NOT set X-Forwarded-For: whatever arrives there is client
  // input, and trusting it would let an attacker mint a fresh rate-limit
  // bucket per request. XFF is honoured only when the operator explicitly
  // declares that a trusted proxy in front of this function sets it.
  const edge = header(event, 'x-nf-client-connection-ip');
  if (typeof edge === 'string' && edge.trim()) return edge.trim();

  const trustForwarded =
    env &&
    (env.TRUST_FORWARDED_FOR === '1' ||
      String(env.TRUST_FORWARDED_FOR).toLowerCase() === 'true');
  if (trustForwarded) {
    const forwarded = header(event, 'x-forwarded-for');
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
  }
  // No trustworthy source available: fall back to a single shared bucket, so a
  // spoofed header gains the caller nothing.
  return 'unknown';
}

function intFromEnv(env, name, fallback, min) {
  const raw = env && env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.floor(parsed);
}

function createHandler(options) {
  const opts = options || {};
  const store = opts.store;
  const provider = opts.provider;
  const logger = opts.logger || console;
  const now = opts.now || (() => Date.now());
  const getClientIp = opts.getClientIp || defaultClientIp;
  const env = opts.env || process.env;

  if (!store) throw new Error('createHandler: store is required');
  if (!provider) throw new Error('createHandler: provider is required');

  const service =
    opts.service ||
    createSignupService({ store, provider, logger, env, now });

  const config = {
    rateLimitMax: intFromEnv(env, 'RATE_LIMIT_MAX', DEFAULTS.rateLimitMax, 1),
    rateLimitWindowMs:
      intFromEnv(env, 'RATE_LIMIT_WINDOW_SECONDS', DEFAULTS.rateLimitWindowMs / 1000, 1) *
      1000,
    resendCooldownMs:
      intFromEnv(
        env,
        'SIGNUP_RESEND_COOLDOWN_SECONDS',
        DEFAULTS.resendCooldownMs / 1000,
        0
      ) * 1000,
  };

  async function claimRateSlot(ipHash) {
    const bucket = Math.floor(now() / config.rateLimitWindowMs);
    for (let slot = 0; slot < config.rateLimitMax; slot += 1) {
      const key = 'rl:' + ipHash + ':' + bucket + ':' + slot;
      try {
        const result = await store.set(
          key,
          { at: now() },
          { onlyIfNew: true }
        );
        if (result && result.modified) return true;
      } catch (err) {
        // Fail open: a throttle outage must not take signups down.
        logger.error('beta-signup: rate-limit store unavailable', {
          code: err && err.code ? err.code : 'store_error',
        });
        return true;
      }
    }
    return false;
  }

  return async function handler(event) {
    const method = (event && event.httpMethod) || 'POST';
    if (method !== 'POST') {
      return json(405, { status: 'error', message: MESSAGES.method }, {
        Allow: 'POST',
      });
    }

    const contentType = header(event, 'content-type') || '';
    if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) {
      return json(400, { status: 'error', message: MESSAGES.invalidRequest });
    }

    const rawBody = readBody(event);
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return json(400, { status: 'error', message: MESSAGES.invalidRequest });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      return json(400, { status: 'error', message: MESSAGES.invalidRequest });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return json(400, { status: 'error', message: MESSAGES.invalidRequest });
    }

    // Honeypot first: a filled field means a bot. Do not touch storage and do
    // not reveal that the field was the reason.
    const honeypot =
      typeof payload.honeypot === 'string' ? payload.honeypot.trim() : '';
    if (honeypot !== '') {
      return json(400, { status: 'error', message: MESSAGES.invalidRequest });
    }

    // Consent is the lawful basis for the beta signup and the install email
    // (GDPR Art. 6(1)(a)) and the controller must be able to demonstrate it
    // (Art. 7(1)). beta_consent must be exactly boolean true: missing, false,
    // "true", 1 and null are all rejected here, with the same generic message
    // as the honeypot case, so the response does not reveal which check failed.
    if (payload.beta_consent !== true) {
      return json(400, { status: 'error', message: MESSAGES.invalidRequest });
    }

    // Marketing consent is a separate, optional purpose. It is true only on an
    // explicit boolean true; absent, false, "true", 1 and null all mean "no
    // marketing consent" and are never coerced from another field.
    const marketingConsent = payload.marketing_consent === true;

    const email = normalizeEmail(payload.email);
    if (!email) {
      return json(400, { status: 'error', message: MESSAGES.invalidEmail });
    }

    const source = normalizeSource(payload.source);
    const emailHash = service.emailHash(email);

    const ip = getClientIp(event, env) || 'unknown';
    const ipHash = service.hash(ip);

    if (!(await claimRateSlot(ipHash))) {
      return json(400, { status: 'error', message: MESSAGES.rateLimited });
    }

    if (!service.ready) {
      logger.error('beta-signup: email provider is not configured', {
        emailHash: emailHash.slice(0, 12),
      });
      return json(500, { status: 'error', message: MESSAGES.unavailable });
    }

    let existing = null;
    try {
      existing = await service.getSignup(email);
    } catch (err) {
      logger.error('beta-signup: signup store read failed', {
        emailHash: emailHash.slice(0, 12),
        code: err && err.code ? err.code : 'store_error',
      });
      // Not fatal: the provider audience is the authoritative duplicate check.
      existing = null;
    }

    const sentAt = existing && existing.confirmationSentAt;
    if (
      typeof sentAt === 'number' &&
      now() - sentAt < config.resendCooldownMs
    ) {
      // Already stored and already emailed recently. Idempotent success — but a
      // changed consent value is still new evidence and must not be dropped, so
      // refresh just the consent block before returning.
      try {
        await service.recordConsent(email, { marketing: marketingConsent });
      } catch (err) {
        logger.error('beta-signup: consent refresh failed', {
          emailHash: emailHash.slice(0, 12),
          code: err && err.code ? err.code : 'store_error',
        });
      }
      return json(200, { status: 'ok' });
    }

    let signup;
    try {
      signup = await service.storeSignup(email, source, {
        marketing: marketingConsent,
      });
    } catch (err) {
      logger.error('beta-signup: audience write failed', {
        emailHash: emailHash.slice(0, 12),
        code: err && err.code ? err.code : 'store_error',
      });
      return json(500, { status: 'error', message: MESSAGES.unavailable });
    }

    // Atomic per-address send claim. The cooldown check above is a read, so
    // concurrent requests for the same address all observe "not sent yet" and
    // would all send. The claim makes exactly one of them the sender; the rest
    // return the same idempotent 200 without sending.
    if (!(await service.claimConfirmation(email, config.resendCooldownMs))) {
      return json(200, { status: 'ok' });
    }

    let delivery;
    try {
      delivery = await service.sendConfirmation(email);
    } catch (err) {
      logger.error('beta-signup: confirmation send failed', {
        emailHash: emailHash.slice(0, 12),
        code: err && err.code ? err.code : 'provider_error',
      });
      // Release the claim so a genuine retry can send inside the window.
      await service.releaseConfirmation(email, config.resendCooldownMs);
      return json(500, { status: 'error', message: MESSAGES.unavailable });
    }

    try {
      await service.markConfirmationSent(email, {
        deliveryId: delivery.id,
        contactId: signup.contactId,
      });
    } catch (err) {
      logger.error('beta-signup: signup store write failed', {
        emailHash: emailHash.slice(0, 12),
        code: err && err.code ? err.code : 'store_error',
      });
      // The address is already in the audience and the email is out. A missing
      // dedupe marker only costs a possible duplicate send later.
    }

    logger.log('beta-signup: signup stored and confirmation sent', {
      emailHash: emailHash.slice(0, 12),
      source,
      duplicate: Boolean(signup.duplicate),
      audience: Boolean(signup.audience),
    });

    return json(200, { status: 'ok' });
  };
}

module.exports = {
  createHandler,
  normalizeEmail,
  normalizeSource,
  MESSAGES,
};
