'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { createHandler } = require('../netlify/lib/beta-signup');
const { buildConfirmation, INSTALL_URL } = require('../netlify/lib/confirmation-email');
const { createSesProvider } = require('../netlify/lib/ses-provider');
const { signRequest } = require('../netlify/lib/aws-sigv4');

// The official AWS signer, used as an oracle. It is a devDependency: production
// code never loads it. When it is not installed the tests that depend on it
// report a skip instead of passing quietly.
let oracle = null;
try {
  oracle = {
    SignatureV4: require('@smithy/signature-v4').SignatureV4,
    HttpRequest: require('@smithy/protocol-http').HttpRequest,
  };
} catch (err) {
  oracle = null;
}

// Minimal Hash constructor shim for the oracle (it wants a WebCrypto-style
// constructor: new Hash(secret) for HMAC, new Hash() for a plain digest).
class Sha256 {
  constructor(key) {
    this.h = key ? crypto.createHmac('sha256', key) : crypto.createHash('sha256');
  }
  update(data) {
    this.h.update(data);
    return this;
  }
  async digest() {
    return this.h.digest();
  }
}

async function oracleAuthorization(options) {
  const signer = new oracle.SignatureV4({
    credentials: options.credentials,
    region: options.region,
    service: 'ses',
    sha256: Sha256,
  });
  const request = new oracle.HttpRequest({
    method: options.method,
    protocol: options.protocol || 'https:',
    hostname: options.hostname,
    port: options.port,
    path: options.path,
    query: options.query || {},
    headers: Object.assign({ host: options.host }, options.headers || {}),
    body: options.body === '' || options.body == null ? undefined : options.body,
  });
  const signed = await signer.sign(request, { signingDate: options.date });
  return signed.headers.authorization;
}

function amzDateToDate(amzDate) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
  if (!m) throw new Error('bad x-amz-date: ' + amzDate);
  return new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6])
    )
  );
}

const ENV = {
  RATE_LIMIT_MAX: '3',
  RATE_LIMIT_WINDOW_SECONDS: '600',
  SIGNUP_RESEND_COOLDOWN_SECONDS: '86400',
  SIGNUP_HASH_SALT: 'test-salt',
};

