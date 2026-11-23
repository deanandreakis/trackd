'use strict';

// AWS SES (v2) transport for the beta signup endpoint.
//
// Two operations, both over the SES v2 REST-JSON API with a hand-rolled SigV4
// signature (netlify/lib/aws-sigv4.js) — no AWS SDK, so the Netlify Function
// bundle stays small and has no extra transitive dependencies:
//
//   addContact(email)       -> PUT  /v2/email/contact-lists/{list}/contacts/{email}
//                              creates the address in a SES contact list (the list)
//   sendConfirmation(email) -> POST /v2/email/outbound-emails
//                              sends the install-instructions email
//
// Configuration (Netlify environment variables):
//   AWS_ACCESS_KEY_ID      required — IAM access key id
//   AWS_SECRET_ACCESS_KEY  required — IAM secret access key
//   AWS_SESSION_TOKEN      optional — only for temporary/STS credentials
//   AWS_REGION             required in practice — the SES region, e.g. us-east-1
//                          (AWS_DEFAULT_REGION is accepted as a fallback)
//   SIGNUP_FROM_EMAIL      required — a SES-verified sender identity, e.g.
//                          "Trackd <hello@deanware.com>". Without it the
//                          endpoint returns a generic 500 and sends nothing.
//   SIGNUP_REPLY_TO        optional — reply-to address. Defaults to
//                          trackd@deanware.com.
//   SES_CONTACT_LIST       the SES contact list that holds the beta list.
//                          Optional at the code level: without it the endpoint
//                          still sends the email and stores the address in
//                          Netlify Blobs instead, but there is no SES
//                          console/CSV list. Set it in production.
//   AWS_ENDPOINT_URL_SES   optional — full endpoint base URL, e.g.
//                          https://email.eu-west-1.amazonaws.com. Falls back to
//                          AWS_ENDPOINT_URL, then to email.<region>.amazonaws.com.
//                          This is the standard AWS SDK override name; the tests
//                          use it to point the provider at a local SES stub.
//
// Required IAM permissions: ses:SendEmail and, when SES_CONTACT_LIST is set,
// ses:CreateContact. Scope both to the sending identity and the contact list.
//
// Error handling: failures throw ProviderError with a short machine code and
// the HTTP status only. The raw email is never included in the error message or
// in any log line emitted here.

const { signRequest } = require('./aws-sigv4');
const { buildConfirmation } = require('./confirmation-email');
const { ProviderError } = require('./signup-errors');

const SERVICE = 'ses';
const DEFAULT_REGION = 'us-east-1';
const REQUEST_TIMEOUT_MS = 4000;

// SES REST-JSON errors carry the exception name either in the x-amzn-errortype
// response header (possibly with a URL suffix after ':') or in a `__type` body
// field. Both are checked; the body message is a last-resort fallback.
function errorType(response, data, text) {
  const raw =
    response.headers.get('x-amzn-errortype') ||
    (data && (data.__type || data.code)) ||
    '';
  const name = String(raw).split(':')[0].trim();
  if (name) return name;
  const message = String((data && data.message) || text || '').toLowerCase();
  if (message.includes('already exists')) return 'AlreadyExistsException';
  return '';
}

function createSesProvider(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || (() => Date.now());
  const timeoutMs = opts.timeoutMs || REQUEST_TIMEOUT_MS;

  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = env.AWS_SESSION_TOKEN;
  const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || DEFAULT_REGION;
  const from = env.SIGNUP_FROM_EMAIL;
  const replyTo = env.SIGNUP_REPLY_TO || 'trackd@deanware.com';
  const contactList = env.SES_CONTACT_LIST;
  const endpoint =
    env.AWS_ENDPOINT_URL_SES ||
    env.AWS_ENDPOINT_URL ||
    'https://email.' + region + '.amazonaws.com';

  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch (err) {
    endpointUrl = null;
  }
  const protocol = endpointUrl ? endpointUrl.protocol : 'https:';
  const host = endpointUrl ? endpointUrl.host : 'email.' + region + '.amazonaws.com';

  const credentials = { accessKeyId, secretAccessKey, sessionToken };

  async function request(method, pathSegments, query, payload) {
    const body = payload == null ? '' : JSON.stringify(payload);

    let signed;
    try {
      signed = signRequest({
        method,
        host,
        pathSegments,
        query,
        headers: { 'content-type': 'application/json' },
        body,
        region,
        service: SERVICE,
        credentials,
        date: new Date(now()),
      });
    } catch (err) {
      throw new ProviderError('sign_error', 0);
    }

    // Build the URL from the signed canonical path/query so the bytes on the
    // wire are exactly the bytes that were signed (no double-encoding).
    const url =
      protocol +
      '//' +
      host +
      signed.canonicalPath +
      (signed.canonicalQuery ? '?' + signed.canonicalQuery : '');

    const headers = Object.assign({}, signed.headers);
    // undici owns the Host header; sending it explicitly is a no-op at best.
    delete headers.host;

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
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
    return {
      ok: response.ok,
      status: response.status,
      data,
      text,
      type: errorType(response, data, text),
    };
  }

  return {
    ready: Boolean(accessKeyId && secretAccessKey && from),
    contactListConfigured: Boolean(contactList),

    async addContact(email) {
      if (!contactList) {
        // No contact list configured. The core handler stores the address in
        // Netlify Blobs so the signup is still durable.
        return { stored: false, reason: 'no_contact_list' };
      }

      const result = await request(
        'PUT',
        ['v2', 'email', 'contact-lists', contactList, 'contacts', email],
        {},
        { UnsubscribeAll: false }
      );

      if (result.ok) {
        return { stored: true, contactId: email };
      }

      if (result.type === 'AlreadyExistsException') {
        // Idempotent: the address is already in the list. Not a second row.
        return { stored: true, duplicate: true, contactId: email };
      }

      throw new ProviderError('contact_http_' + result.status, result.status);
    },

    async sendConfirmation(email) {
      const message = buildConfirmation(env);
      const headers = Object.keys(message.headers || {}).map((name) => ({
        Name: name,
        Value: message.headers[name],
      }));

      const result = await request('POST', ['v2', 'email', 'outbound-emails'], {}, {
        FromEmailAddress: from,
        Destination: { ToAddresses: [email] },
        ReplyToAddresses: [replyTo],
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: message.text, Charset: 'UTF-8' },
              Html: { Data: message.html, Charset: 'UTF-8' },
            },
            Headers: headers,
          },
        },
      });

      if (!result.ok) {
        throw new ProviderError('email_http_' + result.status, result.status);
      }

      return { id: result.data && result.data.MessageId };
    },
  };
}

module.exports = { createSesProvider, ProviderError };
