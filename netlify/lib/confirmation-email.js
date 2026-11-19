'use strict';

// Confirmation email content for the Trackd beta signup.
//
// Shared by the JSON API endpoint (netlify/functions/beta-signup.js) and the
// legacy Netlify Forms event function (netlify/functions/submission-created.js)
// so the install instructions cannot drift between the two entry points.
//
// The download URL is the Chrome Web Store listing. Keep it in one place.

const INSTALL_URL =
  'https://chromewebstore.google.com/detail/lenaajfmejfgdjjdepbcnpakmakcbkgc';

const SUBJECT = "You're in: here's your Trackd install link";

const UNSUBSCRIBE_MAILTO =
  'mailto:trackd@deanware.com?subject=unsubscribe';

function textBody() {
  return [
    'Hi there,',
    '',
    'Thanks for signing up for early access to Trackd.',
    '',
    'Trackd is a Chrome extension that scans your Gmail for subscriptions. There is no bank login and no account to create. You connect Gmail, it looks for subscription emails, and it shows you what you are paying for.',
    '',
    'How to install:',
    '',
    '1. Open Chrome and make sure you are signed in with the same Google account whose email you signed up with.',
    '2. Open the Trackd listing in the Chrome Web Store:',
    '   ' + INSTALL_URL,
    '3. Click "Add to Chrome", then "Add extension".',
    '4. Pin Trackd: click the puzzle-piece icon in the toolbar and pin Trackd, then click the Trackd icon.',
    '5. Click "Connect Gmail". Chrome will ask for read-only access to your Gmail. Approve it, and the first scan runs on its own.',
    '',
    'The free tier tracks up to 10 subscriptions, which is plenty to see how it works.',
    '',
    'If the store link will not install for you, or the Gmail connect step keeps failing, reply to this email and tell me what you saw. I will sort it out with you directly.',
    '',
    'Thanks for helping us test.',
    '',
    'Trackd',
    '',
    '---',
    'You are receiving this because you signed up for Trackd early access at trackd.deanware.com.',
    'To unsubscribe, reply to this email with the word "unsubscribe" and we will remove your address.',
  ].join('\n');
}

function htmlBody() {
  const url = INSTALL_URL;
  return [
    '<p>Hi there,</p>',
    '<p>Thanks for signing up for early access to Trackd.</p>',
    '<p>Trackd is a Chrome extension that scans your Gmail for subscriptions. There is no bank login and no account to create. You connect Gmail, it looks for subscription emails, and it shows you what you are paying for.</p>',
    '<p><strong>How to install:</strong></p>',
    '<ol>',
    '<li>Open Chrome and make sure you are signed in with the same Google account whose email you signed up with.</li>',
    '<li>Open the Trackd listing in the Chrome Web Store: <a href="' + url + '">' + url + '</a></li>',
    '<li>Click &ldquo;Add to Chrome&rdquo;, then &ldquo;Add extension&rdquo;.</li>',
    '<li>Pin Trackd: click the puzzle-piece icon in the toolbar and pin Trackd, then click the Trackd icon.</li>',
    '<li>Click &ldquo;Connect Gmail&rdquo;. Chrome will ask for read-only access to your Gmail. Approve it, and the first scan runs on its own.</li>',
    '</ol>',
    '<p>The free tier tracks up to 10 subscriptions, which is plenty to see how it works.</p>',
    '<p>If the store link will not install for you, or the Gmail connect step keeps failing, reply to this email and tell me what you saw. I will sort it out with you directly.</p>',
    '<p>Thanks for helping us test.</p>',
    '<p>Trackd</p>',
    '<hr>',
    '<p style="font-size:12px;color:#6b7280;">You are receiving this because you signed up for Trackd early access at trackd.deanware.com. To unsubscribe, reply to this email with the word &ldquo;unsubscribe&rdquo; and we will remove your address.</p>',
  ].join('\n');
}

function buildConfirmation() {
  return {
    subject: SUBJECT,
    text: textBody(),
    html: htmlBody(),
    installUrl: INSTALL_URL,
    headers: {
      'List-Unsubscribe': '<' + UNSUBSCRIBE_MAILTO + '>',
    },
  };
}

module.exports = {
  INSTALL_URL,
  SUBJECT,
  buildConfirmation,
};
