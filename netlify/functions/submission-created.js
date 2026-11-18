// Netlify event function: runs once for every verified Netlify Forms submission.
//
// The public signup form on trackd.deanware.com posts to the Netlify Forms
// endpoint ("/" with form-name=trackd-test-group). Netlify:
//   1. stores the submission (Forms > trackd-test-group in the Netlify UI), and
//   2. fires this `submission-created` function.
//
// This function sends the beta confirmation email containing the Chrome
// extension install instructions to the address the visitor submitted.
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
// For a low-volume beta this is acceptable; add a processed-submission-ID store
// (e.g. @netlify/blobs) if duplicate sends ever matter.

const INSTALL_URL =
  "https://chromewebstore.google.com/detail/lenaajfmejfgdjjdepbcnpakmakcbkgc";
const FORM_NAME = "trackd-test-group";

const SUBJECT = "You're in: here's your Trackd install link";

function textBody() {
  return [
    "Hi there,",
    "",
    "Thanks for signing up for early access to Trackd.",
    "",
    "Trackd is a Chrome extension that scans your Gmail for subscriptions. There is no bank login and no account to create. You connect Gmail, it looks for subscription emails, and it shows you what you are paying for.",
    "",
    "Two things to check before you install:",
    "",
    "1. Open Chrome and make sure you are signed in with the same Google account whose email you signed up with.",
    "",
    "2. Install Trackd here:",
    "   " + INSTALL_URL,
    "",
    'Once it is installed, click the Trackd icon in your toolbar and then click "Connect Gmail". Chrome will ask for read-only access to your Gmail. Approve it, and the first scan runs on its own.',
    "",
    "The free tier tracks up to 10 subscriptions, which is plenty to see how it works.",
    "",
    "If the store link will not install for you, or the Gmail connect step keeps failing, reply to this email and tell me what you saw. I will sort it out with you directly.",
    "",
    "Thanks for helping us test.",
    "",
    "Trackd",
    "",
    "---",
    "You are receiving this because you signed up for Trackd early access at trackd.deanware.com.",
    'To unsubscribe, reply to this email with the word "unsubscribe" and we will remove your address.',
  ].join("\n");
}

function htmlBody() {
  return [
    "<p>Hi there,</p>",
    "<p>Thanks for signing up for early access to Trackd.</p>",
    "<p>Trackd is a Chrome extension that scans your Gmail for subscriptions. There is no bank login and no account to create. You connect Gmail, it looks for subscription emails, and it shows you what you are paying for.</p>",
    "<p><strong>Two things to check before you install:</strong></p>",
    "<ol>",
    "<li>Open Chrome and make sure you are signed in with the same Google account whose email you signed up with.</li>",
    "<li>Install Trackd here: <a href=\"" +
      INSTALL_URL +
      "\">" +
      INSTALL_URL +
      "</a></li>",
    "</ol>",
    "<p>Once it is installed, click the Trackd icon in your toolbar and then click &ldquo;Connect Gmail&rdquo;. Chrome will ask for read-only access to your Gmail. Approve it, and the first scan runs on its own.</p>",
    "<p>The free tier tracks up to 10 subscriptions, which is plenty to see how it works.</p>",
    "<p>If the store link will not install for you, or the Gmail connect step keeps failing, reply to this email and tell me what you saw. I will sort it out with you directly.</p>",
    "<p>Thanks for helping us test.</p>",
    "<p>Trackd</p>",
    "<hr>",
    "<p style=\"font-size:12px;color:#6b7280;\">You are receiving this because you signed up for Trackd early access at trackd.deanware.com. To unsubscribe, reply to this email with the word &ldquo;unsubscribe&rdquo; and we will remove your address.</p>",
  ].join("\n");
}

exports.handler = async (event) => {
  let payload;
  try {
    payload = JSON.parse(event.body).payload;
  } catch (err) {
    console.error("submission-created: could not parse body", err);
    return { statusCode: 400, body: "bad payload" };
  }

  // Only handle the beta signup form; ignore any other forms on the site.
  if (payload.form_name !== FORM_NAME) {
    return { statusCode: 200, body: "ignored" };
  }

  const email = payload.data && payload.data.email;
  if (!email) {
    console.error("submission-created: no email in payload", payload.id);
    return { statusCode: 200, body: "no email" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // The address is already stored by Netlify Forms. Without an email key we
    // cannot send the confirmation, so log loudly and succeed.
    console.error(
      "submission-created: RESEND_API_KEY is not set; stored submission " +
        payload.id +
        " but did NOT send the confirmation email to " +
        email
    );
    return { statusCode: 200, body: "stored, email skipped" };
  }

  const from =
    process.env.SIGNUP_FROM_EMAIL || "Trackd <onboarding@resend.dev>";
  const replyTo = process.env.SIGNUP_REPLY_TO || "trackd@deanware.com";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: from,
      to: [email],
      reply_to: replyTo,
      subject: SUBJECT,
      text: textBody(),
      html: htmlBody(),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(
      "submission-created: Resend send failed (" +
        res.status +
        ") for " +
        email +
        ": " +
        detail
    );
    // Still 200: the submission is stored, and a retry would just fail again.
    return { statusCode: 200, body: "send failed" };
  }

  console.log("submission-created: confirmation email sent to " + email);
  return { statusCode: 200, body: "sent" };
};
