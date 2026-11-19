#!/usr/bin/env node
// Export the Trackd beta signup list from the Resend Audience as CSV.
//
// Usage:
//   RESEND_API_KEY=re_... RESEND_AUDIENCE_ID=... node scripts/export-beta-signups.mjs > beta-signups.csv
//
// Optional:
//   RESEND_API_BASE  defaults to https://api.resend.com
//
// The endpoint pages through GET /audiences/{id}/contacts. Output columns:
// email,created_at,unsubscribed

const apiKey = process.env.RESEND_API_KEY;
const audienceId = process.env.RESEND_AUDIENCE_ID;
const base = process.env.RESEND_API_BASE || 'https://api.resend.com';

if (!apiKey || !audienceId) {
  console.error(
    'Missing RESEND_API_KEY or RESEND_AUDIENCE_ID. Set both and retry.'
  );
  process.exit(1);
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

async function page(after) {
  const url = new URL(
    base + '/audiences/' + encodeURIComponent(audienceId) + '/contacts'
  );
  url.searchParams.set('limit', '100');
  if (after) url.searchParams.set('after', after);

  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + apiKey },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (err) {
    throw new Error('Resend returned non-JSON (HTTP ' + response.status + ')');
  }
  if (!response.ok) {
    throw new Error(
      'Resend list failed (HTTP ' +
        response.status +
        '): ' +
        (body && body.message ? body.message : 'unknown error')
    );
  }
  return body;
}

async function main() {
  const rows = [];
  let after = null;

  for (;;) {
    const body = await page(after);
    const contacts = Array.isArray(body.data) ? body.data : [];
    for (const contact of contacts) {
      rows.push([
        contact.email,
        contact.created_at,
        contact.unsubscribed === true ? 'true' : 'false',
      ]);
    }
    if (!body.has_more || contacts.length === 0) break;
    after = contacts[contacts.length - 1].id;
    if (!after) break;
  }

  process.stdout.write('email,created_at,unsubscribed\n');
  for (const row of rows) {
    process.stdout.write(row.map(csvCell).join(',') + '\n');
  }
  console.error('Exported ' + rows.length + ' contact(s).');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
