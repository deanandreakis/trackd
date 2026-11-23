'use strict';

// Adversarial security harness for POST /api/beta-signup (task t_758b20e3).
// Drives the REAL core handler (netlify/lib/beta-signup.js) with a fake store
// that emulates @netlify/blobs semantics (atomic onlyIfNew, {modified:bool})
// and a fake provider. Each probe asserts the SECURE outcome.

const path = require('path');
const REPO = require('node:path').resolve(__dirname, '..', '..');
const { createHandler } = require(path.join(REPO, 'netlify/lib/beta-signup.js'));

function makeStore(opts = {}) {
  const map = new Map();
  const latency = opts.latency || 0;
  const failSet = opts.failSet || false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    map,
    async get(key) {
      if (latency) await sleep(latency);
      return map.has(key) ? JSON.parse(JSON.stringify(map.get(key))) : null;
    },
    async set(key, value, options) {
      if (latency) await sleep(latency);
      if (failSet) { const e = new Error('store down'); e.code = 'store_down'; throw e; }
      if (options && options.onlyIfNew) {
        if (map.has(key)) return { modified: false };
        map.set(key, JSON.parse(JSON.stringify(value)));
        return { modified: true };
      }
      map.set(key, JSON.parse(JSON.stringify(value)));
      return { modified: true };
    },
    async delete(key) { map.delete(key); },
  };
}

function makeProvider(opts = {}) {
  const sends = [];
  const contacts = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    sends,
    contacts,
    ready: opts.ready !== false,
    async addContact(email) {
      if (opts.contactLatency) await sleep(opts.contactLatency);
      if (opts.failContact) { const e = new Error('boom AKIAIOSFODNN7EXAMPLE'); e.status = 500; throw e; }
      const dup = contacts.includes(email);
      if (!dup) contacts.push(email);
      return { stored: true, duplicate: dup, contactId: email };
    },
    async sendConfirmation(email) {
      if (opts.sendLatency) await sleep(opts.sendLatency);
      if (opts.failSend) {
        const e = new Error('SES ProviderError: secret wJalrXUtnFEMI/K7MDENG at /opt/data/trackd/netlify/lib/ses-provider.js:214');
        e.status = 400;
        throw e;
      }
      sends.push(email);
      return { id: 'msg-' + sends.length };
    },
  };
}

function makeLogger() {
  const lines = [];
  const render = (a) => a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  return {
    lines,
    log: (...a) => lines.push(render(a)),
    error: (...a) => lines.push(render(a)),
    warn: (...a) => lines.push(render(a)),
  };
}

function event(body, headers) {
  return {
    httpMethod: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    // Contract v2: beta_consent must be exactly boolean true or the handler
    // returns the generic 400. The security probes below exercise the post-
    // consent code paths, so a valid consent is the realistic baseline.
    body: JSON.stringify(Object.assign({ beta_consent: true }, body)),
  };
}

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  — ' + detail : ''));
  if (!ok) failures += 1;
}