function memoryStore() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return map.has(key) ? JSON.parse(JSON.stringify(map.get(key))) : null;
    },
    async set(key, value, options) {
      const opts = options || {};
      if (opts.onlyIfNew && map.has(key)) return { modified: false };
      map.set(key, JSON.parse(JSON.stringify(value)));
      return { modified: true, etag: 'etag-' + map.size };
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

function fakeProvider(initial) {
  const state = Object.assign({ failAdd: false, failSend: false }, initial);
  const contacts = new Set();
  const sends = [];
  return {
    state,
    contacts,
    sends,
    ready: true,
    audienceConfigured: true,
    async addContact(email) {
      if (state.failAdd) {
        throw Object.assign(new Error('contact list down'), { code: 'contact_http_500' });
      }
      const duplicate = contacts.has(email);
      contacts.add(email);
      return { stored: true, duplicate, contactId: email };
    },
    async sendConfirmation(email) {
      if (state.failSend) {
        throw Object.assign(new Error('email down'), { code: 'email_http_500' });
      }
      sends.push(email);
      return { id: 'mail-' + sends.length };
    },
  };
}

function event(body, options) {
  const opts = options || {};
  return {
    httpMethod: opts.method || 'POST',
    headers: Object.assign(
      {
        'content-type': opts.contentType || 'application/json',
        'x-nf-client-connection-ip': opts.ip || '127.0.0.1',
      },
      opts.headers || {}
    ),
    body: typeof body === 'string' ? body : JSON.stringify(body),
    isBase64Encoded: Boolean(opts.isBase64Encoded),
  };
}

function setup(overrides) {
  const opts = overrides || {};
  const store = opts.store || memoryStore();
  const provider = opts.provider || fakeProvider();
  const logs = [];
  const logger = {
    log: (...args) => logs.push(args),
    error: (...args) => logs.push(args),
  };
  const clock = opts.clock || { ms: 1_700_000_000_000 };
  const handler = createHandler({
    store,
    provider,
    logger,
    env: ENV,
    now: () => clock.ms,
    getClientIp: opts.getClientIp,
  });
  return { handler, store, provider, logs, clock };
}

async function call(handler, body, options) {
  const response = await handler(event(body, options));
  let json = null;
  try {
    json = JSON.parse(response.body);
  } catch (err) {
    json = null;
  }
  return { response, json };
}

test('valid signup returns 200, stores the contact and sends the email', async () => {
  const { handler, store, provider } = setup();
  const { response, json } = await call(handler, {
    email: '  Alice@Example.COM ',
    honeypot: '',
    source: 'homepage-hero',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(json, { status: 'ok' });
  assert.equal(provider.contacts.size, 1);
  assert.ok(provider.contacts.has('alice@example.com'));
  assert.equal(provider.sends.length, 1);
  assert.equal(provider.sends[0], 'alice@example.com');

  const signupKeys = [...store.map.keys()].filter((k) => k.startsWith('signup:'));
  assert.equal(signupKeys.length, 1);
  const record = store.map.get(signupKeys[0]);
  assert.equal(record.source, 'homepage-hero');
  assert.equal(record.audience, true);
  assert.equal(record.email, undefined, 'the list holds the address');
});

test('invalid email returns 400 and stores nothing', async () => {
  const { handler, store, provider } = setup();
  for (const email of ['', 'not-an-email', 'a@b', 'a@.com', 'a..b@example.com', 42]) {
    const { response, json } = await call(handler, { email, honeypot: '', source: 'x' });
    assert.equal(response.statusCode, 400, String(email));
    assert.equal(json.status, 'error');
    assert.match(json.message, /valid email/i);
  }
  assert.equal(store.map.size, 0);
  assert.equal(provider.contacts.size, 0);
  assert.equal(provider.sends.length, 0);
});

test('filled honeypot returns 400 and stores nothing', async () => {
  const { handler, store, provider } = setup();
  const { response, json } = await call(handler, {
    email: 'real@example.com',
    honeypot: 'http://spam.example',
    source: 'homepage-hero',
  });
  assert.equal(response.statusCode, 400);
  assert.equal(json.status, 'error');
  assert.equal(store.map.size, 0);
  assert.equal(provider.contacts.size, 0);
  assert.equal(provider.sends.length, 0);
});

test('duplicate within the cooldown is idempotent: one row, one email', async () => {
  const { handler, provider } = setup();
  await call(handler, { email: 'dup@example.com', honeypot: '', source: 'hero' });
  const second = await call(handler, { email: 'DUP@example.com', honeypot: '', source: 'hero' });

  assert.equal(second.response.statusCode, 200);
  assert.deepEqual(second.json, { status: 'ok' });
  assert.equal(provider.contacts.size, 1);
  assert.equal(provider.sends.length, 1);
});

test('duplicate after the cooldown sends again without storing twice', async () => {
  const { handler, provider, clock } = setup();
  await call(handler, { email: 'again@example.com', honeypot: '', source: 'hero' });
  clock.ms += 25 * 60 * 60 * 1000;
  const second = await call(handler, { email: 'again@example.com', honeypot: '', source: 'hero' });

  assert.equal(second.response.statusCode, 200);
  assert.equal(provider.contacts.size, 1);
  assert.equal(provider.sends.length, 2);
});

test('per-IP rate limit rejects the request after the configured slots', async () => {
  const { handler, provider } = setup();
  for (let i = 0; i < 3; i += 1) {
    const ok = await call(handler, {
      email: 'user' + i + '@example.com',
      honeypot: '',
      source: 'hero',
    });
    assert.equal(ok.response.statusCode, 200);
  }
  const blocked = await call(handler, {
    email: 'user4@example.com',
    honeypot: '',
    source: 'hero',
  });
  assert.equal(blocked.response.statusCode, 400);
  assert.match(blocked.json.message, /too many/i);
  assert.equal(provider.contacts.size, 3);
  assert.equal(provider.sends.length, 3);
});

test('a different IP is not blocked by another IP bucket', async () => {
  const { handler } = setup();
  for (let i = 0; i < 3; i += 1) {
    await call(handler, { email: 'a' + i + '@example.com', honeypot: '', source: 'x' }, { ip: '203.0.113.7' });
  }
  const other = await call(handler, { email: 'other@example.com', honeypot: '', source: 'x' }, { ip: '198.51.100.9' });
  assert.equal(other.response.statusCode, 200);
});

test('provider failure returns a generic 500 without leaking internals', async () => {
  const provider = fakeProvider({ failAdd: true });
  const { handler } = setup({ provider });
  const { response, json } = await call(handler, {
    email: 'fail@example.com',
    honeypot: '',
    source: 'hero',
  });
  assert.equal(response.statusCode, 500);
  assert.equal(json.status, 'error');
  assert.doesNotMatch(json.message, /contact|ses|amazon|aws|resend|500|stack/i);
  assert.equal(provider.sends.length, 0);
});

test('send failure returns 500; a retry sends without storing twice', async () => {
  const provider = fakeProvider({ failSend: true });
  const { handler } = setup({ provider });
  const first = await call(handler, { email: 'retry@example.com', honeypot: '', source: 'hero' });
  assert.equal(first.response.statusCode, 500);

  provider.state.failSend = false;
  const second = await call(handler, { email: 'retry@example.com', honeypot: '', source: 'hero' });
  assert.equal(second.response.statusCode, 200);
  assert.equal(provider.contacts.size, 1);
  assert.equal(provider.sends.length, 1);
});

test('malformed JSON and wrong content type are 400s', async () => {
  const { handler, store } = setup();
  const bad = await call(handler, '{not json');
  assert.equal(bad.response.statusCode, 400);
  const wrongType = await call(handler, { email: 'x@example.com', honeypot: '', source: 'x' }, { contentType: 'text/plain' });
  assert.equal(wrongType.response.statusCode, 400);
  assert.equal(store.map.size, 0);
});

test('non-POST is 405 with an Allow header', async () => {
  const { handler } = setup();
  const response = await handler(event({}, { method: 'GET' }));
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'POST');
});

test('raw email never appears in logs', async () => {
  const { handler, logs } = setup();
  await call(handler, { email: 'private.person@example.com', honeypot: '', source: 'hero' });
  const serialized = JSON.stringify(logs);
  assert.ok(serialized.length > 0);
  assert.doesNotMatch(serialized, /private\.person@example\.com/i);
  assert.doesNotMatch(serialized, /private\.person/i);
});

test('oversized body is rejected before storage', async () => {
  const { handler, store } = setup();
  const big = JSON.stringify({
    email: 'big@example.com',
    honeypot: '',
    source: 'x'.repeat(3000),
  });
  const { response } = await call(handler, big);
  assert.equal(response.statusCode, 400);
  assert.equal(store.map.size, 0);
});

test('confirmation email contains the install URL and numbered steps', () => {
  const message = buildConfirmation();
  assert.ok(message.text.includes(INSTALL_URL));
  assert.ok(message.html.includes(INSTALL_URL));
  assert.match(message.text, /1\. Open Chrome/);
  assert.match(message.text, /2\. Open the Trackd listing/);
  assert.match(message.text, /3\. Click "Add to Chrome"/);
  assert.match(message.text, /5\. Click "Connect Gmail"/);
  assert.equal(message.subject, "You're in: here's your Trackd install link");
});

// ---------------------------------------------------------------------------
// SigV4 signer
// ---------------------------------------------------------------------------

test('SigV4 signer matches the official AWS signer byte for byte', async (t) => {
  if (!oracle) {
    t.skip('@smithy/signature-v4 is not installed (run npm install); the official-signer oracle did not run');
    return;
  }

  const credentials = {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  };
  const date = new Date('2026-11-23T20:38:30Z');

  const cases = [
    {
      name: 'send email',
      method: 'POST',
      host: 'email.us-east-1.amazonaws.com',
      region: 'us-east-1',
      path: '/v2/email/outbound-emails',
      query: {},
      body: JSON.stringify({
        FromEmailAddress: 'Trackd <hello@deanware.com>',
        Destination: { ToAddresses: ['a@example.com'] },
      }),
    },
    {
      name: 'create contact with + and @ in the path',
      method: 'PUT',
      host: 'email.eu-west-1.amazonaws.com',
      region: 'eu-west-1',
      path: '/v2/email/contact-lists/trackd-beta/contacts/alice+tag@example.com',
      query: {},
      body: JSON.stringify({ UnsubscribeAll: false }),
    },
    {
      name: 'list contacts with an encoded query',
      method: 'GET',
      host: 'email.us-east-1.amazonaws.com',
      region: 'us-east-1',
      path: '/v2/email/contact-lists/trackd beta/contacts',
      query: { PageSize: '100', NextToken: 'abc+/= xyz' },
      body: '',
    },
    {
      name: 'path normalisation edge cases',
      method: 'PUT',
      host: 'email.us-east-1.amazonaws.com',
      region: 'us-east-1',
      path: '//v2/email//contact-lists//a.b~c_d-e/contacts/',
      query: {},
      body: '',
    },
    {
      name: 'temporary credentials carry the security token',
      method: 'POST',
      host: 'email.us-east-1.amazonaws.com',
      region: 'us-east-1',
      path: '/v2/email/outbound-emails',
      query: {},
      body: '{"a":1}',
      sessionToken: 'FQoGZXIvYXdzEBYaDEXAMPLE',
    },
  ];

  for (const c of cases) {
    const creds = Object.assign({}, credentials, { sessionToken: c.sessionToken });
    const mine = signRequest({
      method: c.method,
      host: c.host,
      path: c.path,
      query: c.query,
      headers: { 'content-type': 'application/json' },
      body: c.body,
      region: c.region,
      service: 'ses',
      credentials: creds,
      date,
    });
    const theirs = await oracleAuthorization({
      method: c.method,
      host: c.host,
      hostname: c.host,
      path: c.path,
      query: c.query,
      headers: { 'content-type': 'application/json' },
      body: c.body,
      region: c.region,
      credentials: creds,
      date,
    });
    assert.equal(mine.headers.authorization, theirs, c.name);
  }
});

test('SigV4 signer percent-encodes path segments independently', () => {
  // An email containing '/' or '..' must stay one segment; it can never be
  // re-interpreted as path structure or traversal.
  const signed = signRequest({
    method: 'PUT',
    host: 'email.us-east-1.amazonaws.com',
    pathSegments: ['v2', 'email', 'contact-lists', 'beta', 'contacts', 'a/../b@example.com'],
    query: {},
    headers: {},
    body: '',
    region: 'us-east-1',
    service: 'ses',
    credentials: { accessKeyId: 'A', secretAccessKey: 'S' },
    date: new Date('2026-11-23T20:38:30Z'),
  });
  assert.equal(
    signed.canonicalPath,
    '/v2/email/contact-lists/beta/contacts/a%2F..%2Fb%40example.com'
  );
});

// ---------------------------------------------------------------------------
// SES provider
// ---------------------------------------------------------------------------

function sesResponse(status, body, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers || {}),
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body || {});
    },
  };
}

