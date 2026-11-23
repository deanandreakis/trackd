// Netlify event function: runs once for every verified Netlify Forms submission.
//
// LEGACY PATH. The landing page now posts JSON to /api/beta-signup
// (netlify/functions/beta-signup.js). This function remains for the older
// Netlify Forms submission path (`form-name=trackd-test-group`) and for any
// Netlify Forms notification still configured on the site.
//
// It sends the same confirmation email as the API endpoint, using the shared
// copy in netlify/lib/confirmation-email.js and the shared SES transport in
// netlify/lib/ses-provider.js, so neither the install instructions nor the
// provider configuration can drift between the two entry points.
//
// Email transport: AWS SES v2, SigV4-signed with netlify/lib/aws-sigv4.js. No
// AWS SDK, so the function needs no extra dependencies. Configure the same
// Netlify environment variables as the JSON API:
//
//   AWS_ACCESS_KEY_ID      IAM access key id
//   AWS_SECRET_ACCESS_KEY  IAM secret access key
//   AWS_REGION             SES region, e.g. us-east-1
//   SIGNUP_FROM_EMAIL      SES-verified sender, e.g. "Trackd <hello@deanware.com>".
//                          Without the credentials or the sender this function
//                          logs and returns 200 (the submission is still stored
//                          by Netlify Forms).
//   SIGNUP_REPLY_TO        optional — reply-to address. Defaults to trackd@deanware.com.
//   AWS_SESSION_TOKEN      optional — only for temporary credentials
//   AWS_ENDPOINT_URL_SES   optional endpoint override (tests/stubs)
//
// This path does not write to the SES contact list; the legacy Netlify Forms
// store already holds the address. Only the JSON API adds contacts.
//
// Idempotency: Netlify can retry an event, which would send a duplicate email.
// For a low-volume beta this is acceptable; the JSON API path has its own
// cooldown in Netlify Blobs.
//
// Privacy: the raw address is never written to logs; log lines carry a short
// HMAC prefix so a failed send can be correlated without storing PII.

const crypto = require('node:crypto');
const { createSesProvider } = require('../lib/ses-provider');

const FORM_NAME = 'trackd-test-group';

function digest(value) {
  const salt = process.env.SIGNUP_HASH_SALT || 'trackd-beta-signup-v1';
  return crypto.createHmac('sha256', salt).update(String(value)).digest('hex');
}

exports.handler = async (event) => {
  let payload;
  try {
    payload = JSON.parse(event.body).payload;
  } catch (err) {
    console.error('submission-created: could not parse body');
    return { statusCode: 400, body: 'bad payload' };
  }

  // Only handle the beta signup form; ignore any other forms on the site.
  if (payload.form_name !== FORM_NAME) {
    return { statusCode: 200, body: 'ignored' };
  }

  const email = payload.data && payload.data.email;
  if (!email) {
    console.error('submission-created: no email in payload', payload.id);
    return { statusCode: 200, body: 'no email' };
  }

  const emailHash = digest(email).slice(0, 12);
  const provider = createSesProvider();
  if (!provider.ready) {
    // The address is already stored by Netlify Forms. Without SES credentials
    // and a verified sender we cannot send the confirmation, so log loudly and
    // succeed.
    console.error(
      'submission-created: SES is not configured (AWS_ACCESS_KEY_ID / ' +
        'AWS_SECRET_ACCESS_KEY / SIGNUP_FROM_EMAIL); stored submission ' +
        payload.id +
        ' but did NOT send the confirmation email (emailHash ' +
        emailHash +
        ')'
    );
    return { statusCode: 200, body: 'stored, email skipped' };
  }

  try {
    await provider.sendConfirmation(email);
  } catch (err) {
    console.error(
      'submission-created: SES send failed (' +
        (err && err.code ? err.code : 'error') +
        ') for emailHash ' +
        emailHash
    );
    // Still 200: the submission is stored, and a retry would just fail again.
    return { statusCode: 200, body: 'send failed' };
  }

  console.log(
    'submission-created: confirmation email sent (emailHash ' + emailHash + ')'
  );
  return { statusCode: 200, body: 'sent' };
};
