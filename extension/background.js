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
      // Gmail API expects multiple params for arrays (e.g. metadataHeaders=From&metadataHeaders=Subject)
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

// --- Subscription Detection ---

const KNOWN_MERCHANTS = [
  // Streaming
  { name: 'Netflix', patterns: [/netflix/i, /nflx/i], type: 'streaming' },
  { name: 'Spotify', patterns: [/spotify/i], type: 'music' },
  { name: 'Apple Music', patterns: [/apple music/i], type: 'music' },
  { name: 'Apple TV+', patterns: [/apple tv/i, /apple tv\+/i], type: 'streaming' },
  { name: 'Disney+', patterns: [/disney\s?\+/i, /disneyplus/i], type: 'streaming' },
  { name: 'HBO Max', patterns: [/hbo[-\s]?max/i, /hbomax/i, /max\.com/i], type: 'streaming' },
  { name: 'Hulu', patterns: [/hulu/i], type: 'streaming' },
  { name: 'Peacock', patterns: [/peacock/i], type: 'streaming' },
  { name: 'Paramount+', patterns: [/paramount/i], type: 'streaming' },
  { name: 'YouTube Premium', patterns: [/youtube (premium|music)/i, /youtubepremium/i], type: 'streaming' },
  { name: 'Twitch', patterns: [/twitch/i], type: 'streaming' },
  { name: 'Crunchyroll', patterns: [/crunchyroll/i], type: 'streaming' },
  
  // SaaS / Productivity
  { name: 'Adobe Creative Cloud', patterns: [/adobe/i, /creative.?cloud/i], type: 'saas' },
  { name: 'Microsoft 365', patterns: [/microsoft 365/i, /office 365/i, /microsoft365/i], type: 'saas' },
  { name: 'Google Workspace', patterns: [/google workspace/i, /g.?suite/i], type: 'saas' },
  { name: 'Dropbox', patterns: [/dropbox/i], type: 'saas' },
  { name: 'iCloud+', patterns: [/icloud/i], type: 'saas' },
  { name: 'Notion', patterns: [/notion/i], type: 'saas' },
  { name: 'Slack', patterns: [/slack/i], type: 'saas' },
  { name: 'GitHub', patterns: [/github/i], type: 'saas' },
  { name: 'GitLab', patterns: [/gitlab/i], type: 'saas' },
  { name: 'Figma', patterns: [/figma/i], type: 'saas' },
  { name: 'Canva', patterns: [/canva/i], type: 'saas' },
  { name: 'Medium', patterns: [/medium/i], type: 'saas' },
  { name: 'LinkedIn Premium', patterns: [/linkedin/i], type: 'saas' },
  { name: 'ChatGPT Plus', patterns: [/chatgpt/i, /open.?ai/i], type: 'saas' },
  
  // Health / Fitness
  { name: 'Peloton', patterns: [/peloton/i], type: 'fitness' },
  { name: 'Strava', patterns: [/strava/i], type: 'fitness' },
  
  // Storage / Backup
  { name: 'Google One', patterns: [/google one/i], type: 'storage' },
  { name: 'iCloud Storage', patterns: [/icloud.?storage/i], type: 'storage' },
];

const RECEIPT_KEYWORDS = [
  'receipt', 'invoice', 'subscription', 'renewal', 'payment',
  'your order', 'order confirmation', 'billing', 'charged',
  'your receipt', 'payment confirmation', 'purchase',
  'you paid', 'statement', 'auto-renew',
];

function isBillingEmail(subject, from) {
  const text = `${subject} ${from}`;
  return RECEIPT_KEYWORDS.some(kw => text.toLowerCase().includes(kw));
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

function extractPrice(text) {
  // Match common price patterns: $9.99, $19.99/mo, $119.99/yr
  const patterns = [
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*\/\s*(mo|month|yr|year|monthly|annual)/i,
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/,
    /(\d{1,3}(?:\.\d{2})?)\s*(USD|EUR|GBP)/i,
  ];
  
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0 && val < 10000) return val;
    }
  }
  return null;
}

function detectFrequency(text) {
  if (/\/yr|\/year|\/annual|yearly|annual/i.test(text)) return 'yearly';
  if (/\/mo|\/month|\/monthly|monthly/i.test(text)) return 'monthly';
  if (/weekly|per week/i.test(text)) return 'weekly';
  return 'monthly'; // default assumption
}

// --- Trial Detection Functions ---

/**
 * Check if email content contains trial-related language.
 */