const SES_ENV = {
  AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  AWS_REGION: 'us-east-1',
  SIGNUP_FROM_EMAIL: 'Trackd <hello@example.com>',
  SES_CONTACT_LIST: 'trackd-beta',
};

test('SES provider: SendEmail shape, install instructions, id, and non-2xx throws', async () => {
  const calls = [];
  const provider = createSesProvider({
    env: SES_ENV,
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
      return sesResponse(200, { MessageId: 'msg_1' });
    },
  });

  assert.equal(provider.ready, true);
  const delivery = await provider.sendConfirmation('a@example.com');
  assert.deepEqual(delivery, { id: 'msg_1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails');

  const body = calls[0].body;
  assert.equal(body.FromEmailAddress, 'Trackd <hello@example.com>');
  assert.deepEqual(body.Destination, { ToAddresses: ['a@example.com'] });
  assert.deepEqual(body.ReplyToAddresses, ['trackd@deanware.com']);
  assert.ok(body.Content.Simple.Body.Text.Data.includes(INSTALL_URL));
  assert.ok(body.Content.Simple.Body.Html.Data.includes(INSTALL_URL));
  assert.match(body.Content.Simple.Body.Text.Data, /1\. Open Chrome/);
  assert.ok(
    body.Content.Simple.Headers.some(
      (h) => h.Name === 'List-Unsubscribe' && h.Value.startsWith('<mailto:')
    ),
    'List-Unsubscribe header is passed through'
  );
  assert.ok(calls[0].headers.authorization.startsWith('AWS4-HMAC-SHA256 '));
  assert.equal(calls[0].headers.host, undefined, 'undici owns the Host header');

  const failing = createSesProvider({
    env: SES_ENV,
    fetchImpl: async () => sesResponse(403, { message: 'not verified' }),
  });
  await assert.rejects(() => failing.sendConfirmation('a@example.com'), (err) => {
    assert.equal(err.code, 'email_http_403');
    assert.equal(err.message, 'email_http_403');
    assert.doesNotMatch(err.message, /a@example\.com/);
    return true;
  });
});

