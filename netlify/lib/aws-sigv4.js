'use strict';

// AWS Signature Version 4 (header signing), implemented on node:crypto alone.
//
// Why hand-rolled: the Netlify Function bundle deliberately avoids the AWS SDK
// (see netlify/lib/ses-provider.js). SigV4 is a fixed, fully specified algorithm
// — roughly a hundred lines — which is a smaller and more auditable dependency
// than @aws-sdk/client-sesv2 plus its credential providers.
//
// Correctness is not asserted on trust. tests/beta-signup.test.js cross-checks
// every signature this module produces against the official AWS signer
// (@smithy/signature-v4, a devDependency) and asserts byte-identical
// Authorization headers and signed-header lists. If the oracle is not installed
// the test reports a skip and says so; it never silently passes.
//
// The canonical request is built exactly as the AWS SDKs build it, including
// URI-encoding rules (unreserved = A-Za-z0-9-_.~, everything else percent-encoded
// with uppercase hex) and the `x-amz-content-sha256` payload-hash header.

const crypto = require('node:crypto');

const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TYPE = 'aws4_request';

// RFC 3986 unreserved set — the only characters SigV4 leaves unencoded. This is
// encodeURIComponent's set plus `!'()*`, which encodeURIComponent leaves alone
// but SigV4 requires to be encoded.
const UNRESERVED = /[A-Za-z0-9\-_.~]/;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest();
}

// Percent-encode one string. `keepSlash` leaves '/' intact (used for paths,
// where '/' separates segments and must survive).
function uriEncode(value, keepSlash) {
  let out = '';
  for (const ch of String(value)) {
    if (UNRESERVED.test(ch) || (keepSlash && ch === '/')) {
      out += ch;
    } else {
      for (const byte of Buffer.from(ch, 'utf8')) {
        out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
      }
    }
  }
  return out;
}

// AMZ date: 20261123T203830Z (no milliseconds).
function formatAmzDate(date) {
  return new Date(date)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

// Canonical URI: drop empty and '.' segments, resolve '..', then percent-encode
// the whole path and put the separators back.
function canonicalPath(path) {
  const raw = path == null ? '/' : String(path);
  const segments = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  const normalized =
    (raw.startsWith('/') ? '/' : '') +
    segments.join('/') +
    (segments.length > 0 && raw.endsWith('/') ? '/' : '');
  return uriEncode(normalized, true);
}

// Canonical URI built from pre-split segments. Use this when a segment value is
// caller data that may itself contain '/' (an email address in a SES contact
// path, for example): each segment is encoded independently, so the value can
// never be re-interpreted as a path separator and the '.'/'..' normalisation in
// canonicalPath cannot rewrite it.
function canonicalPathFromSegments(segments) {
  return '/' + segments.map((segment) => uriEncode(segment, false)).join('/');
}

// Canonical query string: keys and values percent-encoded, sorted by key then
// value, joined with '&'. Empty values are still emitted as `key=`.
function canonicalQuery(query) {
  const entries = [];
  for (const key of Object.keys(query || {})) {
    const value = query[key];
    if (value === undefined || value === null) continue;
    if (String(key).toLowerCase() === 'x-amz-signature') continue;
    entries.push([uriEncode(key, false), uriEncode(value, false)]);
  }
  entries.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return 0;
  });
  return entries.map(([k, v]) => k + '=' + v).join('&');
}

// Canonical headers: lower-cased names, values collapsed to single spaces and
// trimmed, sorted by name.
function canonicalHeaders(headers) {
  const canonical = {};
  for (const name of Object.keys(headers || {}).sort()) {
    const value = headers[name];
    if (value === undefined || value === null) continue;
    canonical[name.toLowerCase()] = String(value)
      .replace(/[\r\n]/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/^ | $/g, '');
  }
  return canonical;
}

// Derive the SigV4 signing key: HMAC chain over date, region, service, request
// type, starting from the secret access key.
function signingKey(secretAccessKey, shortDate, region, service) {
  return hmac(
    hmac(
      hmac(hmac('AWS4' + secretAccessKey, shortDate), region),
      service
    ),
    REQUEST_TYPE
  );
}

// Sign a request.
//
//   { method, host, path, query, headers, body, region, service,
//     credentials: { accessKeyId, secretAccessKey, sessionToken? }, date }
//
// Returns the headers to send (including `authorization`), the exact encoded
// path and query string to put on the wire, and the intermediate canonical
// request / string-to-sign for tests and debugging.
//
// Callers MUST build the outbound URL from the returned `canonicalPath` and
// `canonicalQuery`. Signing re-encodes whatever it is given, so passing a
// pre-encoded path would double-encode it and produce a signature that does not
// match the bytes on the wire.
function signRequest(options) {
  const opts = options || {};
  const credentials = opts.credentials || {};
  if (!credentials.accessKeyId || !credentials.secretAccessKey) {
    throw new Error('signRequest: credentials.accessKeyId and secretAccessKey are required');
  }

  const method = String(opts.method || 'POST').toUpperCase();
  const region = opts.region;
  const service = opts.service;
  if (!region) throw new Error('signRequest: region is required');
  if (!service) throw new Error('signRequest: service is required');

  const longDate = formatAmzDate(opts.date || new Date());
  const shortDate = longDate.slice(0, 8);

  const payload = opts.body == null ? '' : String(opts.body);
  const payloadHash = sha256Hex(payload);

  const headers = Object.assign({}, opts.headers);
  headers.host = opts.host;
  headers['x-amz-date'] = longDate;
  headers['x-amz-content-sha256'] = payloadHash;
  if (credentials.sessionToken) {
    headers['x-amz-security-token'] = credentials.sessionToken;
  }

  const path = opts.pathSegments
    ? canonicalPathFromSegments(opts.pathSegments)
    : canonicalPath(opts.path);
  const query = canonicalQuery(opts.query);

  const canonical = canonicalHeaders(headers);
  const names = Object.keys(canonical).sort();
  const scope = shortDate + '/' + region + '/' + service + '/' + REQUEST_TYPE;

  // Note the empty string: SigV4 puts a blank line between the canonical
  // headers block and the signed-header list.
  const canonicalRequest = [
    method,
    path,
    query,
    names.map((name) => name + ':' + canonical[name]).join('\n'),
    '',
    names.join(';'),
    payloadHash,
  ].join('\n');

  const stringToSign = [
    ALGORITHM,
    longDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = crypto
    .createHmac('sha256', signingKey(credentials.secretAccessKey, shortDate, region, service))
    .update(stringToSign, 'utf8')
    .digest('hex');

  const authorization =
    ALGORITHM +
    ' Credential=' +
    credentials.accessKeyId +
    '/' +
    scope +
    ', SignedHeaders=' +
    names.join(';') +
    ', Signature=' +
    signature;

  return {
    headers: Object.assign({}, headers, { authorization }),
    canonicalPath: path,
    canonicalQuery: query,
    canonicalRequest,
    stringToSign,
    signature,
    payloadHash,
    amzDate: longDate,
  };
}

module.exports = {
  ALGORITHM,
  signRequest,
  canonicalPath,
  canonicalPathFromSegments,
  canonicalQuery,
  canonicalHeaders,
  formatAmzDate,
  uriEncode,
  sha256Hex,
};
