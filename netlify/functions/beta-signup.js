'use strict';

// POST /api/beta-signup — beta signup capture + confirmation email.
//
// Public URL:      https://trackd.deanware.com/api/beta-signup
// Implementation:  this Netlify Function. netlify.toml rewrites /api/beta-signup
//                  to /.netlify/functions/beta-signup with status 200 (the URL
//                  the browser sees stays /api/beta-signup).
//
// Request:  JSON { "email": string, "honeypot": string, "source": string,
//                  "beta_consent": boolean, "marketing_consent": boolean }
// Success:  200 { "status": "ok" }
// Failure:  400 { "status": "error", "message": string }   (validation / spam)
//           500 { "status": "error", "message": string }   (provider/storage)
//
// Storage (the list):
//   - Primary: an AWS SES contact list identified by SES_CONTACT_LIST. View or
//     export it in the AWS SES console (Configuration → Contact lists → the
//     list), via the AWS CLI (aws sesv2 list-contacts --contact-list-name ...)
//     or with scripts/export-beta-signups.mjs.
//   - Operational: Netlify Blobs store "beta-signups" (override with
//     SIGNUP_BLOBS_STORE). Holds only keyed records — rate-limit slots and a
//     hashed-email signup marker — so duplicate sends are suppressed without
//     keeping a second copy of the address. If SES_CONTACT_LIST is not set, the
//     record also carries the address so the signup is still durable.
//
// Email: AWS SES v2 REST API (https://email.<region>.amazonaws.com), signed with
//        SigV4 in netlify/lib/aws-sigv4.js. No AWS SDK.
//
// Required Netlify environment variables:
//   AWS_ACCESS_KEY_ID      IAM access key id
//   AWS_SECRET_ACCESS_KEY  IAM secret access key
//   AWS_REGION             SES region, e.g. us-east-1
//   SIGNUP_FROM_EMAIL      SES-verified sender, e.g. "Trackd <hello@deanware.com>"
//   SES_CONTACT_LIST       contact list that holds the beta list (recommended)
//   SES_PROMO_CONTACT_LIST optional promotional list; only contacts with an
//                          explicit marketing_consent are added to it
//   SIGNUP_REPLY_TO        optional, defaults to trackd@deanware.com
//   AWS_SESSION_TOKEN      optional, only for temporary credentials
//   AWS_ENDPOINT_URL_SES   optional endpoint override (tests/stubs)
//   SIGNUP_HASH_SALT       optional but recommended: secret used to HMAC emails/IPs
//                          before they become store keys or log values. Set once;
//                          changing it resets duplicate detection.
//   TRUST_FORWARDED_FOR    optional: set to "1"/"true" ONLY when a trusted proxy
//                          in front of this function sets X-Forwarded-For. The
//                          client IP otherwise comes solely from Netlify's
//                          edge-set x-nf-client-connection-ip header.
//
// The raw email address is never logged by this endpoint.

const { connectLambda, getStore } = require('@netlify/blobs');
const { createHandler } = require('../lib/beta-signup');
const { createSesProvider } = require('../lib/ses-provider');

let cachedStore = null;

function blobsStore() {
  if (!cachedStore) {
    cachedStore = getStore({
      name: process.env.SIGNUP_BLOBS_STORE || 'beta-signups',
      consistency: 'strong',
    });
  }
  return cachedStore;
}

// Thin adapter so the core handler only sees get/set/delete.
const store = {
  async get(key) {
    try {
      return await blobsStore().get(key, {
        type: 'json',
        consistency: 'strong',
      });
    } catch (err) {
      if (err && (err.status === 404 || err.statusCode === 404)) return null;
      throw err;
    }
  },
  async set(key, value, options) {
    return blobsStore().setJSON(key, value, options);
  },
  async delete(key) {
    return blobsStore().delete(key);
  },
};

const coreHandler = createHandler({
  store,
  provider: createSesProvider(),
});

// Classic Netlify Functions run in Lambda compatibility mode, where the Blobs
// credentials arrive in the invocation event. connectLambda must run before the
// first getStore() call. In local dev / non-Lambda runtimes the event has no
// blobs field, so a failure here is non-fatal and the SDK falls back to env.
exports.handler = async (event, context) => {
  try {
    connectLambda(event);
  } catch (err) {
    // Already configured, or not running in Lambda compatibility mode.
  }
  try {
    return await coreHandler(event, context);
  } catch (err) {
    // The core handler maps every expected failure to a typed response; this
    // catch is the last line of defence so an unforeseen throw cannot reach the
    // client as a platform error page carrying a stack trace or a path.
    // eslint-disable-next-line no-console
    console.error('beta-signup: unhandled handler error', {
      name: err && err.name ? err.name : 'Error',
    });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
      body: JSON.stringify({
        status: 'error',
        message: "We couldn't save your email just now. Please try again in a minute.",
      }),
    };
  }
};