test('SES provider: CreateContact stores once and treats AlreadyExists as idempotent', async () => {
  const calls = [];
  const provider = createSesProvider({
    env: SES_ENV,
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, body: JSON.parse(init.body) });
      return sesResponse(200, { ContactListName: 'trackd-beta', EmailAddress: 'a@example.com' });
    },
  });

  const contact = await provider.addContact('a@example.com');
  assert.deepEqual(contact, { stored: true, contactId: 'a@example.com' });
  assert.equal(calls[0].method, 'PUT');
  assert.equal(
    calls[0].url,
    'https://email.us-east-1.amazonaws.com/v2/email/contact-lists/trackd-beta/contacts/a%40example.com'
  );

  // AlreadyExistsException in the x-amzn-errortype header (the real SES shape).
  const duplicateHeader = createSesProvider({
    env: SES_ENV,
    fetchImpl: async () =>
      sesResponse(
        400,
        { message: 'Contact already exists' },
        { 'x-amzn-errortype': 'AlreadyExistsException' }
      ),
  });
  assert.deepEqual(await duplicateHeader.addContact('a@example.com'), {
    stored: true,
    duplicate: true,
    contactId: 'a@example.com',
  });

  // Same exception, carried in the body __type instead.
  const duplicateBody = createSesProvider({
    env: SES_ENV,
    fetchImpl: async () =>
      sesResponse(400, { __type: 'AlreadyExistsException', message: 'exists' }),
  });
  assert.deepEqual(await duplicateBody.addContact('a@example.com'), {
    stored: true,
    duplicate: true,
    contactId: 'a@example.com',
  });

  const failing = createSesProvider({
    env: SES_ENV,
    fetchImpl: async () => sesResponse(500, { message: 'boom' }),
  });
  await assert.rejects(() => failing.addContact('a@example.com'), (err) => {
    assert.equal(err.code, 'contact_http_500');
    assert.doesNotMatch(err.message, /a@example\.com/);
    return true;
  });
});

