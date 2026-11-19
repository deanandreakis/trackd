'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createHandler } = require('../netlify/lib/beta-signup');
const { buildConfirmation, INSTALL_URL } = require('../netlify/lib/confirmation-email');
const { createResendProvider } = require('../netlify/lib/resend-provider');

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
        throw Object.assign(new Error('audience down'), { code: 'audience_http_500' });
      }
      const duplicate = contacts.has(email);
      contacts.add(email);
      return { stored: true, duplicate, contactId: 'contact-' + contacts.size };
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
        'x-nf-client-connection-ip': opts.ip || '203.0.113.7',
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
  assert.equal(record.email, undefined, 'audience list holds the address');
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
    await call(handler, { email: 'a' + i + '@example.com', honeypot: '', source: 'x' }, { ip: '198.51.100.1' });
  }
  const other = await call(handler, { email: 'other@example.com', honeypot: '', source: 'x' }, { ip: '198.51.100.2' });
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
  assert.doesNotMatch(json.message, /audience|resend|500|stack/i);
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

test('Resend provider: 201 stores, 409 is an idempotent duplicate, 500 throws', async () => {
  const calls = [];
  function response(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return JSON.stringify(body);
      },
    };
  }

  const env = { RESEND_API_KEY: 're_test', RESEND_AUDIENCE_ID: 'aud_1', SIGNUP_FROM_EMAIL: 'Trackd <hello@example.com>' };
  const provider = createResendProvider({
    env,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (url.endsWith('/contacts')) return response(201, { id: 'contact_1' });
      return response(200, { id: 'mail_1' });
    },
  });

  const contact = await provider.addContact('a@example.com');
  assert.deepEqual(contact, { stored: true, contactId: 'contact_1' });
  const delivery = await provider.sendConfirmation('a@example.com');
  assert.deepEqual(delivery, { id: 'mail_1' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.resend.com/audiences/aud_1/contacts');
  assert.equal(calls[1].url, 'https://api.resend.com/emails');
  assert.equal(calls[1].body.to[0], 'a@example.com');
  assert.ok(calls[1].body.text.includes(INSTALL_URL));

  const duplicate = createResendProvider({
    env,
    fetchImpl: async () => response(409, { message: 'Contact already exists' }),
  });
  assert.deepEqual(await duplicate.addContact('a@example.com'), {
    stored: true,
    duplicate: true,
  });

  const failing = createResendProvider({
    env,
    fetchImpl: async () => response(500, { message: 'boom' }),
  });
  await assert.rejects(() => failing.addContact('a@example.com'), (err) => {
    assert.equal(err.code, 'audience_http_500');
    assert.equal(err.message, 'audience_http_500');
    assert.doesNotMatch(err.message, /a@example\.com/);
    return true;
  });
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
        'x-nf-client-connection-ip': '192.0.2.10',
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
