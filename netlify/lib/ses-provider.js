'use strict';

// AWS SES (v2) transport for the beta signup endpoint.
//
// Two operations, both over the SES v2 REST-JSON API with a hand-rolled SigV4
// signature (netlify/lib/aws-sigv4.js) — no AWS SDK, so the Netlify Function
// bundle stays small and has no extra transitive dependencies:
//
//   addContact(email, opts) -> POST /v2/email/contact-lists/{list}/contacts
//                              reconciles the address's list membership with the
//                              consent the request carried. It is idempotent in
//                              both directions:
//                                * the address is created on the transactional
//                                  (beta) contact list, which every signup joins
//                                  and which is never treated as promotional;
//                                * the promotional audience
//                                  (SES_PROMO_CONTACT_LIST) is brought to the
//                                  state the consent says — present when
//                                  opts.marketing === true (CreateContact) and
//                                  ABSENT otherwise (DeleteContact). Desired
//                                  state, not append-only: a visitor who
//                                  withdraws marketing consent must leave the
//                                  promotional list, or the list is not the
//                                  consent gate it is documented to be.
//   deleteContact(list, email) -> DELETE
//                              /v2/email/contact-lists/{list}/contacts/{email}
//                              removes an address from a contact list, so a
//                              withdrawal can actually reach the audience.
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
//   SES_CONTACT_LIST       the SES contact list that holds the beta list. This
//                          is the transactional audience every beta signup
//                          joins; it is never treated as promotional.
//                          Optional at the code level: without it the endpoint
//                          still sends the email and stores the address in
//                          Netlify Blobs instead, but there is no SES
//                          console/CSV list. Set it in production.
//   SES_PROMO_CONTACT_LIST optional — a second SES contact list that is the
//                          promotional audience. Its membership is reconciled
//                          with the submitted consent on every accepted
//                          request: an address whose request carried
//                          marketing_consent: true is created in it, an address
//                          whose request did not is deleted from it. The list
//                          itself is therefore the consent gate — a beta-only
//                          contact can never be in it, and a contact that
//                          withdraws leaves it (GDPR Art. 7(3)) — so every
//                          promotional send must target this list and nothing
//                          else. When unset there is no promotional audience at
//                          all, which is the safe default.
//   AWS_ENDPOINT_URL_SES   optional — full endpoint base URL, e.g.
//                          https://email.eu-west-1.amazonaws.com. Falls back to
//                          AWS_ENDPOINT_URL, then to email.<region>.amazonaws.com.
//                          This is the standard AWS SDK override name; the tests
//                          use it to point the provider at a local SES stub.
//
// Required IAM permissions:
//   ses:SendEmail       on the sending identity
//   ses:CreateContact   on the contact list, and on the promotional list when
//                       SES_PROMO_CONTACT_LIST is set
//   ses:DeleteContact   on the promotional list when SES_PROMO_CONTACT_LIST is
//                       set — the promotional audience is reconciled to the
//                       submitted consent, which means removing an address that
//                       did not consent or has withdrawn it. Without this
//                       permission every signup that is not a marketing opt-in
//                       fails (the request is refused rather than reported as
//                       accepted while the address stays in the audience).
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
  const promoList = env.SES_PROMO_CONTACT_LIST;
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

  // CreateContact (SES v2): POST /v2/email/contact-lists/{list}/contacts with
  // the address in the body. (PUT on .../contacts/{email} is UpdateContact,
  // which 404s for an address that is not already a contact — never use it to
  // add one.)
  async function createContact(list, email) {
    return request(
      'POST',
      ['v2', 'email', 'contact-lists', list, 'contacts'],
      {},
      { EmailAddress: email, UnsubscribeAll: false }
    );
  }

  // DeleteContact (SES v2): DELETE .../contacts/{email}. The address is a URI
  // path parameter, so it goes through pathSegments (each segment encoded on
  // its own, never re-interpreted as path structure) and no body is sent. A 404
  // is AWS's NotFoundException: the address was not in the list, which is the
  // state we wanted anyway.
  async function deleteContact(list, email) {
    return request(
      'DELETE',
      ['v2', 'email', 'contact-lists', list, 'contacts', email],
      {},
      null
    );
  }

  // SES reports a missing resource either as a bare 404 or as a typed exception
  // in x-amzn-errortype / __type. Both are treated as "already absent".
  function notFound(result) {
    return (
      result.status === 404 ||
      result.type === 'NotFoundException' ||
      result.type === 'ResourceNotFoundException'
    );
  }

  return {
    ready: Boolean(accessKeyId && secretAccessKey && from),
    contactListConfigured: Boolean(contactList),
    promoListConfigured: Boolean(promoList),
    createContact,
    deleteContact,

    // Reconcile the address's list membership with the consent the request
    // carried. Idempotent in both directions, so a first signup, a repeat, a
    // withdrawal and a re-opt-in all converge on what the latest accepted
    // request asked for and the stored record can never disagree with the
    // audience it is evidence for.
    async addContact(email, options) {
      const marketing = Boolean(options && options.marketing === true);

      // 1. Transactional (beta) list. Written first on purpose: if the
      //    promotional step below fails, the failure mode is an address that is
      //    beta-only with no promotional membership (closed), never an address
      //    in a promotional audience that nothing consented to (open).
      let stored = false;
      let duplicate = false;
      let contactId = null;
      if (contactList) {
        const result = await createContact(contactList, email);
        if (result.ok) {
          stored = true;
          contactId = email;
        } else if (result.type === 'AlreadyExistsException') {
          // Idempotent: the address is already in the list. Not a second row.
          stored = true;
          duplicate = true;
          contactId = email;
        } else {
          throw new ProviderError('contact_http_' + result.status, result.status);
        }
      }

      // 2. Promotional audience. Desired state, not append-only: consent present
      //    ensures membership, consent absent ensures *absence*, so a withdrawal
      //    at the second submission actually leaves the audience instead of
      //    being recorded while the address stays in the list a campaign reads.
      //    Membership itself is the gate: only a marketing-consented address can
      //    be in this list, and only a consented address is ever mailed from it.
      let promotional = false;
      if (promoList) {
        if (marketing) {
          const promo = await createContact(promoList, email);
          if (promo.ok || promo.type === 'AlreadyExistsException') {
            promotional = true;
          } else {
            throw new ProviderError(
              'promo_contact_http_' + promo.status,
              promo.status
            );
          }
        } else {
          const removal = await deleteContact(promoList, email);
          if (!removal.ok && !notFound(removal)) {
            throw new ProviderError(
              'promo_delete_http_' + removal.status,
              removal.status
            );
          }
          promotional = false;
        }
      }

      const contact = {
        stored,
        duplicate,
        contactId,
        marketing,
        promotional,
      };
      if (!stored) {
        // No transactional list configured, but the promotional audience (if
        // configured) was still reconciled above.
        contact.reason = 'no_contact_list';
      }
      return contact;
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
