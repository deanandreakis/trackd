'use strict';

// Reusable persistence + confirmation-email module for the beta signup.
//
// This is the single place that owns "store the address durably" and "send the
// confirmation email". The HTTP handler (netlify/lib/beta-signup.js) and any
// future caller depend on this interface, not on the SES transport or Blobs
// directly, so the provider and the store can change behind one contract.
//
// Interface (createSignupService({ store, provider, logger, env, now, salt })):
//
//   ready                              true when the provider can send
//   normalizeEmail(value)              -> normalized address | null
//   normalizeSource(value)             -> trimmed source, never empty
//   hash(value)                        -> HMAC-SHA256 hex (for keys, logs)
//   emailHash(email)                   -> the address HMAC (never the address)
//   signupKey(email)                   -> the durable marker key
//   getSignup(email)                   -> stored marker | null   (StoreError)
//   storeSignup(email, source)         -> { emailHash, duplicate, stored,
//                                           audience, createdAt, confirmationSentAt }
//                                         idempotent; ProviderError / StoreError
//   claimConfirmation(email, windowMs) -> true if this request may send now
//   releaseConfirmation(email, windowMs) -> drop a claim after a failed send
//   sendConfirmation(email)            -> { id }               (ProviderError)
//   markConfirmationSent(email, meta)  -> updated marker       (StoreError)
//
// Injected `store` is the Netlify Blobs adapter (get/set/delete). Injected
// `provider` is the SES transport (ready/addContact/sendConfirmation).
//
// Two layers of idempotency, so a repeat signup is never double-stored:
//   1. The provider's audience/list is keyed by address; a repeat returns the
//      provider's AlreadyExists path, surfaced as `duplicate: true`.
//   2. The durable marker is a single key per address (`signup:<HMAC>`), so a
//      write overwrites the same record instead of adding a second row.
//
// This module never logs or returns the raw address. Callers log `emailHash`.

const crypto = require('node:crypto');
const { ProviderError, StoreError, ConfigError } = require('./signup-errors');

const MAX_EMAIL_LENGTH = 254;
const MAX_SOURCE_LENGTH = 120;
const DEFAULT_SALT = 'trackd-beta-signup-v1';

// Pragmatic address check: non-empty local part, one @, a domain with a dot and
// a TLD of at least two characters. Deliberately not RFC 5322-complete.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > MAX_EMAIL_LENGTH) return null;
  if (!EMAIL_RE.test(email)) return null;
  // Reject obvious structural problems the loose regex lets through.
  const [local, domain] = email.split('@');
  if (!local || !domain) return null;
  if (local.startsWith('.') || local.endsWith('.')) return null;
  if (local.includes('..') || domain.includes('..')) return null;
  if (domain.startsWith('.') || domain.endsWith('.')) return null;
  return email;
}

function normalizeSource(value) {
  if (typeof value !== 'string') return 'unknown';
  // Strip control characters (CR/LF/tab/NUL and the C0/C1 ranges) before the
  // value is stored or logged. `source` is attacker-controlled and reaches the
  // log stream verbatim, so an unescaped newline lets a caller forge log lines.
  const source = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .trim()
    .slice(0, MAX_SOURCE_LENGTH)
    .trim();
  return source || 'unknown';
}

// Re-throw a provider failure as a typed ProviderError, preserving an existing
// typed error untouched. The raw address is never part of the code or message.
function asProviderError(err, phase) {
  if (err instanceof ProviderError) return err;
  const code = err && err.code ? String(err.code) : phase + '_failed';
  const status = err && err.status ? Number(err.status) : 0;
  const wrapped = new ProviderError(code, status);
  wrapped.cause = err;
  return wrapped;
}

