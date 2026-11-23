'use strict';

// Confirmation email content for the Trackd beta signup, plus the install copy.
//
// Shared by the JSON API endpoint (netlify/lib/signup-service.js, via
// netlify/lib/ses-provider.js) and the legacy Netlify Forms event function
// (netlify/functions/submission-created.js) so the install instructions cannot
// drift between the two entry points.
//
// Everything a non-engineer might need to change — the download URL, the
// subject line, and the numbered install steps — is read from the environment
// so it can change without a code edit. Defaults reproduce the shipped copy.
//
//   EXTENSION_DOWNLOAD_URL   the Chrome Web Store listing URL
//                            (default: the Trackd listing below)
//   SIGNUP_EMAIL_SUBJECT     the subject line
//   SIGNUP_INSTALL_STEPS     newline-separated steps that REPLACE the default
//                            five. Use the literal token {url} anywhere a step
//                            should interpolate EXTENSION_DOWNLOAD_URL.
//
// The address is never part of the message template.

const DEFAULT_INSTALL_URL =
  'https://chromewebstore.google.com/detail/lenaajfmejfgdjjdepbcnpakmakcbkgc';

const DEFAULT_SUBJECT = "You're in: here's your Trackd install link";

const UNSUBSCRIBE_MAILTO = 'mailto:trackd@deanware.com?subject=unsubscribe';

// Step text with a {url} placeholder where the download link goes. Numbering is
// applied at render time so the configured steps are always 1..N.
const DEFAULT_STEPS = [
  'Open Chrome and make sure you are signed in with the same Google account whose email you signed up with.',
  'Open the Trackd listing in the Chrome Web Store: {url}',
  'Click "Add to Chrome", then "Add extension".',
  'Pin Trackd: click the puzzle-piece icon in the toolbar and pin Trackd, then click the Trackd icon.',
  'Click "Connect Gmail". Chrome will ask for read-only access to your Gmail. Approve it, and the first scan runs on its own.',
];

function resolveConfig(env) {
  const e = env || {};
  const url =
    (typeof e.EXTENSION_DOWNLOAD_URL === 'string' &&
      e.EXTENSION_DOWNLOAD_URL.trim()) ||
    DEFAULT_INSTALL_URL;
  const subject =
    (typeof e.SIGNUP_EMAIL_SUBJECT === 'string' &&
      e.SIGNUP_EMAIL_SUBJECT.trim()) ||
    DEFAULT_SUBJECT;

  const rawSteps = e.SIGNUP_INSTALL_STEPS;
  const steps =
    typeof rawSteps === 'string' && rawSteps.trim()
      ? rawSteps
          .split('\n')
          .map((line) => line.trim().replace(/^\d+[.)]\s*/, ''))
          .filter(Boolean)
      : DEFAULT_STEPS.slice();

  return {
    url,
    subject,
    steps: steps.map((step) => step.split('{url}').join(url)),
  };
}

function textBody(config) {
  const numbered = config.steps.map((step, i) => i + 1 + '. ' + step);
  return [
    'Hi there,',
    '',
    'Thanks for signing up for early access to Trackd.',
    '',
    'Trackd is a Chrome extension that scans your Gmail for subscriptions. There is no bank login and no account to create. You connect Gmail, it looks for subscription emails, and it shows you what you are paying for.',
    '',
    'How to install:',
    '',
  ]
    .concat(numbered)
    .concat([
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
    ])
    .join('\n');
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlStep(step, url) {
  const escaped = escapeHtml(step);
  // Turn the interpolated URL into a real link. The URL is a known config
  // value, not user input, but escape it for the href as well.
  const link = '<a href="' + escapeHtml(url) + '">' + escapeHtml(url) + '</a>';
  return escaped.split(escapeHtml(url)).join(link);
}

function htmlBody(config) {
  const items = config.steps
    .map((step) => '<li>' + htmlStep(step, config.url) + '</li>')
    .join('\n');
  return [
    '<p>Hi there,</p>',
    '<p>Thanks for signing up for early access to Trackd.</p>',
    '<p>Trackd is a Chrome extension that scans your Gmail for subscriptions. There is no bank login and no account to create. You connect Gmail, it looks for subscription emails, and it shows you what you are paying for.</p>',
    '<p><strong>How to install:</strong></p>',
    '<ol>',
    items,
    '</ol>',
    '<p>The free tier tracks up to 10 subscriptions, which is plenty to see how it works.</p>',
    '<p>If the store link will not install for you, or the Gmail connect step keeps failing, reply to this email and tell me what you saw. I will sort it out with you directly.</p>',
    '<p>Thanks for helping us test.</p>',
    '<p>Trackd</p>',
    '<hr>',
    '<p style="font-size:12px;color:#6b7280;">You are receiving this because you signed up for Trackd early access at trackd.deanware.com. To unsubscribe, reply to this email with the word &ldquo;unsubscribe&rdquo; and we will remove your address.</p>',
  ].join('\n');
}

// buildConfirmation(env) — env is optional; when omitted the shipped defaults
// are used, so `buildConfirmation()` is stable for callers that do not thread
// configuration through.
function buildConfirmation(env) {
  const config = resolveConfig(env);
  return {
    subject: config.subject,
    text: textBody(config),
    html: htmlBody(config),
    installUrl: config.url,
    steps: config.steps,
    headers: {
      'List-Unsubscribe': '<' + UNSUBSCRIBE_MAILTO + '>',
    },
  };
}

module.exports = {
  INSTALL_URL: DEFAULT_INSTALL_URL,
  SUBJECT: DEFAULT_SUBJECT,
  DEFAULT_STEPS,
  buildConfirmation,
};
