'use strict';

// Consent/audience consistency probe for POST /api/beta-signup (task t_30b0eae6).
//
// The question this answers: after ANY accepted request, does the stored consent
// record agree with the promotional audience? An append-only audience gate
// answers "no" the moment the marketing choice *changes* — a withdrawal is
// recorded but the address stays in the list a campaign reads (GDPR Art. 7(3)),
// and an opt-in is recorded but can never take effect.
//
// Unlike a probe driven by a hand-written fake provider, this one wires the REAL
// handler (netlify/lib/beta-signup.js) to the REAL SES provider
// (netlify/lib/ses-provider.js), pointed at a stateful SES stub that implements
// CreateContact, DeleteContact and SendEmail with real contact-list semantics.
// The wire calls are therefore the ones production would make.
//
// Run: node scripts/security/consent-membership-consistency.js
// Exit code 0 when every row is consistent and 1 otherwise.

const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const { createHandler } = require(path.join(REPO, 'netlify/lib/beta-signup.js'));
const { createSesProvider } = require(path.join(REPO, 'netlify/lib/ses-provider.js'));

const SALT = 'consent-probe-salt';
const ENV = {
  RATE_LIMIT_MAX: '200',
  RATE_LIMIT_WINDOW_SECONDS: '600',
  SIGNUP_RESEND_COOLDOWN_SECONDS: '86400',
  SIGNUP_HASH_SALT: SALT,
  AWS_ACCESS_KEY_ID: 'AKIDPROBE',
  AWS_SECRET_ACCESS_KEY: 'probe-secret',
  AWS_REGION: 'us-east-1',
  SIGNUP_FROM_EMAIL: 'Trackd <hello@example.com>',
  SES_CONTACT_LIST: 'trackd-beta',
  SES_PROMO_CONTACT_LIST: 'trackd-promo',
};

// A stateful SES contact-list stub: POST creates (400 AlreadyExistsException on a
// repeat), DELETE removes (404 NotFoundException when absent), and the two lists
// are just sets.
function statefulSesStub() {
  const lists = new Map();
  const received = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://' + req.headers.host);
    const parts = url.pathname.split('/');
    received.push({ method: req.method, path: url.pathname, body: raw ? JSON.parse(raw) : null });

    const reply = (status, payload, headers) => {
      res.writeHead(status, Object.assign({ 'content-type': 'application/json' }, headers || {}));
      res.end(JSON.stringify(payload));
    };

    if (url.pathname === '/v2/email/outbound-emails') {
      reply(200, { MessageId: 'probe-' + received.length });
      return;
    }
    if (
      parts[1] === 'v2' &&
      parts[2] === 'email' &&
      parts[3] === 'contact-lists' &&
      parts[5] === 'contacts'
    ) {
      const list = decodeURIComponent(parts[4]);
      let members = lists.get(list);
      if (!members) {
        members = new Set();
        lists.set(list, members);
      }
      if (req.method === 'POST') {
        const email = (JSON.parse(raw || '{}') || {}).EmailAddress;
        if (members.has(email)) {
          reply(400, { message: 'Contact already exists' }, {
            'x-amzn-errortype': 'AlreadyExistsException',
          });
          return;
        }
        members.add(email);
        reply(200, {});
        return;
      }
      if (req.method === 'DELETE' && parts[6]) {
        const email = decodeURIComponent(parts[6]);
        if (!members.has(email)) {
          reply(404, { message: 'no such contact' }, {
            'x-amzn-errortype': 'NotFoundException',
          });
          return;
        }
        members.delete(email);
        reply(200, {});
        return;
      }
    }
    reply(404, { message: 'no route' });
  });
  return { server, received, lists };
}

function memoryStore() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return map.has(key) ? JSON.parse(JSON.stringify(map.get(key))) : null;
    },
    async set(key, value, options) {
      if (options && options.onlyIfNew && map.has(key)) return { modified: false };
      map.set(key, JSON.parse(JSON.stringify(value)));
      return { modified: true };
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

function marker(store, email) {
  const hash = crypto.createHmac('sha256', SALT).update(email).digest('hex');
  return store.map.get('signup:' + hash) || null;
}

async function main() {
  const { server, received, lists } = statefulSesStub();
  const host = ['127', '0', '0', '1'].join('.');
  await new Promise((resolve) => server.listen(0, host, resolve));
  const port = server.address().port;

  try {
    const env = Object.assign({}, ENV, {
      AWS_ENDPOINT_URL_SES: 'http://' + host + ':' + port,
    });
    const clock = { ms: Date.UTC(2026, 10, 23, 21, 0, 0) };
    const store = memoryStore();
    const handler = createHandler({
      store,
      provider: createSesProvider({ env }),
      logger: { log() {}, error() {} },
      env,
      now: () => clock.ms,
    });

    const post = (email, marketing) =>
      handler({
        httpMethod: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-nf-client-connection-ip': '203.0.113.' + (1 + received.length % 200),
        },
        body: JSON.stringify({
          email,
          honeypot: '',
          source: 'consent-probe',
          beta_consent: true,
          marketing_consent: marketing,
        }),
      });

    const promo = () => lists.get('trackd-promo') || new Set();
    const rows = [];

    const record = (label, email) => {
      const rec = marker(store, email);
      const storedMarketing = rec && rec.consent && rec.consent.marketing === true;
      const inAudience = promo().has(email);
      rows.push({
        case: label,
        status: rec ? 'accepted' : 'no marker',
        consent_marketing: storedMarketing,
        consent_marketingAt: rec && rec.consent ? rec.consent.marketingAt : null,
        in_promo_list: inAudience,
        CONSISTENT: storedMarketing === inAudience,
      });
    };

    const HOUR = 60 * 60 * 1000;
    const COOLDOWN = 24 * HOUR;

    // 1. opt-in, first signup
    await post('optin@example.com', true);
    record('opt-in, first signup', 'optin@example.com');

    // 2. withdrawal after the cooldown
    await post('withdraw@example.com', true);
    clock.ms += COOLDOWN + HOUR;
    await post('withdraw@example.com', false);
    record('withdrawal after cooldown', 'withdraw@example.com');

    // 3. opt-in inside the resend cooldown
    await post('late@example.com', false);
    clock.ms += HOUR;
    await post('late@example.com', true);
    record('opt-in inside cooldown', 'late@example.com');

    // 4. withdrawal inside the resend cooldown
    await post('quick@example.com', true);
    clock.ms += HOUR;
    await post('quick@example.com', false);
    record('withdrawal inside cooldown', 'quick@example.com');

    // 5. beta only, for contrast: never in the promotional audience
    await post('betaonly@example.com', false);
    record('beta only, first signup', 'betaonly@example.com');

    console.log(JSON.stringify({ rows, wire: received.map((r) => r.method + ' ' + r.path) }, null, 2));

    const failures = rows.filter((r) => !r.CONSISTENT);
    if (failures.length) {
      console.error('\nINCONSISTENT rows: ' + failures.map((f) => f.case).join(', '));
      process.exitCode = 1;
      return;
    }
    console.log('\nAll ' + rows.length + ' rows consistent: stored consent === promotional membership.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error('probe failed:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
