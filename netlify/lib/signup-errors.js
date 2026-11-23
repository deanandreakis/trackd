'use strict';

// Typed errors for the beta-signup persistence + email module.
//
// The HTTP handler never surfaces these to the client: it maps any SignupError
// to a generic 400/500 body. They exist so the caller can distinguish "our
// store is down" from "the email provider rejected the request" without
// string-matching messages, and so no provider detail leaks into a response.
//
// Rules for every subclass:
//   - `code`   a short, machine-readable token (safe to log)
//   - `status` the upstream HTTP status when known, else 0
//   - `message` equals `code`; NEVER the raw email address or a provider payload
//
// The raw address must never appear in an error message or a log line.

class SignupError extends Error {
  constructor(code, status) {
    super(String(code));
    this.name = 'SignupError';
    this.code = String(code);
    this.status = Number(status) || 0;
  }
}

// A failure talking to the durable store (Netlify Blobs, a DB, ...).
class StoreError extends SignupError {
  constructor(code, status) {
    super(code, status);
    this.name = 'StoreError';
  }
}

// A failure talking to the transactional email provider / audience list.
class ProviderError extends SignupError {
  constructor(code, status) {
    super(code, status);
    this.name = 'ProviderError';
  }
}

// The module is missing required configuration (e.g. a sender identity).
class ConfigError extends SignupError {
  constructor(code, status) {
    super(code, status);
    this.name = 'ConfigError';
  }
}

module.exports = { SignupError, StoreError, ProviderError, ConfigError };