function createSignupService(options) {
  const opts = options || {};
  const store = opts.store;
  const provider = opts.provider;
  const logger = opts.logger || console;
  const now = opts.now || (() => Date.now());
  const env = opts.env || process.env;

  if (!store) throw new Error('createSignupService: store is required');
  if (!provider) throw new Error('createSignupService: provider is required');

  const salt = opts.salt || env.SIGNUP_HASH_SALT || DEFAULT_SALT;

  function hash(value) {
    return crypto.createHmac('sha256', salt).update(String(value)).digest('hex');
  }

  function emailHash(email) {
    return hash(email);
  }

  function signupKey(email) {
    return 'signup:' + emailHash(email);
  }

  function shortHash(value) {
    return String(value).slice(0, 12);
  }

  // Store failures are wrapped so the caller can map them without string
  // matching, and so no driver detail is exposed.
  async function readMarker(key) {
    try {
      return await store.get(key);
    } catch (err) {
      const wrapped = new StoreError('store_read_failed', err && err.status);
      wrapped.cause = err;
      throw wrapped;
    }
  }

  async function writeMarker(key, record) {
    try {
      await store.set(key, record);
    } catch (err) {
      const wrapped = new StoreError('store_write_failed', err && err.status);
      wrapped.cause = err;
      throw wrapped;
    }
  }

  return {
    ready: Boolean(provider.ready),
    normalizeEmail,
    normalizeSource,
    hash,
    emailHash,
    signupKey,

    async getSignup(email) {
      const normalized = normalizeEmail(email) || email;
      return readMarker(signupKey(normalized));
    },

    // Idempotent upsert of the address into the durable list, plus the
    // operational marker. A repeat updates/ignores; it never double-stores.
    async storeSignup(email, source) {
      const normalized = normalizeEmail(email);
      if (!normalized) throw new ConfigError('invalid_email', 0);

      const sourceValue = normalizeSource(source);
      const hashValue = emailHash(normalized);
      const key = 'signup:' + hashValue;

      // 1. The list. The provider keys contacts by address, so a repeat is its
      //    AlreadyExists path rather than a second entry.
      let contact = { stored: false, duplicate: false, contactId: null };
      try {
        const result = await provider.addContact(normalized);
        contact = {
          stored: Boolean(result && result.stored),
          duplicate: Boolean(result && result.duplicate),
          contactId: (result && result.contactId) || null,
        };
      } catch (err) {
        throw asProviderError(err, 'contact');
      }

      // 2. The marker — one key per address. Preserve the original createdAt and
      //    any prior confirmation time so a repeat does not reset history.
      let existing = null;
      try {
        existing = await store.get(key);
      } catch (err) {
        // Non-fatal: the audience (when configured) is the authoritative list.
        logger.error('signup-service: marker read failed', {
          emailHash: shortHash(hashValue),
          code: err && err.code ? err.code : 'store_error',
        });
        existing = null;
      }

      const record = Object.assign({}, existing || {}, {
        source: sourceValue,
        createdAt: (existing && existing.createdAt) || now(),
        updatedAt: now(),
        audience: contact.stored,
        contactId: contact.contactId,
      });
      record.confirmationSentAt =
        (existing && existing.confirmationSentAt) || null;

      // Only keep the raw address when there is no audience list to hold it;
      // with an audience, the list is the store and this marker stays PII-free.
      if (!record.audience) {
        record.email = normalized;
      } else {
        delete record.email;
      }

      try {
        await writeMarker(key, record);
      } catch (err) {
        if (!record.audience) {
          // No list to fall back to: the signup is not durable, so surface it.
          throw err;
        }
        logger.error('signup-service: marker write failed (audience is durable)', {
          emailHash: shortHash(hashValue),
          code: err && err.code ? err.code : 'store_error',
        });
      }

      return {
        emailHash: hashValue,
        duplicate: contact.duplicate,
        stored: contact.stored,
        audience: record.audience,
        contactId: record.contactId,
        createdAt: record.createdAt,
        confirmationSentAt: record.confirmationSentAt,
      };
    },

    // Atomically claim the right to send one confirmation for this address
    // inside the current cooldown window. The cooldown check in the handler is
    // a read, so two concurrent requests for the same address both observe
    // "not sent yet" and both send. Blobs' onlyIfNew is a server-side
    // conditional write: of N concurrent requests exactly one wins the claim
    // and the rest skip the send. The key is bucketed by the cooldown window so
    // a later window can send again without needing to overwrite the claim.
    async claimConfirmation(email, windowMs) {
      if (!(Number(windowMs) > 0)) return true; // cooldown disabled
      const normalized = normalizeEmail(email) || email;
      const hashValue = emailHash(normalized);
      const key =
        'send:' + hashValue + ':' + Math.floor(now() / Number(windowMs));
      try {
        const result = await store.set(key, { at: now() }, { onlyIfNew: true });
        return Boolean(result && result.modified);
      } catch (err) {
        // Fail open: a store outage must not stop confirmations entirely.
        logger.error('signup-service: send claim store unavailable', {
          emailHash: shortHash(hashValue),
          code: err && err.code ? err.code : 'store_error',
        });
        return true;
      }
    },

    // Drop a claim so a genuine retry can send inside the same window (used
    // when the provider rejects the send after the claim was taken).
    async releaseConfirmation(email, windowMs) {
      if (!(Number(windowMs) > 0)) return;
      const normalized = normalizeEmail(email) || email;
      const hashValue = emailHash(normalized);
      const key =
        'send:' + hashValue + ':' + Math.floor(now() / Number(windowMs));
      try {
        await store.delete(key);
      } catch (err) {
        logger.error('signup-service: send claim release failed', {
          emailHash: shortHash(hashValue),
          code: err && err.code ? err.code : 'store_error',
        });
      }
    },

    async sendConfirmation(email) {
      const normalized = normalizeEmail(email);
      if (!normalized) throw new ConfigError('invalid_email', 0);
      if (!provider.ready) throw new ConfigError('provider_not_configured', 0);
      try {
        const delivery = await provider.sendConfirmation(normalized);
        return { id: (delivery && delivery.id) || null };
      } catch (err) {
        throw asProviderError(err, 'email');
      }
    },

    async markConfirmationSent(email, meta) {
      const normalized = normalizeEmail(email) || email;
      const key = signupKey(normalized);
      const existing = await readMarker(key);
      const record = Object.assign({}, existing || {}, {
        confirmationSentAt: now(),
        updatedAt: now(),
      });
      if (meta && meta.deliveryId) record.deliveryId = meta.deliveryId;
      if (meta && meta.contactId) record.contactId = meta.contactId;
      await writeMarker(key, record);
      return record;
    },
  };
}

module.exports = {
  createSignupService,
  normalizeEmail,
  normalizeSource,
  EMAIL_RE,
};