test('SES provider: without a contact list nothing is written to SES as a contact', async () => {
  const calls = [];
  const provider = createSesProvider({
    env: Object.assign({}, SES_ENV, { SES_CONTACT_LIST: '' }),
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method });
      return sesResponse(200, { MessageId: 'msg_1' });
    },
  });

  assert.equal(provider.contactListConfigured, false);
  assert.deepEqual(await provider.addContact('a@example.com'), {
    stored: false,
    reason: 'no_contact_list',
  });
  assert.equal(calls.length, 0);
});

test('SES provider is not ready without credentials or a verified sender', () => {
  const base = Object.assign({}, SES_ENV);
  assert.equal(createSesProvider({ env: base }).ready, true);
  assert.equal(
    createSesProvider({ env: Object.assign({}, base, { AWS_ACCESS_KEY_ID: '' }) }).ready,
    false
  );
  assert.equal(
    createSesProvider({ env: Object.assign({}, base, { AWS_SECRET_ACCESS_KEY: '' }) }).ready,
    false
  );
  assert.equal(
    createSesProvider({ env: Object.assign({}, base, { SIGNUP_FROM_EMAIL: '' }) }).ready,
    false
  );
});

// ---------------------------------------------------------------------------
// End to end: real handler -> real SES provider -> local SES stub, where the
// received request is independently re-signed by the official AWS signer.
// ---------------------------------------------------------------------------

