// Netlify event function: runs once for every verified Netlify Forms submission.
//
// LEGACY PATH. The landing page now posts JSON to /api/beta-signup
// (netlify/functions/beta-signup.js). This function remains for the older
// Netlify Forms submission path (`form-name=trackd-test-group`) and for any
// Netlify Forms notification still configured on the site.
//
// It sends the same confirmation email as the API endpoint, using the shared
// copy in netlify/lib/confirmation-email.js so the install instructions cannot
// drift.
//
// Email transport: Resend (https://resend.com) via HTTPS. No SDK is used so the
// function needs no dependencies. Configure these Netlify environment variables:
//
//   RESEND_API_KEY     required — a Resend API key (re_...). Without it the
//                      function logs and returns 200 (the submission is still
//                      stored by Netlify Forms).
//   SIGNUP_FROM_EMAIL  optional — a verified sender on your Resend domain.
//                      Defaults to "Trackd <onboarding@resend.dev>", which only
//                      delivers to the account owner's own address. Set this to
//                      e.g. "Trackd <hello@deanware.com>" once the domain is
//                      verified in Resend.
//   SIGNUP_REPLY_TO    optional — reply-to address. Defaults to trackd@deanware.com.
//
// Idempotency: Netlify can retry an event, which would send a duplicate email.
// For a low-volume beta this is acceptable; the JSON API path has its own
// cooldown in Netlify Blobs.
//
// Privacy: the raw address is never written to logs; log lines carry a short
// HMAC prefix so a failed send can be correlated without storing PII.

const crypto = require('node:crypto');
const { buildConfirmation } = require('../lib/confirmation-email');

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
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // The address is already stored by Netlify Forms. Without an email key we
    // cannot send the confirmation, so log loudly and succeed.
    console.error(
      'submission-created: RESEND_API_KEY is not set; stored submission ' +
        payload.id +
        ' but did NOT send the confirmation email (emailHash ' +
        emailHash +
        ')'
    );
    return { statusCode: 200, body: 'stored, email skipped' };
  }

  const from =
    process.env.SIGNUP_FROM_EMAIL || 'Trackd <onboarding@resend.dev>';
  const replyTo = process.env.SIGNUP_REPLY_TO || 'trackd@deanware.com';
  const message = buildConfirmation();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: from,
      to: [email],
      reply_to: replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    }),
  });

  if (!res.ok) {
    console.error(
      'submission-created: Resend send failed (' +
        res.status +
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
