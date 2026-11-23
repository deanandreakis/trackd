#!/usr/bin/env node
// Export the Trackd beta signup list from the AWS SES contact list as CSV.
//
// Usage:
//   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1 \
//     SES_CONTACT_LIST=trackd-beta node scripts/export-beta-signups.mjs > beta-signups.csv
//
// Optional:
//   AWS_ENDPOINT_URL_SES  full endpoint base URL override (falls back to
//                         AWS_ENDPOINT_URL, then email.<region>.amazonaws.com).
//                         Standard AWS SDK name; used by the tests to point the
//                         script at a local SES stub.
//
// The script pages through GET /v2/email/contact-lists/{list}/contacts with a
// hand-rolled SigV4 signature (netlify/lib/aws-sigv4.js) — the same signer the
// endpoint uses — so it needs no AWS SDK. Output columns:
//   email,created_at,unsubscribe_all

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { signRequest } = require('../netlify/lib/aws-sigv4.js');

const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const sessionToken = process.env.AWS_SESSION_TOKEN;
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
const contactList = process.env.SES_CONTACT_LIST;
const endpoint =
  process.env.AWS_ENDPOINT_URL_SES ||
  process.env.AWS_ENDPOINT_URL ||
  (region ? 'https://email.' + region + '.amazonaws.com' : null);
const endpointUrl = endpoint ? new URL(endpoint) : null;
const protocol = endpointUrl ? endpointUrl.protocol : 'https:';
const host = endpointUrl ? endpointUrl.host : null;

if (!accessKeyId || !secretAccessKey || !region || !contactList) {
  console.error(
    'Missing AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION or ' +
      'SES_CONTACT_LIST. Set all four and retry.'
  );
  process.exit(1);
}

const credentials = { accessKeyId, secretAccessKey, sessionToken };

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

async function page(nextToken) {
  const query = { PageSize: '100' };
  if (nextToken) query.NextToken = nextToken;

  const signed = signRequest({
    method: 'GET',
    host,
    pathSegments: ['v2', 'email', 'contact-lists', contactList, 'contacts'],
    query,
    headers: { 'content-type': 'application/json' },
    body: '',
    region,
    service: 'ses',
    credentials,
    date: new Date(),
  });

  const url =
    protocol +
    '//' +
    host +
    signed.canonicalPath +
    (signed.canonicalQuery ? '?' + signed.canonicalQuery : '');

  const headers = Object.assign({}, signed.headers);
  delete headers.host;

  const response = await fetch(url, { method: 'GET', headers });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (err) {
    throw new Error('SES returned non-JSON (HTTP ' + response.status + ')');
  }
  if (!response.ok) {
    throw new Error(
      'SES list-contacts failed (HTTP ' +
        response.status +
        '): ' +
        ((body && body.message) || 'unknown error')
    );
  }
  return body || {};
}

async function main() {
  const rows = [];
  let nextToken = null;

  for (;;) {
    const body = await page(nextToken);
    const contacts = Array.isArray(body.Contacts) ? body.Contacts : [];
    for (const contact of contacts) {
      rows.push([
        contact.EmailAddress,
        contact.CreatedTimestamp,
        contact.UnsubscribeAll === true ? 'true' : 'false',
      ]);
    }
    if (!body.NextToken || contacts.length === 0) break;
    nextToken = body.NextToken;
  }

  process.stdout.write('email,created_at,unsubscribe_all\n');
  for (const row of rows) {
    process.stdout.write(row.map(csvCell).join(',') + '\n');
  }
  console.error('Exported ' + rows.length + ' contact(s).');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
