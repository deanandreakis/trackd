'use strict';

// Core request handler for POST /api/beta-signup.
//
// This module is transport-agnostic: it takes a Netlify-style event
// ({ httpMethod, headers, body, isBase64Encoded }) and returns a Netlify-style
// response ({ statusCode, headers, body }). Persistence and email sending are
// delegated to the reusable signup service (netlify/lib/signup-service.js),
// which is injected, so the contract can be tested without Netlify or AWS.
//
// Frozen API contract (frontend built against this in parallel):
//   POST /api/beta-signup
//   request  { email: string, honeypot: string, source: string }
//   200      { "status": "ok" }
//   400      { "status": "error", "message": string }
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

function defaultClientIp(event) {
  // Netlify sets this header at the edge and overwrites any client-supplied
  // value. x-forwarded-for is only a fallback for local/dev runs.
  const edge = header(event, 'x-nf-client-connection-ip');
  if (typeof edge === 'string' && edge.trim()) return edge.trim();
  const forwarded = header(event, 'x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
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

    const email = normalizeEmail(payload.email);
    if (!email) {
      return json(400, { status: 'error', message: MESSAGES.invalidEmail });
    }

    const source = normalizeSource(payload.source);
    const emailHash = service.emailHash(email);

    const ip = getClientIp(event) || 'unknown';
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
      // Already stored and already emailed recently. Idempotent success.
      return json(200, { status: 'ok' });
    }

    let signup;
    try {
      signup = await service.storeSignup(email, source);
    } catch (err) {
      logger.error('beta-signup: audience write failed', {
        emailHash: emailHash.slice(0, 12),
        code: err && err.code ? err.code : 'store_error',
      });
      return json(500, { status: 'error', message: MESSAGES.unavailable });
    }

    let delivery;
    try {
      delivery = await service.sendConfirmation(email);
    } catch (err) {
      logger.error('beta-signup: confirmation send failed', {
        emailHash: emailHash.slice(0, 12),
        code: err && err.code ? err.code : 'provider_error',
      });
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