async function main() {
  // 1. Concurrency: duplicate signups must send at most one email.
  {
    const store = makeStore({ latency: 25 });
    const provider = makeProvider({ contactLatency: 20, sendLatency: 20 });
    const handler = createHandler({ store, provider, logger: makeLogger(), env: {}, now: () => 1000 });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => handler(event({ email: 'victim@example.com' })))
    );
    const codes = results.map((r) => r.statusCode);
    console.log('  concurrent duplicate: codes=' + JSON.stringify(codes) +
      ' sends=' + provider.sends.length + ' contacts=' + provider.contacts.length);
    check('1a. duplicate signups store ONE contact row', provider.contacts.length === 1,
      'contacts=' + provider.contacts.length);
    check('1b. duplicate signups send AT MOST ONE email (no email-bomb race)',
      provider.sends.length <= 1, 'sends=' + provider.sends.length);
  }

  // 2a. Spoofed X-Forwarded-For with no edge header must NOT bypass the limit.
  {
    const store = makeStore({ latency: 5 });
    const provider = makeProvider();
    const handler = createHandler({ store, provider, env: {}, now: () => 5000 });
    const codes = [];
    for (let i = 0; i < 8; i += 1) {
      const r = await handler(event(
        { email: 'spoof' + i + '@example.com' },
        { 'x-forwarded-for': '10.0.0.' + i }
      ));
      codes.push(r.statusCode);
    }
    const passed = codes.filter((c) => c === 200).length;
    check('2a. spoofed XFF does NOT mint fresh buckets (limit holds at 5)',
      passed === 5, 'codes=' + JSON.stringify(codes));
  }

  // 2b. Edge header wins over a hostile XFF.
  {
    const store = makeStore({ latency: 5 });
    const provider = makeProvider();
    const handler = createHandler({ store, provider, env: {}, now: () => 7000 });
    const codes = [];
    for (let i = 0; i < 8; i += 1) {
      const r = await handler(event(
        { email: 'edge' + i + '@example.com' },
        { 'x-nf-client-connection-ip': '203.0.113.9', 'x-forwarded-for': '10.0.0.' + i }
      ));
      codes.push(r.statusCode);
    }
    const blocked = codes.filter((c) => c === 400).length;
    check('2b. edge header wins over client XFF (limit holds)', blocked === 3,
      'codes=' + JSON.stringify(codes));
  }

  // 2c. Concurrent burst from one IP.
  {
    const store = makeStore({ latency: 20 });
    const provider = makeProvider({ sendLatency: 10 });
    const handler = createHandler({ store, provider, env: {}, now: () => 9000 });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => handler(event(
        { email: 'burst' + i + '@example.com' },
        { 'x-nf-client-connection-ip': '203.0.113.9' }
      )))
    );
    const ok = results.filter((r) => r.statusCode === 200).length;
    check('2c. concurrent burst from one IP: at most 5 pass', ok <= 5, 'passed=' + ok + '/20');
  }

  // 2d. TRUST_FORWARDED_FOR=1 opts back in.
  {
    const store = makeStore({ latency: 0 });
    const handler = createHandler({
      store, provider: makeProvider(), env: { TRUST_FORWARDED_FOR: '1' }, now: () => 9500,
    });
    const codes = [];
    for (let i = 0; i < 8; i += 1) {
      codes.push((await handler(event(
        { email: 't' + i + '@example.com' }, { 'x-forwarded-for': '10.0.0.' + i }
      ))).statusCode);
    }
    check('2d. XFF honoured only with explicit opt-in (each IP its own bucket)',
      codes.every((c) => c === 200), 'codes=' + JSON.stringify(codes));
  }

  // 3. Log injection via `source`.
  {
    const store = makeStore({ latency: 0 });
    const provider = makeProvider();
    const logger = makeLogger();
    const handler = createHandler({ store, provider, logger, env: {}, now: () => 11000 });
    await handler(event({
      email: 'src@example.com',
      source: 'hero\nERROR beta-signup: forged line\nINFO attacker controlled',
    }));
    const joined = logger.lines.join('\n');
    check('3a. newlines in `source` are stripped before logging',
      !joined.includes('\nERROR beta-signup: forged line'),
      JSON.stringify(logger.lines.filter((l) => l.includes('forged'))));
  }

  // 4. Error leakage.
  {
    const store = makeStore({ latency: 0 });
    const provider = makeProvider({ failSend: true });
    const logger = makeLogger();
    const handler = createHandler({ store, provider, logger, env: {}, now: () => 13000 });
    const r = await handler(event({ email: 'leak@example.com' }));
    const leaked = ['amazonaws', 'SES', 'ProviderError', 'AKIA', 'wJalrXUtnFEMI',
      '/opt/data', 'ses-provider.js', 'at Object', 'stack']
      .filter((t) => r.body.includes(t));
    check('4a. 500 body leaks no provider name / key / stack path', leaked.length === 0,
      'status=' + r.statusCode + ' leaked=' + JSON.stringify(leaked));
  }

  // 4b. A failed send releases the claim so a retry can send.
  {
    const store = makeStore({ latency: 0 });
    const provider = makeProvider({ failSend: true });
    const handler = createHandler({ store, provider, logger: makeLogger(), env: {}, now: () => 14000 });
    const first = await handler(event({ email: 'retry@example.com' }));
    provider.ready = true;
    const send = provider.sendConfirmation.bind(provider);
    provider.sendConfirmation = async (e) => { provider.sends.push(e); return { id: 'ok' }; };
    const second = await handler(event({ email: 'retry@example.com' }));
    check('4b. a retry after a failed send is allowed (claim released)',
      first.statusCode === 500 && second.statusCode === 200 && provider.sends.length === 1,
      'first=' + first.statusCode + ' second=' + second.statusCode + ' sends=' + provider.sends.length);
  }

  // 5. Not an open relay.
  {
    const store = makeStore({ latency: 0 });
    const provider = makeProvider();
    const handler = createHandler({ store, provider, env: {}, now: () => 15000 });
    await handler(event({ email: 'relay@example.com' }));
    check('5a. only the submitted address is a send target',
      provider.sends.length === 1 && provider.sends[0] === 'relay@example.com',
      JSON.stringify(provider.sends));
  }

  // 6. Injection into the SES contact path.
  {
    const { normalizeEmail } = require(path.join(REPO, 'netlify/lib/signup-service.js'));
    const { canonicalPathFromSegments } = require(path.join(REPO, 'netlify/lib/aws-sigv4.js'));
    const built = canonicalPathFromSegments(
      ['v2', 'email', 'contact-lists', 'trackd-beta', 'contacts', 'a/b@example.com']);
    check('6a. a "/" in the address is percent-encoded, not a new path segment',
      !built.split('/').includes('a') && built.includes('a%2Fb%40example.com'), built);
    check('6b. normalizeEmail rejects whitespace / control chars',
      normalizeEmail('a b@example.com') === null && normalizeEmail('a\tb@example.com') === null,
      'space=' + normalizeEmail('a b@example.com'));
  }

  // 7. Store outage fail-open on the rate limiter (documented tradeoff).
  {
    const store = makeStore({ latency: 0, failSet: true });
    const provider = makeProvider();
    const handler = createHandler({ store, provider, logger: makeLogger(), env: {}, now: () => 17000 });
    const codes = [];
    for (let i = 0; i < 12; i += 1) {
      codes.push((await handler(event(
        { email: 'failopen' + i + '@example.com' }, { 'x-nf-client-connection-ip': '203.0.113.9' }
      ))).statusCode);
    }
    console.log('  7. rate limiter under a store outage: codes=' + JSON.stringify(codes) +
      ' (fail-open is a documented availability tradeoff)');
  }

  console.log('\n' + (failures === 0
    ? 'ALL probes report the secure behaviour'
    : failures + ' probe(s) still reported the risky behaviour'));
}

main().catch((e) => { console.error('harness crashed:', e); process.exit(1); });
