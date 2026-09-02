// Trackd Background Service Worker
// Handles Gmail API authentication, email fetching, and trial alert scheduling

const STORAGE_KEY = 'trackd_subscriptions';
const TRIALS_STORAGE_KEY = 'trackd_trials';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

// --- Trial Detection Constants ---

const TRIAL_KEYWORDS = [
  'free trial', 'trial ends', 'trial ending', 'trial period',
  'trial converting', 'trial expired', 'trial will end',
  'your trial', 'trial started', 'trial activation',
  'complimentary trial', 'risk-free trial', 'trial expires',
  'trial is ending', 'trial membership', 'trial subscription',
];

// --- Chrome Extension Identity Helpers ---

async function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

function clearAuthToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => {
      resolve();
    });
  });
}

// --- Gmail API ---

async function gmailFetch(token, path, params = {}) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      v.forEach(val => url.searchParams.append(k, val));
    } else {
      url.searchParams.set(k, v);
    }
  });
  
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail API error ${res.status}: ${err}`);
  }
  
  return res.json();
}

// --- Subscription Detection Engine ---
//
// Multi-signal scoring system with 100+ known subscription merchants.
// Each email is classified into: ACTIVE (confirmed), CANDIDATE (needs review),
// or DROP (not a subscription).

const KNOWN_MERCHANTS = [
  // === Streaming ===
  { name: 'Netflix', patterns: [/netflix/i, /nflx/i], score: 10, type: 'streaming' },
  { name: 'Spotify', patterns: [/spotify/i], score: 10, type: 'music' },
  { name: 'Apple Music', patterns: [/apple music/i], score: 8, type: 'music' },
  { name: 'Apple TV+', patterns: [/apple tv/i, /apple tv\+/i], score: 8, type: 'streaming' },
  { name: 'Disney+', patterns: [/disney/i], score: 10, type: 'streaming' },
  { name: 'HBO Max', patterns: [/hbomax/i, /hbo max/i, /max\.com/i], score: 8, type: 'streaming' },
  { name: 'Hulu', patterns: [/hulu/i], score: 10, type: 'streaming' },
  { name: 'Peacock', patterns: [/peacock/i], score: 8, type: 'streaming' },
  { name: 'Paramount+', patterns: [/paramount/i], score: 8, type: 'streaming' },
  { name: 'YouTube Premium', patterns: [/youtube.?premium/i, /youtubemusic/i], score: 8, type: 'streaming' },
  { name: 'Twitch', patterns: [/twitch/i], score: 8, type: 'streaming' },
  { name: 'Crunchyroll', patterns: [/crunchyroll/i], score: 8, type: 'streaming' },
  { name: 'SiriusXM', patterns: [/siriusxm/i], score: 8, type: 'streaming' },
  { name: 'Sling TV', patterns: [/sling/i], score: 8, type: 'streaming' },
  { name: 'Fubo', patterns: [/fubo/i], score: 8, type: 'streaming' },
  { name: 'DAZN', patterns: [/dazn/i], score: 8, type: 'streaming' },
  { name: 'ESPN+', patterns: [/espn\+/i], score: 8, type: 'streaming' },
  { name: 'Pandora', patterns: [/pandora/i], score: 8, type: 'music' },
  { name: 'Tidal', patterns: [/tidal/i], score: 8, type: 'music' },
  { name: 'Deezer', patterns: [/deezer/i], score: 8, type: 'music' },

  // === SaaS / Productivity ===
  { name: 'Adobe Creative Cloud', patterns: [/adobe/i, /creative.?cloud/i], score: 8, type: 'saas' },
  { name: 'Microsoft 365', patterns: [/microsoft 365/i, /office 365/i], score: 8, type: 'saas' },
  { name: 'Google Workspace', patterns: [/google workspace/i, /g.?suite/i], score: 8, type: 'saas' },
  { name: 'Dropbox', patterns: [/dropbox/i], score: 8, type: 'saas' },
  { name: 'iCloud', patterns: [/icloud/i], score: 8, type: 'saas' },
  { name: 'Notion', patterns: [/notion/i], score: 8, type: 'saas' },
  { name: 'Slack', patterns: [/slack/i], score: 8, type: 'saas' },
  { name: 'GitHub', patterns: [/github/i], score: 8, type: 'saas' },
  { name: 'GitLab', patterns: [/gitlab/i], score: 8, type: 'saas' },
  { name: 'Figma', patterns: [/figma/i], score: 8, type: 'saas' },
  { name: 'Canva', patterns: [/canva/i], score: 8, type: 'saas' },
  { name: 'Medium', patterns: [/medium/i], score: 8, type: 'saas' },
  { name: 'LinkedIn', patterns: [/linkedin/i], score: 8, type: 'saas' },
  { name: 'ChatGPT', patterns: [/chatgpt/i, /open.?ai/i], score: 8, type: 'saas' },
  { name: 'Claude', patterns: [/claude/i, /anthropic/i], score: 8, type: 'saas' },
  { name: 'Gemini', patterns: [/gemini/i], score: 8, type: 'saas' },
  { name: 'Perplexity', patterns: [/perplexity/i], score: 8, type: 'saas' },
  { name: 'Grammarly', patterns: [/grammarly/i], score: 8, type: 'saas' },
  { name: 'Evernote', patterns: [/evernote/i], score: 8, type: 'saas' },
  { name: 'Todoist', patterns: [/todoist/i], score: 8, type: 'saas' },
  { name: 'Trello', patterns: [/trello/i], score: 8, type: 'saas' },
  { name: 'Asana', patterns: [/asana/i], score: 8, type: 'saas' },
  { name: 'Monday.com', patterns: [/monday\.com/i], score: 8, type: 'saas' },
  { name: 'Linear', patterns: [/linear/i], score: 8, type: 'saas' },
  { name: 'Jira', patterns: [/jira/i, /atlassian/i], score: 8, type: 'saas' },
  { name: 'Confluence', patterns: [/confluence/i], score: 8, type: 'saas' },
  { name: 'Zendesk', patterns: [/zendesk/i], score: 8, type: 'saas' },
  { name: 'HubSpot', patterns: [/hubspot/i], score: 8, type: 'saas' },
  { name: 'Salesforce', patterns: [/salesforce/i], score: 8, type: 'saas' },
  { name: 'Zoom', patterns: [/zoom/i], score: 8, type: 'saas' },
  { name: 'Webex', patterns: [/webex/i], score: 6, type: 'saas' },
  { name: 'Loom', patterns: [/loom/i], score: 6, type: 'saas' },
  { name: 'Miro', patterns: [/miro/i], score: 6, type: 'saas' },
  { name: 'Vercel', patterns: [/vercel/i], score: 6, type: 'saas' },
  { name: 'DigitalOcean', patterns: [/digitalocean/i], score: 6, type: 'saas' },
  { name: 'Supabase', patterns: [/supabase/i], score: 6, type: 'saas' },
  { name: 'Render', patterns: [/render/i], score: 6, type: 'saas' },
  { name: 'Heroku', patterns: [/heroku/i], score: 6, type: 'saas' },
  { name: 'WordPress.com', patterns: [/wordpress/i], score: 6, type: 'saas' },
  { name: 'Squarespace', patterns: [/squarespace/i], score: 6, type: 'saas' },
  { name: 'Shopify', patterns: [/shopify/i], score: 6, type: 'saas' },
  { name: 'Mailchimp', patterns: [/mailchimp/i], score: 6, type: 'saas' },
  { name: 'ConvertKit', patterns: [/convertkit/i], score: 6, type: 'saas' },
  { name: 'Substack', patterns: [/substack/i], score: 8, type: 'saas' },
  { name: 'Ghost', patterns: [/ghost/i], score: 6, type: 'saas' },
  { name: 'Readwise', patterns: [/readwise/i], score: 6, type: 'saas' },
  { name: 'Feedly', patterns: [/feedly/i], score: 6, type: 'saas' },
  { name: '1Password', patterns: [/1password/i], score: 8, type: 'saas' },
  { name: 'Bitwarden', patterns: [/bitwarden/i], score: 6, type: 'saas' },
  { name: 'Dashlane', patterns: [/dashlane/i], score: 6, type: 'saas' },
  { name: 'NordVPN', patterns: [/nordvpn/i], score: 8, type: 'saas' },
  { name: 'ExpressVPN', patterns: [/expressvpn/i], score: 8, type: 'saas' },
  { name: 'Proton Mail', patterns: [/protonmail/i, /proton\.me/i], score: 8, type: 'saas' },
  { name: 'Proton VPN', patterns: [/proton.?vpn/i], score: 8, type: 'saas' },

  // === Health / Fitness ===
  { name: 'Peloton', patterns: [/peloton/i], score: 8, type: 'fitness' },
  { name: 'Strava', patterns: [/strava/i], score: 8, type: 'fitness' },
  { name: 'MyFitnessPal', patterns: [/myfitnesspal/i], score: 6, type: 'fitness' },
  { name: 'Headspace', patterns: [/headspace/i], score: 8, type: 'fitness' },
  { name: 'Calm', patterns: [/calm/i], score: 8, type: 'fitness' },
  { name: 'Noom', patterns: [/noom/i], score: 8, type: 'fitness' },
  { name: 'ClassPass', patterns: [/classpass/i], score: 8, type: 'fitness' },
  { name: 'Planet Fitness', patterns: [/planet.?fitness/i], score: 6, type: 'fitness' },

  // === Storage / Backup ===
  { name: 'Google One', patterns: [/google one/i], score: 8, type: 'storage' },
  { name: 'Backblaze', patterns: [/backblaze/i], score: 6, type: 'storage' },
  { name: 'Mega', patterns: [/mega\.nz/i], score: 6, type: 'storage' },
  { name: 'pCloud', patterns: [/pcloud/i], score: 6, type: 'storage' },

  // === Domain / Hosting ===
  { name: 'Namecheap', patterns: [/namecheap/i], score: 6, type: 'hosting' },
  { name: 'GoDaddy', patterns: [/godaddy/i], score: 6, type: 'hosting' },
  { name: 'Hover', patterns: [/hover/i], score: 6, type: 'hosting' },
  { name: 'Cloudflare', patterns: [/cloudflare/i], score: 6, type: 'hosting' },

  // === News / Media ===
  { name: 'New York Times', patterns: [/nytimes/i, /new.?york.?times/i], score: 8, type: 'news' },
  { name: 'Washington Post', patterns: [/washington.?post/i], score: 8, type: 'news' },
  { name: 'Wall Street Journal', patterns: [/wall.?street.?journal/i, /wsj/i], score: 8, type: 'news' },
  { name: 'The Atlantic', patterns: [/theatlantic/i], score: 8, type: 'news' },
  { name: 'The Economist', patterns: [/economist/i], score: 8, type: 'news' },
  { name: 'NPR', patterns: [/npr\.org/i], score: 6, type: 'news' },
];

const RECEIPT_KEYWORDS = [
  'receipt', 'invoice', 'subscription', 'renewal', 'payment',
  'your order', 'order confirmation', 'billing', 'charged',
  'your receipt', 'payment confirmation', 'purchase',
  'you paid', 'paid', 'statement', 'auto-renew',
];

function isBillingEmail(subject, from, snippet) {
  const text = `${subject} ${from} ${snippet || ''}`;
  return RECEIPT_KEYWORDS.some(kw => text.toLowerCase().includes(kw));
}

/**
 * Check if the sender is a known payment processor (PayPal, Stripe, etc.)
 * rather than a direct subscription merchant.
 */
function isPaymentProcessor(from) {
  return PAYMENT_PROCESSORS.some(p => p.test(from));
}

/**
 * Try to detect a known merchant name in the subject line alone.
 * Used when the email is from a payment processor (e.g. PayPal forwarding
 * a payment to Peacock TV).
 */
function detectMerchantInSubject(subject) {
  for (const merchant of KNOWN_MERCHANTS) {
    if (merchant.patterns.some(p => p.test(subject))) {
      return merchant;
    }
  }
  return null;
}

function detectMerchant(subject, from) {
  const text = `${subject} ${from}`;
  for (const merchant of KNOWN_MERCHANTS) {
    if (merchant.patterns.some(p => p.test(text))) {
      return merchant;
    }
  }
  return null;
}

// --- Intent Classification ---
//
// Intent buckets (priority-ordered). Each message falls into exactly one bucket.
//   ACTIVE     -> confident recurring subscription => include in monthly total.
//   CANCELLED  -> the subscription ended/canceled => present for review, not active.
//   TRIAL      -> free-trial email (handled by the independent trial pipeline).
//   CANDIDATE  -> possible subscription, low confidence => needs review.
//   DROP       -> clearly not a subscription (one-time order, payment failure, noise).

const INTENT_ACTIVE = 'active';
const INTENT_CANDIDATE = 'candidate';
const INTENT_DROP = 'drop';

// Strong one-time purchase / shipping / delivery language. These are the most
// common false positives: "your order has shipped", "delivery update",
// "track your package". Even from a known merchant, a shipping notice is not
// a recurring subscription.
const ONE_TIME_ORDER_RE = /(?:order (?:confirmation|confirmed|placed|is|has)|your order|shipping|delivery|delivered|track your|package|shipment|dispatch|checkout)/i;

// Payment-failure / method-update language. The user is not being charged, so
// this is not evidence of an active subscription.
const PAYMENT_FAILURE_RE = /(?:payment (?:failed|declined)|payment method|update (?:your )?(?:billing|payment)|couldn't? (?:process|verify) (?:your )?payment|verify (?:your )?billing|your card (?:was )?declined|re.?enter (?:your )?payment|billing details)/i;

// Strong subscription-billing language that confirms an active recurring plan.
const SUBSCRIPTION_ACTIVE_RE = /(?:will be (?:renewed|recurring)|auto-?renew|has been (?:renewed|charged)|next (?:billing|payment)|your (?:subscription|membership|plan).*renew|recurring|charged (?:you|for)|you (?:have been|were) charged|subscription (?:updated|confirmed)|plan (?:confirmed|activated)|billed (?:monthly|annually|yearly|weekly))/i;

// Payment processors that forward subscription payments. Emails from these
// senders often contain subscription merchant names in the subject line.
const PAYMENT_PROCESSORS = [
  /paypal/i, /stripe/i, /braintree/i, /square/i, /recurly/i,
  /chargebee/i, /paddle/i, /gumroad/i, /lemonsqueezy/i,
];

// Newsletter / promotional / noise language -> never a subscription.
const NOISE_RE = /(?:newsletter|unsubscribe|weekly (?:news|digest)|monthly digest|marketing|promotional|webinar|blog post|you might like|check out|flash sale|limited time|don't miss|sale ends|100% free|get started today|sign up now)/i;

/**
 * Normalize an email's subject + snippet for matching: collapse whitespace and
 * drop HTML tags (receipt snippets can contain inline markup).
 */
function normalizeEmailText(subject, snippet) {
  const raw = `${subject || ''} ${snippet || ''}`;
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Classify an email into an intent bucket using priority-ordered heuristics.
 * Subject line is weighted highest because most transactional emails put the
 * signal in the subject.
 */
function classifyEmail(subject, from, snippet) {
  const text = normalizeEmailText(subject, snippet);
  const subjectText = (subject || '').toLowerCase();

  // Strong recurring-subscription confirmation outweighs any promo/noise text
  // that a real renewal receipt may embed (e.g. "don't miss our new features").
  if (SUBSCRIPTION_ACTIVE_RE.test(text)) return INTENT_ACTIVE;

  // 1) Promotional / noise -> never a subscription.
  if (NOISE_RE.test(text)) return INTENT_DROP;

  // 2) One-time order / shipping / delivery -> drop even for known merchants.
  if (ONE_TIME_ORDER_RE.test(subjectText) || (
    ONE_TIME_ORDER_RE.test(text) && !SUBSCRIPTION_ACTIVE_RE.test(text)
  )) return INTENT_DROP;

  // 3) Payment failure -> drop.
  if (PAYMENT_FAILURE_RE.test(text)) return INTENT_DROP;

  // 4) Unknown sender with billing language, no strong signal -> candidate.
  if (isBillingEmail(subject, from, snippet)) return INTENT_CANDIDATE;

  // 5) Nothing pointing at a subscription -> drop.
  return INTENT_DROP;
}

function extractPrice(text) {
  // Only accept amounts that appear in a billing context.
  const billingContext = /(?:charged|charge|costs?|price|amount|total|plan|subscription|renewal|billing|payment|paid|due|per\s+(?:month|year|week)|\/(?:mo|month|yr|year))/i;
  const amountPatterns = [
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*\/\s*(?:mo|month|yr|year|monthly|annual)/i,
    /(?:USD|EUR|GBP)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i,
    /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:USD|EUR|GBP)/i,
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/,
  ];

  for (const pattern of amountPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;

    const value = parseFloat(match[1].replace(/,/g, ''));
    if (isNaN(value) || value <= 0 || value >= 10000) continue;

    const contextStart = Math.max(0, match.index - 80);
    const contextEnd = Math.min(text.length, match.index + match[0].length + 80);
    if (billingContext.test(text.slice(contextStart, contextEnd))) return value;
  }

  return null;
}

function buildSubscription(detail, headers, snippet) {
  const merchant = detectMerchant(headers.subject, headers.from);
  if (!merchant) return null;

  if (indicatesEndedSubscription(headers.subject, snippet)) return null;

  const price = extractPrice(snippet);
  return {
    id: detail.id,
    name: merchant.name,
    type: merchant.type,
    price,
    frequency: detectFrequency(snippet),
    renewalDate: headers.date,
    source: 'gmail',
    detected: new Date().toISOString(),
    status: 'active',
  };
}

/**
 * Heuristic: detect email language indicating a subscription was canceled or
 * ended, so it is not presented as an active subscription.
 */
function indicatesEndedSubscription(subject, snippet) {
  const text = `${subject} ${snippet}`.toLowerCase();
  return (
    /\b(?:canceled|cancelled)\b/.test(text) ||
    /\b(?:subscription|membership|plan|trial)\s+(?:has )?(?:been )?(?:canceled|cancelled|ended|expired)\b/i.test(text) ||
    /\bsubscription (?:ended|expired|canceled|cancelled)\b/i.test(text) ||
    /\b(?:sorry to see you go|you've been refunded|reactivate (?:your|the) (?:subscription|account|plan))\b/i.test(text) ||
    /\b(?:your subscription (?:is|has) (?:no longer active|being canceled|canceled))\b/i.test(text) ||
    /\b(?:on\s+\d+\s*\/\s*\d+\s*(?:\/\s*\d+)?\s*(?:your\s+)?subscription\s+(?:was|canceled|cancelled))\b/i.test(text) ||
    /\b(?:obviously we don't want this\b|look forward to having you\s+(?:back|again))\b/i.test(text)
  );
}

/**
 * Best-effort sender name for an unrecognized billing email.
 */
function deriveSenderName(from) {
  let clean = from.replace(/<.*>/, '').trim();
  if (!clean) {
    const addr = from.match(/<?([^@\s]+)@/);
    clean = addr ? addr[1] : from;
  }
  clean = clean.replace(/^"|"$/g, '').replace(/@.*$/, '').trim();
  if (!clean) return 'Unknown Service';
  return clean.replace(/\b\w/g, c => c.toUpperCase()).substring(0, 40);
}

/**
 * Build a review candidate for a billing email whose merchant is not in the
 * KNOWN_MERCHANTS list. It stays out of the monthly total until the user
 * confirms it is a real subscription.
 */
function buildCandidate(detail, headers, snippet) {
  return {
    id: detail.id,
    name: deriveSenderName(headers.from),
    type: 'other',
    price: extractPrice(snippet),
    frequency: detectFrequency(snippet),
    renewalDate: headers.date,
    source: 'gmail',
    detected: new Date().toISOString(),
    status: 'pending',
    recognized: false,
  };
}

function detectFrequency(text) {
  if (/\/yr|\/year|\/annual|yearly|annual/i.test(text)) return 'yearly';
  if (/\/mo|\/month|\/monthly|monthly/i.test(text)) return 'monthly';
  if (/weekly|per week/i.test(text)) return 'weekly';
  return 'monthly';
}

// --- Trial Detection Functions ---

function containsTrialLanguage(subject, snippet) {
  const text = `${subject} ${snippet}`.toLowerCase();
  return TRIAL_KEYWORDS.some(kw => text.includes(kw));
}

function parseTrialEndDate(snippet, emailDateStr) {
  const trialIdx = snippet.toLowerCase().indexOf('trial');
  if (trialIdx !== -1) {
    const start = Math.max(0, trialIdx - 120);
    const end = Math.min(snippet.length, trialIdx + 250);
    const context = snippet.substring(start, end);

    const datePatterns = [
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i,
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\b/i,
      /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i,
      /\b\d{1,2}\/\d{1,2}\/\d{4}\b/,
      /\b\d{4}-\d{2}-\d{2}\b/,
      /\b\d{1,2}\.\d{1,2}\.\d{4}\b/,
    ];

    for (const pattern of datePatterns) {
      const m = context.match(pattern);
      if (m) {
        let dateStr = m[1] || m[0];
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) return parsed;
      }
    }
  }

  const emailDate = new Date(emailDateStr);
  if (isNaN(emailDate.getTime())) return null;

  const dayMatch = snippet.match(/(\d+)[-\s]day\s+(?:free\s+)?trial/i);
  if (dayMatch) {
    const days = parseInt(dayMatch[1], 10);
    const endDate = new Date(emailDate);
    endDate.setDate(endDate.getDate() + days);
    return endDate;
  }

  const relativePatterns = [
    /(?:ends?|expires?)\s+in\s+(\d+)\s+days?/i,
    /(\d+)\s+days?\s+(?:remaining|left|to go)/i,
  ];
  for (const pattern of relativePatterns) {
    const m = snippet.match(pattern);
    if (m) {
      const days = parseInt(m[1], 10);
      const endDate = new Date(emailDate);
      endDate.setDate(endDate.getDate() + days);
      return endDate;
    }
  }

  return null;
}

function detectTrialName(snippet, subject) {
  const text = `${subject} ${snippet}`;
  for (const merchant of KNOWN_MERCHANTS) {
    if (merchant.patterns.some(p => p.test(text))) {
      return merchant.name;
    }
  }
  const trialIdx = text.toLowerCase().indexOf('trial');
  if (trialIdx !== -1) {
    const before = text.substring(Math.max(0, trialIdx - 60), trialIdx).trim();
    const nameMatch = before.match(/([A-Z][A-Za-z0-9\s&.]+)\s*(?:free\s+)?trial/i);
    if (nameMatch) return nameMatch[1].trim();
  }
  return null;
}

// --- Trial Storage & Alarm Helpers ---

function saveTrials(trials) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [TRIALS_STORAGE_KEY]: trials }, resolve);
  });
}

function loadTrials() {
  return new Promise(resolve => {
    chrome.storage.local.get(TRIALS_STORAGE_KEY, (data) => {
      resolve(data[TRIALS_STORAGE_KEY] || []);
    });
  });
}

function scheduleTrialAlarm(trial) {
  const endMs = new Date(trial.endDate).getTime();
  const alarmTime = endMs - 24 * 60 * 60 * 1000;
  if (alarmTime <= Date.now()) return;
  const alarmName = `trial_${trial.id}`;
  chrome.alarms.create(alarmName, { when: alarmTime });
}

async function mergeAndScheduleTrials(newTrials) {
  const existing = await loadTrials();
  const merged = [...existing];

  for (const trial of newTrials) {
    const idx = merged.findIndex(t => t.id === trial.id);
    if (idx >= 0) {
      merged[idx] = trial;
    } else {
      merged.push(trial);
    }
  }

  const now = Date.now();
  const active = merged.filter(t => new Date(t.endDate).getTime() > now);
  await saveTrials(active);

  for (const trial of active) {
    scheduleTrialAlarm(trial);
  }
}

// --- Alarm Listener ---

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name && alarm.name.startsWith('trial_')) {
    const trialId = alarm.name.replace('trial_', '');
    loadTrials().then(trials => {
      const trial = trials.find(t => t.id === trialId);
      if (trial) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Free Trial Ending Soon',
          message: `Your ${trial.name || 'subscription'} free trial expires in less than 24 hours!`,
          priority: 2,
        });
      }
    });
  }
});

// --- Main Scanning Logic ---

async function scanInbox(token) {
  const searchStrategies = [
    `newer_than:1y (receipt OR invoice OR subscription OR renewal OR payment)`,
    `newer_than:1y ("free trial" OR "trial ends" OR "trial expires" OR "trial ending")`,
    `newer_than:1y receipt`,
    `newer_than:1y subscription`,
    `newer_than:1y invoice`,
    `newer_than:1y "your receipt"`,
    `newer_than:1y "order confirmation"`,
    `newer_than:1y billing`,
  ];

  const seenIds = new Set();
  let allMessageIds = [];

  for (const query of searchStrategies) {
    console.log(`[Trackd] Searching: ${query}`);
    let nextPageToken = null;

    try {
      do {
        const params = { q: query, maxResults: 500 };
        if (nextPageToken) params.pageToken = nextPageToken;
        const listData = await gmailFetch(token, 'messages', params);

        if (listData.messages) {
          for (const msg of listData.messages) {
            if (!seenIds.has(msg.id)) {
              seenIds.add(msg.id);
              allMessageIds.push(msg);
            }
          }
        }
        nextPageToken = listData.nextPageToken || null;
      } while (nextPageToken);
    } catch (e) {
      console.log(`[Trackd] Search query failed: ${query} - ${e.message}`);
    }
  }

  if (allMessageIds.length === 0) {
    console.log(`[Trackd] Keyword search found nothing. Trying fallback...`);
    try {
      const fallback = await gmailFetch(token, 'messages', { maxResults: 50 });
      if (fallback.messages && fallback.messages.length > 0) {
        console.log(`[Trackd] Fallback found ${fallback.messages.length} messages. API is working.`);
        return { subscriptions: [], trials: [], _fallbackCount: fallback.messages.length };
      }
    } catch (e) {
      console.log(`[Trackd] Fallback also failed: ${e.message}`);
    }
    return { subscriptions: [], trials: [] };
  }

  console.log(`[Trackd] Found ${allMessageIds.length} billing-related emails, processing...`);

  const settings = await new Promise(r => chrome.storage.local.get('trackd_settings', v => r(v.trackd_settings || {})));
  const MAX_MESSAGES = Math.min(settings.maxMessages || 200, 1000);
  if (allMessageIds.length > MAX_MESSAGES) {
    allMessageIds.length = MAX_MESSAGES;
    console.log(`[Trackd] Capped to ${MAX_MESSAGES} most recent (maxMessages setting).`);
  }

  const subscriptionResults = [];
  const trialResults = [];
  const batchSize = 10;
  let _loggedHeaders = false;

  for (let i = 0; i < allMessageIds.length; i += batchSize) {
    const batch = allMessageIds.slice(i, i + batchSize);

    let details;
    try {
      details = await Promise.all(
        batch.map(msg => gmailFetch(token, `messages/${msg.id}`, { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] }))
      );
    } catch (e) {
      console.log(`[Trackd] Batch fetch error at ${i}: ${e.message}`);
      continue;
    }

    if (i % 100 === 0) {
      console.log(`[Trackd] Processing ${i + batchSize}/${allMessageIds.length} emails...`);
    }

    for (const detail of details) {
      const headers = {};
      (detail.payload?.headers || []).forEach(h => { headers[h.name] = h.value; });

      const subject = headers['Subject'] || '';
      const from = headers['From'] || '';
      const date = headers['Date'] || '';
      const snippet = detail.snippet || '';

      if (i === 0 && !_loggedHeaders) {
        _loggedHeaders = true;
        const headerNames = (detail.payload?.headers || []).map(h => h.name);
        console.log(`[Trackd] First email headers: ${headerNames.join(', ')}`);
        console.log(`[Trackd] Subject="${subject}" From="${from}"`);
      }

      const intent = classifyEmail(subject, from, snippet);
      const merchant = detectMerchant(subject, from);
      const isEnded = merchant && indicatesEndedSubscription(subject, snippet);

      // Special case: email from a payment processor (PayPal, Stripe) with
      // a known merchant name in the subject. Treat as a confirmed subscription.
      const paymentProcessorMerchant = !merchant && isPaymentProcessor(from) ? detectMerchantInSubject(subject) : null;

      if (paymentProcessorMerchant) {
        // PayPal forwarding a payment to a known subscription merchant
        const price = extractPrice(snippet);
        subscriptionResults.push({
          id: detail.id,
          name: paymentProcessorMerchant.name,
          type: paymentProcessorMerchant.type,
          price,
          frequency: detectFrequency(snippet),
          renewalDate: date,
          source: 'gmail',
          detected: new Date().toISOString(),
          status: 'active',
        });
        if (subscriptionResults.length <= 5) {
          console.log(`[Trackd] + Found (via payment processor): "${paymentProcessorMerchant.name}" price=${price}`);
        }
      } else if (isEnded) {
        subscriptionResults.push(buildCandidate(detail, { subject, from, date }, snippet));
        console.log(`[Trackd] * Ended/canceled (for review): "${deriveSenderName(from)}"`);
      } else if (intent === INTENT_DROP) {
        // Silently skip
      } else if (merchant) {
        const subscription = buildSubscription(detail, { subject, from, date }, snippet);
        if (subscription) {
          subscriptionResults.push(subscription);
          if (subscriptionResults.length <= 5) {
            console.log(`[Trackd] + Found: "${subscription.name}" price=${subscription.price}`);
          }
        }
      } else {
        if (intent === INTENT_ACTIVE || isBillingEmail(subject, from, snippet)) {
          subscriptionResults.push(buildCandidate(detail, { subject, from, date }, snippet));
        }
      }

      if (containsTrialLanguage(subject, snippet)) {
        const trialEndDate = parseTrialEndDate(snippet, date);
        if (trialEndDate) {
          const trialName = detectTrialName(snippet, subject) || 'Service';
          trialResults.push({
            id: `trial_${detail.id}`,
            name: trialName,
            endDate: trialEndDate.toISOString(),
            emailDate: date,
            source: 'gmail',
            detected: new Date().toISOString(),
          });
        }
      }
    }
  }

  const seen = new Map();
  for (const sub of subscriptionResults) {
    const existing = seen.get(sub.name);
    if (!existing || new Date(sub.renewalDate) > new Date(existing.renewalDate)) {
      seen.set(sub.name, sub);
    }
  }

  if (trialResults.length > 0) {
    await mergeAndScheduleTrials(trialResults);
  }

  return {
    subscriptions: Array.from(seen.values()),
    trials: trialResults,
  };
}

// --- Storage ---

function saveSubscriptions(subs) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: subs }, resolve);
  });
}

function loadSubscriptions() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      resolve(data[STORAGE_KEY] || []);
    });
  });
}

// --- Message Handler ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'getAuthStatus': {
          const subs = await loadSubscriptions();
          sendResponse({ authorized: subs.length > 0, count: subs.length });
          break;
        }

        case 'scanInbox': {
          const token = await getAuthToken(true);
          const result = await scanInbox(token);
          await saveSubscriptions(result.subscriptions);
          sendResponse({ success: true, count: result.subscriptions.length, subscriptions: result.subscriptions });
          break;
        }

        case 'getSubscriptions': {
          const subs = await loadSubscriptions();
          sendResponse({ subscriptions: subs });
          break;
        }

        case 'getTrials': {
          const trials = await loadTrials();
          sendResponse({ trials });
          break;
        }

        case 'saveSettings': {
          await new Promise(r => chrome.storage.local.set({ trackd_settings: request.settings }, r));
          sendResponse({ success: true });
          break;
        }

        case 'addManual': {
          const subs = await loadSubscriptions();
          subs.push({
            ...request.subscription,
            id: `manual_${Date.now()}`,
            source: 'manual',
            detected: new Date().toISOString(),
            status: 'active',
          });
          await saveSubscriptions(subs);
          sendResponse({ success: true });
          break;
        }

        case 'removeSubscription': {
          const subs = await loadSubscriptions();
          const filtered = subs.filter(s => s.id !== request.id);
          await saveSubscriptions(filtered);
          sendResponse({ success: true });
          break;
        }

        case 'confirmSubscription': {
          const subs = await loadSubscriptions();
          const target = subs.find(s => s.id === request.id);
          if (!target) {
            sendResponse({ success: false, error: 'Subscription not found' });
            break;
          }
          if (!target.price) {
            target.price = request.price ? Number(request.price) : null;
          }
          target.status = 'active';
          target.recognized = true;
          await saveSubscriptions(subs);
          sendResponse({ success: true, subscriptions: subs });
          break;
        }

        case 'updateSubscriptionPrice': {
          const subs = await loadSubscriptions();
          const target = subs.find(s => s.id === request.id);
          if (!target) {
            sendResponse({ success: false, error: 'Subscription not found' });
            break;
          }
          const price = Number(request.price);
          if (isNaN(price) || price <= 0) {
            sendResponse({ success: false, error: 'Invalid price' });
            break;
          }
          target.price = price;
          if (request.frequency) target.frequency = request.frequency;
          await saveSubscriptions(subs);
          sendResponse({ success: true, subscriptions: subs });
          break;
        }

        case 'clearAuth': {
          const subs = await loadSubscriptions();
          if (subs.length > 0) {
            await chrome.storage.local.set({ ['trackd_backup']: subs });
          }
          await chrome.storage.local.remove(STORAGE_KEY);

          try {
            const token = await getAuthToken(false);
            if (token) {
              await clearAuthToken(token);
              await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
            }
          } catch (e) {}

          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ error: `Unknown action: ${request.action}` });
      }
    } catch (e) {
      sendResponse({ error: e.message });
    }
  })();

  return true;
});