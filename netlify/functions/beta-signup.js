'use strict';

// POST /api/beta-signup — beta signup capture + confirmation email.
//
// Public URL:      https://trackd.deanware.com/api/beta-signup
// Implementation:  this Netlify Function. netlify.toml rewrites /api/beta-signup
//                  to /.netlify/functions/beta-signup with status 200 (the URL
//                  the browser sees stays /api/beta-signup).
//
// Request:  JSON { "email": string, "honeypot": string, "source": string }
// Success:  200 { "status": "ok" }
// Failure:  400 { "status": "error", "message": string }   (validation / spam)
//           500 { "status": "error", "message": string }   (provider/storage)
//
// Storage (the list):
//   - Primary: Resend Audience identified by RESEND_AUDIENCE_ID. View/export in
//     the Resend dashboard (Audiences → the configured audience → Contacts).
//   - Operational: Netlify Blobs store "beta-signups" (override with
//     SIGNUP_BLOBS_STORE). Holds only keyed records — rate-limit slots and a
//     hashed-email signup marker — so duplicate sends are suppressed without
//     keeping a second copy of the address. If RESEND_AUDIENCE_ID is not set,
//     the record also carries the address so the signup is still durable.
//
// Email: Resend HTTP API (https://api.resend.com/emails), no SDK.
//
// Required Netlify environment variables:
//   RESEND_API_KEY       re_... key
//   RESEND_AUDIENCE_ID   audience that holds the beta list
//   SIGNUP_FROM_EMAIL    verified sender, e.g. "Trackd <hello@deanware.com>"
//   SIGNUP_REPLY_TO      optional, defaults to trackd@deanware.com
//   SIGNUP_HASH_SALT     optional but recommended: secret used to HMAC emails/IPs
//                        before they become store keys or log values. Set once;
//                        changing it resets duplicate detection.
//
// The raw email address is never logged by this endpoint.

const { connectLambda, getStore } = require('@netlify/blobs');
const { createHandler } = require('../lib/beta-signup');
const { createResendProvider } = require('../lib/resend-provider');

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
  provider: createResendProvider(),
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
  return coreHandler(event, context);
};
