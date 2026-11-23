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
//   storeSignup(email, source, consent) -> { emailHash, duplicate, stored,
//                                            audience, contactId, marketing,
//                                            promotional, createdAt,
//                                            confirmationSentAt }
//                                          idempotent; ProviderError / StoreError
//                                         `consent` is { marketing: boolean };
//                                         beta consent is implied true because
//                                         the HTTP handler rejects any other
//                                         value before the service is reached.
//                                         The provider's lists are reconciled
//                                         with that value before the marker is
//                                         written (see below).
//   claimConfirmation(email, windowMs) -> true if this request may send now
//   releaseConfirmation(email, windowMs) -> drop a claim after a failed send
//   recordConsent(email, consent)      -> refresh the consent block, reconcile
//                                         the promotional audience with it, and
//                                         return the marker (StoreError /
//                                         ProviderError). Null when there is no
//                                         marker.
//   sendConfirmation(email)            -> { id }               (ProviderError)
//   markConfirmationSent(email, meta)  -> updated marker       (StoreError)
//
// Injected `store` is the Netlify Blobs adapter (get/set/delete). Injected
// `provider` is the SES transport (ready/addContact/sendConfirmation, plus
// promoListConfigured, which tells the service whether a promotional audience
// exists to reconcile).
//
// Consent and the audience are kept in agreement. `provider.addContact` is
// called with the submitted marketing consent on every path that accepts a
// request, and it reconciles the list membership to that value in both
// directions, so a withdrawal removes the address from the promotional
// audience and an opt-in adds it — the stored `consent` block and the audience
// the marker is evidence for can never disagree. The provider call happens
// before the marker write: a failed reconcile leaves the previous (still
// agreeing) value in place and surfaces the error instead of recording a
// choice the audience never applied.
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

// Consent evidence block for the stored marker.
//
// `beta` is always true here: the HTTP handler rejects anything but an explicit
// boolean true before the service runs, so reaching this point *is* the beta
// consent act. The timestamps are the evidence trail (GDPR Art. 7(1)) and come
// from the server clock (`at`), never from client input. A repeat signup keeps
// the earliest recorded times so the original consent act is preserved rather
// than being silently re-dated.
function buildConsent(prior, marketing, at) {
  const previous = prior || {};
  const betaAt = typeof previous.betaAt === 'number' ? previous.betaAt : at;
  let marketingAt = null;
  if (marketing === true) {
    marketingAt =
      typeof previous.marketingAt === 'number' ? previous.marketingAt : at;
  }
  return {
    beta: true,
    betaAt,
    marketing: marketing === true,
    marketingAt,
  };
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
    // `consent` is { marketing: boolean } — the explicit marketing opt-in, if
    // any. Beta consent is implied by reaching this method.
    async storeSignup(email, source, consent) {
      const normalized = normalizeEmail(email);
      if (!normalized) throw new ConfigError('invalid_email', 0);

      const wantsMarketing = Boolean(consent && consent.marketing === true);
      const sourceValue = normalizeSource(source);
      const hashValue = emailHash(normalized);
      const key = 'signup:' + hashValue;

      // 1. The prior marker, read before the provider call so the write below
      //    can preserve createdAt, confirmationSentAt and the earliest consent
      //    timestamps. A read failure is not fatal: the audience (when
      //    configured) is the authoritative duplicate check.
      let existing = null;
      try {
        existing = await store.get(key);
      } catch (err) {
        logger.error('signup-service: marker read failed', {
          emailHash: shortHash(hashValue),
          code: err && err.code ? err.code : 'store_error',
        });
        existing = null;
      }

      // 2. The lists, reconciled with the submitted consent. The provider keys
      //    contacts by address, so a repeat is its AlreadyExists path rather
      //    than a second entry, and the marketing flag is applied in both
      //    directions: present when consented, removed when not (see
      //    netlify/lib/ses-provider.js addContact). Done before the marker
      //    write so a failed reconcile cannot leave evidence behind for a
      //    change the audience never took.
      let contact = {
        stored: false,
        duplicate: false,
        contactId: null,
        promotional: false,
      };
      try {
        const result = await provider.addContact(normalized, {
          marketing: wantsMarketing,
        });
        contact = {
          stored: Boolean(result && result.stored),
          duplicate: Boolean(result && result.duplicate),
          contactId: (result && result.contactId) || null,
          promotional: Boolean(result && result.promotional),
        };
      } catch (err) {
        throw asProviderError(err, 'contact');
      }

      // 3. The marker — one key per address. Preserve the original createdAt and
      //    any prior confirmation time so a repeat does not reset history.
      const record = Object.assign({}, existing || {}, {
        source: sourceValue,
        createdAt: (existing && existing.createdAt) || now(),
        updatedAt: now(),
        audience: contact.stored,
        contactId: contact.contactId,
        // Consent evidence: the booleans the visitor actually submitted, plus
        // the server-clock timestamps that prove when (GDPR Art. 7(1)). Never
        // derived from client-supplied times.
        consent: buildConsent(
          existing && existing.consent,
          wantsMarketing,
          now()
        ),
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
        marketing: record.consent.marketing,
        promotional: contact.promotional,
        createdAt: record.createdAt,
        confirmationSentAt: record.confirmationSentAt,
      };
    },

    // Refresh the consent block of an existing marker *and* bring the
    // promotional audience to the state it records. Used on the
    // resend-cooldown path: the address was already stored and emailed
    // recently, so the handler returns the idempotent 200 without a new send —
    // but the visitor's latest choice is still evidence, and it must have
    // effect: a withdrawal has to actually leave the promotional list (GDPR
    // Art. 7(3)) and an opt-in has to actually reach it, otherwise the list is
    // not the consent gate the docs say it is.
    //
    // Order: the audience first, then the marker. If the provider call throws,
    // nothing is written and the caller must report failure (never a 200) — the
    // record keeps its previous value, which still matches the audience.
    //
    // Fast path: an unchanged value with no promotional audience configured has
    // nothing to reconcile and nothing new to record, so it stays a pure read
    // (no provider call, no write).
    async recordConsent(email, consent) {
      const normalized = normalizeEmail(email) || email;
      const key = signupKey(normalized);
      const existing = await readMarker(key);
      if (!existing) return null;

      const wantsMarketing = Boolean(consent && consent.marketing === true);
      const prior = existing.consent || {};
      const unchanged = prior.marketing === wantsMarketing && prior.beta === true;

      if (unchanged && !provider.promoListConfigured) return existing;

      try {
        await provider.addContact(normalized, { marketing: wantsMarketing });
      } catch (err) {
        throw asProviderError(err, 'contact');
      }

      if (unchanged) return existing;

      const record = Object.assign({}, existing, {
        consent: buildConsent(prior, wantsMarketing, now()),
        updatedAt: now(),
      });
      await writeMarker(key, record);
      return record;
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