function containsTrialLanguage(subject, snippet) {
  const text = `${subject} ${snippet}`.toLowerCase();
  return TRIAL_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * Try to extract a trial end date by examining text near "trial" keywords,
 * N-day trial patterns, and relative date phrases.
 * Returns a Date object or null if no date could be parsed.
 */
function parseTrialEndDate(snippet, emailDateStr) {
  // Strategy 1: Find an explicit date near "trial" context
  const trialIdx = snippet.toLowerCase().indexOf('trial');
  if (trialIdx !== -1) {
    const start = Math.max(0, trialIdx - 120);
    const end = Math.min(snippet.length, trialIdx + 250);
    const context = snippet.substring(start, end);

    const datePatterns = [
      // Month DD, YYYY  or  Mon DD, YYYY
      /(\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b)/i,
      /(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\b)/i,
      // DD Month YYYY
      /(\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b)/i,
      // MM/DD/YYYY
      /(\b\d{1,2}\/\d{1,2}\/\d{4}\b)/,
      // YYYY-MM-DD
      /(\b\d{4}-\d{2}-\d{2}\b)/,
      // DD.MM.YYYY
      /(\b\d{1,2}\.\d{1,2}\.\d{4}\b)/,
      // "DDth of Month, YYYY" e.g. "15th of January, 2025"
      /(\b\d{1,2}(?:st|nd|rd|th)?\s+of\s+(?:January|February|March|April|May|June|July|August|September|October|November|December),?\s+\d{4}\b)/i,
    ];

    for (const pattern of datePatterns) {
      const m = context.match(pattern);
      if (m) {
        // Normalize date string before parsing
        let dateStr = m[1];
        // Strip ordinal suffixes (15th -> 15)
        dateStr = dateStr.replace(/(\d+)(st|nd|rd|th)/i, '$1');
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
  }

  const emailDate = new Date(emailDateStr);
  if (isNaN(emailDate.getTime())) return null;

  // Strategy 2: "N-day free trial" — calculate end date from the email date
  const dayMatch = snippet.match(/(\d+)[-\s]day\s+(?:free\s+)?trial/i);
  if (dayMatch) {
    const days = parseInt(dayMatch[1], 10);
    const endDate = new Date(emailDate);
    endDate.setDate(endDate.getDate() + days);
    return endDate;
  }

  // Strategy 3: Relative phrases like "ends in X days", "X days remaining"
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

  // Strategy 4: "expires MM/DD" or "valid through Month DD"
  const nearDatePatterns = [
    /expires?\s+(\d{1,2}\/\d{1,4})/i,
    /valid\s+through\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
    /through\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ];
  for (const pattern of nearDatePatterns) {
    const m = snippet.match(pattern);
    if (m) {
      // Attempt to resolve partial dates (e.g. "MM/DD" with current year)
      let dateStr = m[1];
      if (/^\d{1,2}\/\d{1,2}$/.test(dateStr)) {
        dateStr += `/${emailDate.getFullYear()}`;
      }
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime()) && parsed > emailDate) {
        return parsed;
      }
    }
  }

  return null;
}

/**
 * Identify the service or product name associated with a trial email.
 */
function detectTrialName(snippet, subject) {
  const text = `${subject} ${snippet}`;
  for (const merchant of KNOWN_MERCHANTS) {
    if (merchant.patterns.some(p => p.test(text))) {
      return merchant.name;
    }
  }

  // Fallback: try to extract a service name near "trial" context
  const trialIdx = text.toLowerCase().indexOf('trial');
  if (trialIdx !== -1) {
    const before = text.substring(Math.max(0, trialIdx - 60), trialIdx).trim();
    // Look for capitalized words that could be a service name
    const nameMatch = before.match(/([A-Z][A-Za-z0-9\s&.]+)\s*(?:free\s+)?trial/i);
    if (nameMatch) {
      return nameMatch[1].trim();
    }
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

/**
 * Schedule a chrome.alarms alarm 24 hours before the trial end date.
 * If the alarm time has already passed, it is not scheduled.
 */
function scheduleTrialAlarm(trial) {
  const endMs = new Date(trial.endDate).getTime();
  const alarmTime = endMs - 24 * 60 * 60 * 1000; // 24 hours before expiry
  if (alarmTime <= Date.now()) return;
  const alarmName = `trial_${trial.id}`;
  chrome.alarms.create(alarmName, { when: alarmTime });
}

/**
 * Merge newly detected trials into existing storage, updating or adding as needed.
 * Then (re-)schedule alarms for all future trials.
 */
async function mergeAndScheduleTrials(newTrials) {
  const existing = await loadTrials();
  const merged = [...existing];

  for (const trial of newTrials) {
    const idx = merged.findIndex(t => t.id === trial.id);
    if (idx >= 0) {
      merged[idx] = trial; // update in place
    } else {
      merged.push(trial);
    }
  }

  // Clean up expired trials (end date already passed)
  const now = Date.now();
  const active = merged.filter(t => new Date(t.endDate).getTime() > now);

  await saveTrials(active);

  // Schedule alarms for all active trials
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
          message: `Your ${trial.name || 'subscription'} free trial expires in less than 24 hours! Check your subscription settings before you're charged.`,
          priority: 2,
        });
      }
    });
  }
});

