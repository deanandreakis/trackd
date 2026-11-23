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
// list): a repeat add is a no-op reported as duplicate, never a second row. The
// promotional list mirrors netlify/lib/ses-provider.js: membership is reconciled
// to the submitted consent in both directions.
function fakeAudienceProvider(initial) {
  const state = Object.assign(
    { failAdd: false, failSend: false, promoListConfigured: true },
    initial
  );
  const contacts = new Set();
  const promo = new Set();
  const calls = []; // [{ email, marketing, promotional, removed }]
  const sends = [];
  return {
    state,
    contacts,
    promo,
    calls,
    sends,
    ready: true,
    get promoListConfigured() {
      return Boolean(state.promoListConfigured);
    },
    async addContact(email, options) {
      const marketing = Boolean(options && options.marketing === true);
      if (state.failAdd) {
        throw Object.assign(new Error('contact list down'), { code: 'contact_http_500' });
      }
      const duplicate = contacts.has(email);
      contacts.add(email);
      let promotional = false;
      let removed = false;
      if (state.promoListConfigured) {
        if (marketing) {
          promo.add(email);
          promotional = true;
        } else {
          removed = promo.delete(email);
        }
      }
      calls.push({ email, marketing, promotional, removed });
      return { stored: true, duplicate, contactId: email, marketing, promotional };
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

test('storeSignup records consent evidence and forwards the marketing flag', async () => {
  const { svc, store, provider } = service();

  const result = await svc.storeSignup('consent@example.com', 'hero', {
    marketing: true,
  });
  assert.equal(result.marketing, true);
  assert.equal(result.promotional, true);
  assert.equal(provider.calls[0].marketing, true);

  const key = [...store.map.keys()].find((k) => k.startsWith('signup:'));
  assert.deepEqual(store.map.get(key).consent, {
    beta: true,
    betaAt: 1_700_000_000_000,
    marketing: true,
    marketingAt: 1_700_000_000_000,
  });

  // Absent / non-boolean consent means no marketing consent, and the flag is
  // still forwarded to the provider as false.
  const { svc: svc2, store: store2, provider: provider2 } = service();
  await svc2.storeSignup('nomarketing@example.com', 'hero', { marketing: 'true' });
  const key2 = [...store2.map.keys()].find((k) => k.startsWith('signup:'));
  assert.equal(store2.map.get(key2).consent.marketing, false);
  assert.equal(store2.map.get(key2).consent.marketingAt, null);
  assert.equal(provider2.calls[0].marketing, false);
});

test('recordConsent refreshes only the consent block and is a no-op when unchanged', async () => {
  const { svc, store } = service();
  await svc.storeSignup('rc@example.com', 'hero', { marketing: false });
  const key = [...store.map.keys()].find((k) => k.startsWith('signup:'));

  // Unchanged value: no write, marker untouched.
  const same = await svc.recordConsent('rc@example.com', { marketing: false });
  assert.equal(same.consent.marketing, false);

  // Changed value: consent flips, source/createdAt preserved.
  const changed = await svc.recordConsent('rc@example.com', { marketing: true });
  assert.equal(changed.consent.marketing, true);
  assert.equal(changed.consent.marketingAt, 1_700_000_000_000);
  assert.equal(changed.source, 'hero');
  assert.equal(store.map.get(key).consent.beta, true);

  // No marker: nothing to do.
  assert.equal(await svc.recordConsent('missing@example.com', { marketing: true }), null);
});

test('storeSignup reconciles the promotional audience with the consent it records', async () => {
  const { svc, store, provider } = service();

  await svc.storeSignup('flip@example.com', 'hero', { marketing: true });
  assert.equal(provider.promo.has('flip@example.com'), true);
  assert.equal(store.map.size >= 1, true);

  // The same address comes back without marketing consent: the audience must
  // follow the record, not keep the address because it was added once.
  const withdrawn = await svc.storeSignup('flip@example.com', 'hero', {
    marketing: false,
  });
  assert.equal(withdrawn.marketing, false);
  assert.equal(withdrawn.promotional, false);
  assert.equal(provider.promo.has('flip@example.com'), false, 'withdrawal applied');
  assert.equal(provider.contacts.has('flip@example.com'), true, 'still transactional');

  const key = [...store.map.keys()].find((k) => k.startsWith('signup:'));
  const record = store.map.get(key);
  assert.equal(record.consent.marketing, false);
  assert.equal(
    record.consent.marketing === true,
    provider.promo.has('flip@example.com'),
    'record and audience agree'
  );
});

test('recordConsent applies a changed choice to the promotional audience', async () => {
  const { svc, provider } = service();
  await svc.storeSignup('delta@example.com', 'hero', { marketing: false });
  assert.equal(provider.promo.has('delta@example.com'), false);

  // Opt-in on the cooldown path: recorded *and* applied.
  const optedIn = await svc.recordConsent('delta@example.com', { marketing: true });
  assert.equal(optedIn.consent.marketing, true);
  assert.equal(provider.promo.has('delta@example.com'), true, 'opt-in reached the list');

  // Withdrawal on the cooldown path: recorded *and* applied.
  const withdrawn = await svc.recordConsent('delta@example.com', { marketing: false });
  assert.equal(withdrawn.consent.marketing, false);
  assert.equal(withdrawn.consent.marketingAt, null);
  assert.equal(provider.promo.has('delta@example.com'), false, 'withdrawal left the list');
});

test('recordConsent surfaces a provider failure instead of recording an unapplied change', async () => {
  const { svc, provider } = service();
  await svc.storeSignup('stuck@example.com', 'hero', { marketing: true });
  assert.equal(provider.promo.has('stuck@example.com'), true);

  provider.state.failAdd = true;
  await assert.rejects(
    () => svc.recordConsent('stuck@example.com', { marketing: false }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.doesNotMatch(err.message, /stuck@example\.com/);
      return true;
    }
  );

  // Nothing was recorded: the marker still says what the audience still is.
  const record = await svc.getSignup('stuck@example.com');
  assert.equal(record.consent.marketing, true);
  assert.equal(provider.promo.has('stuck@example.com'), true);
});

test('recordConsent is a pure read when nothing changed and no promotional list exists', async () => {
  const bare = fakeAudienceProvider({ promoListConfigured: false });
  const { svc, provider } = service({ provider: bare });
  await svc.storeSignup('quiet@example.com', 'hero', { marketing: false });
  const before = provider.calls.length;

  const same = await svc.recordConsent('quiet@example.com', { marketing: false });
  assert.equal(same.consent.marketing, false);
  assert.equal(provider.calls.length, before, 'no provider call');

  // With a promotional list configured, even an unchanged value re-asserts the
  // membership, so a drifted audience converges on the next accepted request.
  const configured = service();
  await configured.svc.storeSignup('drift@example.com', 'hero', { marketing: false });
  const configuredBefore = configured.provider.calls.length;
  await configured.svc.recordConsent('drift@example.com', { marketing: false });
  assert.equal(configured.provider.calls.length, configuredBefore + 1, 're-asserted');
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