function sesStub() {
  const received = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://' + req.headers.host);
    const record = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      raw,
      body: raw ? JSON.parse(raw) : null,
    };
    received.push(record);

    if (req.method === 'PUT' && url.pathname.includes('/contacts/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v2/email/outbound-emails') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ MessageId: 'stub-' + received.length }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'no route' }));
  });
  return { server, received };
}

async function verifyReceivedSignature(record, port) {
  const signedHeaders = /SignedHeaders=([^,]+)/.exec(record.headers.authorization || '');
  assert.ok(signedHeaders, 'authorization header present');
  const headers = {};
  for (const name of signedHeaders[1].split(';')) {
    headers[name] = record.headers[name];
  }
  // The path on the wire is already percent-encoded; the oracle re-encodes
  // whatever it is given, so hand it the decoded path to avoid double-encoding.
  const decodedPath = record.path
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/');
  const expected = await oracleAuthorization({
    method: record.method,
    protocol: 'http:',
    hostname: '127.0.0.1',
    port,
    host: record.headers.host,
    path: decodedPath,
    query: record.query,
    headers,
    body: record.raw,
    region: 'us-east-1',
    credentials: {
      accessKeyId: SES_ENV.AWS_ACCESS_KEY_ID,
      secretAccessKey: SES_ENV.AWS_SECRET_ACCESS_KEY,
    },
    date: amzDateToDate(record.headers['x-amz-date']),
  });
  assert.equal(record.headers.authorization, expected, 'signature over the wire');
}

