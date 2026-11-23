'use strict';

// Tests for the reusable persistence + confirmation-email module
// (netlify/lib/signup-service.js) and the config-driven email content.
//
// These exercise the module's own acceptance criteria directly, independent of
// the HTTP handler: idempotent storage, a real confirmation send over a socket,
// typed errors, no raw address in logs, and env-driven install copy.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  createSignupService,
  normalizeEmail,
  normalizeSource,
} = require('../netlify/lib/signup-service');
const {
  StoreError,
  ProviderError,
  ConfigError,
} = require('../netlify/lib/signup-errors');
const { createSesProvider } = require('../netlify/lib/ses-provider');
const {
  buildConfirmation,
  INSTALL_URL,
} = require('../netlify/lib/confirmation-email');

const ENV = { SIGNUP_HASH_SALT: 'test-salt' };

function memoryStore(overrides) {
  const map = new Map();
  const opts = overrides || {};
  return {
    map,
    async get(key) {
      if (opts.failGet) throw Object.assign(new Error('blobs down'), { code: 'blob_500' });
      return map.has(key) ? JSON.parse(JSON.stringify(map.get(key))) : null;
    },
    async set(key, value, options) {
      if (opts.failSet) throw Object.assign(new Error('blobs down'), { code: 'blob_500' });
      if (options && options.onlyIfNew && map.has(key)) return { modified: false };
      map.set(key, JSON.parse(JSON.stringify(value)));
      return { modified: true, etag: 'etag-' + map.size };
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

// A stand-in for a provider whose audience is keyed by address (SES contact
// list): a repeat add is a no-op reported as duplicate, never a second row.
function fakeAudienceProvider(initial) {
  const state = Object.assign({ failAdd: false, failSend: false }, initial);
  const contacts = new Set();
  const sends = [];
  return {
    state,
    contacts,
    sends,
    ready: true,
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

function service(opts) {
  const o = opts || {};
  const store = o.store || memoryStore();
  const provider = o.provider || fakeAudienceProvider();
  const logs = [];
  const logger = o.logger || {
    log: (...a) => logs.push(a),
    error: (...a) => logs.push(a),
  };
  const svc = createSignupService({
    store,
    provider,
    logger,
    env: Object.assign({}, ENV, o.env),
    now: o.now || (() => 1_700_000_000_000),
  });
  return { svc, store, provider, logs };
}

test('storeSignup twice with the same email stores exactly one record', async () => {
  const { svc, store, provider } = service();

  const first = await svc.storeSignup('  Alice@Example.COM ', 'hero');
  assert.equal(first.duplicate, false);
  assert.equal(first.stored, true);

  const second = await svc.storeSignup('alice@example.com', 'footer');
  assert.equal(second.duplicate, true, 'second add is the provider duplicate path');
  assert.equal(second.emailHash, first.emailHash);

  // One contact in the audience, one marker key — the repeat overwrote, not added.
  assert.equal(provider.contacts.size, 1);
  const keys = [...store.map.keys()].filter((k) => k.startsWith('signup:'));
  assert.equal(keys.length, 1, 'exactly one stored record');
  assert.equal(store.map.get(keys[0]).source, 'footer', 'the record was updated in place');
  assert.equal(store.map.get(keys[0]).createdAt, first.createdAt, 'createdAt preserved');
  assert.equal(store.map.get(keys[0]).email, undefined, 'audience holds the address');
});

test('sendConfirmation delivers a real message with the install URL and numbered steps', async () => {
  const received = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    received.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ MessageId: 'stub-msg' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const env = Object.assign({}, ENV, {
      AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'secret',
      AWS_REGION: 'us-east-1',
      SIGNUP_FROM_EMAIL: 'Trackd <hello@example.com>',
      SES_CONTACT_LIST: 'trackd-beta',
      AWS_ENDPOINT_URL_SES: 'http://127.0.0.1:' + port,
    });
    const { svc } = service({ provider: createSesProvider({ env }), env });

    const delivery = await svc.sendConfirmation('reader@example.com');
    assert.equal(delivery.id, 'stub-msg');

    const mail = received.find((r) => r.method === 'POST');
    assert.ok(mail, 'a SendEmail request reached the provider');
    const text = mail.body.Content.Simple.Body.Text.Data;
    assert.ok(text.includes(INSTALL_URL), 'working download URL in the text body');
    assert.match(text, /1\. Open Chrome/);
    assert.match(text, /2\. Open the Trackd listing/);
    assert.match(text, /3\. Click "Add to Chrome"/);
    assert.match(text, /5\. Click "Connect Gmail"/);
    assert.ok(
      mail.body.Content.Simple.Body.Html.Data.includes(INSTALL_URL),
      'URL in the HTML body too'
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('download URL, subject and steps are configurable without code edits', () => {
  const env = {
    EXTENSION_DOWNLOAD_URL: 'https://example.com/install',
    SIGNUP_EMAIL_SUBJECT: 'Your Trackd link',
    SIGNUP_INSTALL_STEPS: 'Do the first thing\nInstall from {url}\nDone',
  };
  const message = buildConfirmation(env);
  assert.equal(message.installUrl, 'https://example.com/install');
  assert.equal(message.subject, 'Your Trackd link');
  assert.match(message.text, /1\. Do the first thing/);
  assert.match(message.text, /2\. Install from https:\/\/example\.com\/install/);
  assert.match(message.text, /3\. Done/);
  assert.ok(message.text.includes('https://example.com/install'));
  assert.ok(message.html.includes('https://example.com/install'));
  assert.doesNotMatch(message.text, new RegExp(INSTALL_URL.replace(/\./g, '\\.')));

  // No overrides -> the shipped defaults.
  const defaults = buildConfirmation();
  assert.equal(defaults.installUrl, INSTALL_URL);
  assert.equal(defaults.subject, "You're in: here's your Trackd install link");
  assert.match(defaults.text, /5\. Click "Connect Gmail"/);
});

test('an overridden download URL is what the provider actually sends', async () => {
  let sent = null;
  const env = Object.assign({}, ENV, {
    AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'secret',
    AWS_REGION: 'us-east-1',
    SIGNUP_FROM_EMAIL: 'Trackd <hello@example.com>',
    SES_CONTACT_LIST: 'trackd-beta',
    EXTENSION_DOWNLOAD_URL: 'https://example.com/custom-install',
  });
  const provider = createSesProvider({
    env,
    fetchImpl: async (url, init) => {
      sent = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        headers: new Headers({}),
        async text() {
          return JSON.stringify({ MessageId: 'm1' });
        },
      };
    },
  });
  await provider.sendConfirmation('a@example.com');
  assert.ok(sent.Content.Simple.Body.Text.Data.includes('https://example.com/custom-install'));
  assert.ok(sent.Content.Simple.Body.Html.Data.includes('https://example.com/custom-install'));
});

test('provider failures surface as typed ProviderError, never the raw address', async () => {
  const provider = fakeAudienceProvider({ failAdd: true });
  const { svc } = service({ provider });
  await assert.rejects(() => svc.storeSignup('victim@example.com', 'x'), (err) => {
    assert.ok(err instanceof ProviderError);
    assert.equal(err.name, 'ProviderError');
    assert.doesNotMatch(err.message, /victim@example\.com/);
    return true;
  });

  const sendProvider = fakeAudienceProvider({ failSend: true });
  const { svc: svc2 } = service({ provider: sendProvider });
  await assert.rejects(() => svc2.sendConfirmation('victim@example.com'), (err) => {
    assert.ok(err instanceof ProviderError);
    assert.equal(err.code, 'email_http_500');
    assert.doesNotMatch(err.message, /victim@example\.com/);
    return true;
  });
});

test('a store failure with no audience list is a typed StoreError', async () => {
  const store = memoryStore({ failSet: true });
  // No contact list: addContact reports nothing stored, so the marker is the
  // only durable copy and its failure must surface.
  const provider = {
    ready: true,
    async addContact() {
      return { stored: false, reason: 'no_contact_list' };
    },
    async sendConfirmation() {
      return { id: 'x' };
    },
  };
  const { svc } = service({ store, provider });
  await assert.rejects(() => svc.storeSignup('a@example.com', 'x'), (err) => {
    assert.ok(err instanceof StoreError);
    assert.equal(err.name, 'StoreError');
    assert.equal(err.code, 'store_write_failed');
    return true;
  });
});

test('a store failure with an audience configured is not fatal (list is durable)', async () => {
  const store = memoryStore({ failSet: true });
  const { svc, logs, provider } = service({ store });
  const result = await svc.storeSignup('durable@example.com', 'x');
  assert.equal(result.stored, true);
  assert.equal(provider.contacts.size, 1);
  assert.ok(logs.some((l) => String(l[0]).includes('marker write failed')));
});

test('invalid email and an unconfigured provider are typed ConfigErrors', async () => {
  const { svc } = service();
  await assert.rejects(() => svc.storeSignup('not-an-email', 'x'), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.code, 'invalid_email');
    return true;
  });

  const { svc: notReady } = service({ provider: { ready: false } });
  await assert.rejects(() => notReady.sendConfirmation('a@example.com'), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.code, 'provider_not_configured');
    return true;
  });
});

test('markConfirmationSent records the send time and preserves the record', async () => {
  const clock = { ms: 1_700_000_000_000 };
  const { svc, store } = service({ now: () => clock.ms });
  await svc.storeSignup('mark@example.com', 'hero');
  clock.ms += 5000;
  const record = await svc.markConfirmationSent('mark@example.com', { deliveryId: 'd1' });

  assert.equal(record.confirmationSentAt, 1_700_000_005_000);
  assert.equal(record.deliveryId, 'd1');
  assert.equal(record.source, 'hero');
  assert.equal(store.map.size, 1);
});

test('the module never logs the raw address across store and send', async () => {
  const { svc, logs } = service();
  await svc.storeSignup('private.person@example.com', 'hero');
  await svc.sendConfirmation('private.person@example.com');
  await svc.markConfirmationSent('private.person@example.com', { deliveryId: 'd1' });
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, /private\.person@example\.com/i);
  assert.doesNotMatch(serialized, /private\.person/i);
});

test('normalizers trim, lowercase, and reject structural garbage', () => {
  assert.equal(normalizeEmail('  Bob@Example.COM '), 'bob@example.com');
  for (const bad of ['', 'nope', 'a@b', 'a@.com', 'a..b@example.com', 'x@y.z.', 42, null]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
  assert.equal(normalizeSource('  hero  '), 'hero');
  assert.equal(normalizeSource(''), 'unknown');
  assert.equal(normalizeSource(42), 'unknown');
});
