'use strict';

// Resend transport for the beta signup endpoint.
//
// Two operations, both over the plain HTTPS API (no SDK, no extra dependency):
//   addContact(email)       -> creates the address in a Resend Audience (the list)
//   sendConfirmation(email) -> sends the install-instructions email
//
// Configuration (Netlify environment variables):
//   RESEND_API_KEY       required — re_... API key. Without it the endpoint
//                        returns a generic 500 and sends nothing.
//   RESEND_AUDIENCE_ID   the Audience that holds the beta list. Optional at the
//                        code level: without it the endpoint still sends the
//                        email and stores the address in Netlify Blobs instead,
//                        but there is no Resend UI/CSV list. Set it in production.
//   SIGNUP_FROM_EMAIL    verified sender, e.g. "Trackd <hello@deanware.com>".
//                        Defaults to the Resend sandbox sender, which only
//                        delivers to the account owner's own address.
//   SIGNUP_REPLY_TO      reply-to address. Defaults to trackd@deanware.com.
//
// Error handling: failures throw ProviderError with a short machine code and
// the HTTP status only. The raw email is never included in the error message or
// in any log line emitted here.

const { buildConfirmation } = require('./confirmation-email');

const API_BASE = 'https://api.resend.com';
const REQUEST_TIMEOUT_MS = 4000;

class ProviderError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

function createResendProvider(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs || REQUEST_TIMEOUT_MS;

  const apiKey = env.RESEND_API_KEY;
  const audienceId = env.RESEND_AUDIENCE_ID;
  const from = env.SIGNUP_FROM_EMAIL || 'Trackd <onboarding@resend.dev>';
  const replyTo = env.SIGNUP_REPLY_TO || 'trackd@deanware.com';

  async function request(path, body) {
    let response;
    try {
      response = await fetchImpl(API_BASE + path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ProviderError(
        err && err.name === 'TimeoutError' ? 'timeout' : 'network_error',
        0
      );
    }

    const text = await response.text().catch(() => '');
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (err) {
      data = null;
    }
    return { ok: response.ok, status: response.status, data, text };
  }

  return {
    ready: Boolean(apiKey),
    audienceConfigured: Boolean(audienceId),

    async addContact(email) {
      if (!audienceId) {
        // No audience list configured. The core handler stores the address in
        // Netlify Blobs so the signup is still durable.
        return { stored: false, reason: 'no_audience' };
      }

      const result = await request(
        '/audiences/' + encodeURIComponent(audienceId) + '/contacts',
        { email, unsubscribed: false }
      );

      if (result.ok) {
        return {
          stored: true,
          contactId: result.data && result.data.id,
        };
      }

      const message = String(
        (result.data && result.data.message) || result.text || ''
      ).toLowerCase();
      const alreadyExists =
        result.status === 409 ||
        message.includes('already exists') ||
        message.includes('already a contact') ||
        message.includes('duplicate');

      if (alreadyExists) {
        // Idempotent: the address is already in the audience. Not a second row.
        return { stored: true, duplicate: true };
      }

      throw new ProviderError('audience_http_' + result.status, result.status);
    },

    async sendConfirmation(email) {
      const message = buildConfirmation();
      const result = await request('/emails', {
        from,
        to: [email],
        reply_to: replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      });

      if (!result.ok) {
        throw new ProviderError('email_http_' + result.status, result.status);
      }

      return { id: result.data && result.data.id };
    },
  };
}

module.exports = { createResendProvider, ProviderError };