test('end to end: signed request to a local SES stub stores the contact and sends the mail', async (t) => {
  const { server, received } = sesStub();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const env = Object.assign({}, ENV, SES_ENV, {
      AWS_ENDPOINT_URL_SES: 'http://127.0.0.1:' + port,
    });
    const store = memoryStore();
    const handler = createHandler({
      store,
      provider: createSesProvider({ env }),
      logger: { log() {}, error() {} },
      env,
      now: () => 1_700_000_000_000,
    });

    const { response, json } = await call(handler, {
      email: '  E2E@Example.COM ',
      honeypot: '',
      source: 'e2e',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(json, { status: 'ok' });
    assert.equal(received.length, 2, 'one CreateContact and one SendEmail');

    const contactCall = received.find((r) => r.method === 'PUT');
    assert.equal(
      contactCall.path,
      '/v2/email/contact-lists/trackd-beta/contacts/e2e%40example.com'
    );

    const mailCall = received.find((r) => r.method === 'POST');
    assert.deepEqual(mailCall.body.Destination, { ToAddresses: ['e2e@example.com'] });
    assert.ok(mailCall.body.Content.Simple.Body.Text.Data.includes(INSTALL_URL));
    assert.match(mailCall.body.Content.Simple.Body.Text.Data, /5\. Click "Connect Gmail"/);

    const signupKey = [...store.map.keys()].find((k) => k.startsWith('signup:'));
    assert.ok(signupKey, 'signup marker written');
    assert.equal(store.map.get(signupKey).audience, true);
    assert.equal(store.map.get(signupKey).email, undefined);

    if (oracle) {
      for (const record of received) {
        await verifyReceivedSignature(record, port);
      }
    } else {
      t.diagnostic('@smithy/signature-v4 not installed: wire signature not independently verified');
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('end to end: a duplicate contact from SES is still a 200 and does not double-store', async () => {
  const received = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push(req.method + ' ' + req.url);
    if (req.method === 'PUT') {
      res.writeHead(400, {
        'content-type': 'application/json',
        'x-amzn-errortype': 'AlreadyExistsException',
      });
      res.end(JSON.stringify({ message: 'Contact already exists' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ MessageId: 'stub-dup' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const env = Object.assign({}, ENV, SES_ENV, {
      AWS_ENDPOINT_URL_SES: 'http://127.0.0.1:' + port,
      SIGNUP_RESEND_COOLDOWN_SECONDS: '0',
    });
    const store = memoryStore();
    const handler = createHandler({
      store,
      provider: createSesProvider({ env }),
      logger: { log() {}, error() {} },
      env,
      now: () => 1_700_000_000_000,
    });

    const first = await call(handler, { email: 'dupe@example.com', honeypot: '', source: 'e2e' });
    assert.equal(first.response.statusCode, 200);

    // Second signup after the cooldown: SES reports the contact already exists,
    // the mail goes out again, and there is still exactly one signup record.
    const second = await call(handler, { email: 'dupe@example.com', honeypot: '', source: 'e2e' });
    assert.equal(second.response.statusCode, 200);

    const signupKeys = [...store.map.keys()].filter((k) => k.startsWith('signup:'));
    assert.equal(signupKeys.length, 1, 'no second signup row');
    assert.equal(received.filter((r) => r.startsWith('PUT')).length, 2);
    assert.equal(received.filter((r) => r.startsWith('POST')).length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('real HTTP POST to the handler returns 200 and appears in the store', async () => {
  const { handler, store, provider } = setup();
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const result = await handler({
      httpMethod: req.method,
      headers: req.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    });
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/api/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nf-client-connection-ip': '127.0.0.1',
      },
      body: JSON.stringify({
        email: 'http-test@example.com',
        honeypot: '',
        source: 'http-test',
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.ok(provider.contacts.has('http-test@example.com'));
    assert.equal(provider.sends.length, 1);
    assert.ok([...store.map.keys()].some((k) => k.startsWith('signup:')));

    const spam = await fetch('http://127.0.0.1:' + port + '/api/beta-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bot@example.com', honeypot: 'x', source: 'http-test' }),
    });
    assert.equal(spam.status, 400);
    assert.equal(provider.contacts.has('bot@example.com'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('export script pages the SES contact list and writes byte-exact CSV', async (t) => {
  const pages = [
    {
      Contacts: [
        { EmailAddress: 'alice@example.com', CreatedTimestamp: '2026-11-20T10:00:00.000Z', UnsubscribeAll: false },
        { EmailAddress: 'bob+beta@example.com', CreatedTimestamp: '2026-11-21T11:30:00.000Z', UnsubscribeAll: true },
      ],
      NextToken: 'tok-2',
    },
    {
      Contacts: [
        { EmailAddress: 'carol@example.com', CreatedTimestamp: '2026-11-22T09:15:00.000Z', UnsubscribeAll: false },
      ],
    },
  ];

  const received = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://' + req.headers.host);
    received.push({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      raw: '',
    });
    const body = url.searchParams.get('NextToken') === 'tok-2' ? pages[1] : pages[0];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.join(__dirname, '..', 'scripts', 'export-beta-signups.mjs')],
        {
          env: Object.assign({}, process.env, {
            AWS_ACCESS_KEY_ID: SES_ENV.AWS_ACCESS_KEY_ID,
            AWS_SECRET_ACCESS_KEY: SES_ENV.AWS_SECRET_ACCESS_KEY,
            AWS_REGION: 'us-east-1',
            SES_CONTACT_LIST: 'trackd-beta',
            AWS_ENDPOINT_URL_SES: 'http://127.0.0.1:' + port,
          }),
        }
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d;
      });
      child.stderr.on('data', (d) => {
        stderr += d;
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stdout,
      'email,created_at,unsubscribe_all\n' +
        'alice@example.com,2026-11-20T10:00:00.000Z,false\n' +
        'bob+beta@example.com,2026-11-21T11:30:00.000Z,true\n' +
        'carol@example.com,2026-11-22T09:15:00.000Z,false\n'
    );

    assert.equal(received.length, 2, 'two pages');
    assert.equal(received[0].query.PageSize, '100');
    assert.equal(received[1].query.NextToken, 'tok-2');
    assert.equal(
      received[0].path,
      '/v2/email/contact-lists/trackd-beta/contacts'
    );

    if (oracle) {
      for (const record of received) {
        await verifyReceivedSignature(record, port);
      }
    } else {
      t.diagnostic('@smithy/signature-v4 not installed: wire signature not independently verified');
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