// --- Main Scanning Logic ---

async function scanInbox(token) {
  // Try multiple search strategies to find billing emails
  const searchStrategies = [
    `newer_than:1y (receipt OR invoice OR subscription OR renewal OR payment)`,
    `newer_than:1y receipt`,
    `newer_than:1y subscription`,
    `newer_than:1y invoice`,
    `newer_than:1y "your receipt"`,
    `newer_than:1y "order confirmation"`,
    `newer_than:1y billing`,
  ];
  
  // Collect ALL message IDs from all strategies (deduplicated)
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
    console.log(`[Trackd] Keyword search found nothing. Trying fallback - fetch recent 50 messages...`);
    try {
      const fallback = await gmailFetch(token, 'messages', { maxResults: 50 });
      if (fallback.messages && fallback.messages.length > 0) {
        console.log(`[Trackd] Fallback found ${fallback.messages.length} messages. API is working.`);
        // Return empty but with a flag so we know the API works
        return { subscriptions: [], trials: [], _fallbackCount: fallback.messages.length };
      }
    } catch (e) {
      console.log(`[Trackd] Fallback also failed: ${e.message}`);
    }
    return { subscriptions: [], trials: [] };
  }
  
  console.log(`[Trackd] Found ${allMessageIds.length} billing-related emails, processing...`);
  
  // Fetch details for each message (batch of 10 at a time to avoid rate limits)
  const subscriptionResults = [];
  const trialResults = [];
  const batchSize = 10;
  
  // Track first-email debug
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
      
      // Debug: log first email's headers
      if (i === 0 && !_loggedHeaders) {
        _loggedHeaders = true;
        const headerNames = (detail.payload?.headers || []).map(h => h.name);
        console.log(`[Trackd] First email headers: ${headerNames.join(', ')}`);
        console.log(`[Trackd] Subject="${subject}" From="${from}" snippet="${snippet.substring(0,100)}"`);
      }
      
      // --- Subscription Detection ---
      // Gmail search already found billing emails, detect merchant directly
      const merchant = detectMerchant(subject, from);
      let subName, subType;
      
      if (merchant) {
        subName = merchant.name;
        subType = merchant.type;
      } else {
        // Fallback: extract company name from "From" header
        let fromClean = from.replace(/<.*>/, '').trim();
        if (!fromClean) {
          // No display name, extract from email address domain
          const emailMatch = from.match(/@([^.]+)/);
          fromClean = emailMatch ? emailMatch[1] : from;
        }
        fromClean = fromClean.replace(/@.*$/, '').trim();
        subName = fromClean.replace(/\b\w/g, c => c.toUpperCase()).substring(0, 40);
        // Last resort: if still empty, use "Unknown Service"
        if (!subName || subName.trim() === '') {
          subName = 'Unknown Service';
        }
        subType = 'other';
      }
      
      const price = extractPrice(snippet);
      const frequency = detectFrequency(snippet);

      subscriptionResults.push({
        id: detail.id,
        name: subName,
        type: subType,
        price: price || null,
        frequency,
        renewalDate: date,
        source: 'gmail',
        detected: new Date().toISOString(),
        status: 'active',
      });
      
      // Log first 5 detected
      if (subscriptionResults.length <= 5) {
        console.log(`[Trackd] ✓ Found: "${subName}" from="${from}" subject="${subject.substring(0,50)}" price=${price}`);
      }

      // --- Free Trial Detection ---
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
  
  // Deduplicate subscriptions by merchant name (keep the most recent)
  const seen = new Map();
  for (const sub of subscriptionResults) {
    const existing = seen.get(sub.name);
    if (!existing || new Date(sub.renewalDate) > new Date(existing.renewalDate)) {
      seen.set(sub.name, sub);
    }
  }
  
  // Save discovered trials and schedule alarms
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
        
        case 'clearAuth': {
          const subs = await loadSubscriptions();
          if (subs.length > 0) {
            // Save a backup before clearing
            await chrome.storage.local.set({ ['trackd_backup']: subs });
          }
          await chrome.storage.local.remove(STORAGE_KEY);
          
          // Revoke token
          try {
            const token = await getAuthToken(false);
            if (token) {
              await clearAuthToken(token);
              await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
            }
          } catch (e) {
            // Token might not exist, that's fine
          }
          
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
  
  return true; // Keep channel open for async response
});