// Trackd Background Service Worker
// Handles Gmail API authentication and email fetching

const STORAGE_KEY = 'trackd_subscriptions';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

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
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  
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
  'free trial', 'trial ended', 'trial converting', 'your plan',
  'monthly', 'annual', 'yearly', 'membership',
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

// --- Main Scanning Logic ---

async function scanInbox(token) {
  // Search for billing-related emails from the last 12 months
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const query = `after:${oneYearAgo.getTime() / 1000 | 0} (${RECEIPT_KEYWORDS.join(' OR ')})`;
  
  // Fetch message list
  const listData = await gmailFetch(token, 'messages', {
    q: query,
    maxResults: 100,
  });
  
  if (!listData.messages || listData.messages.length === 0) {
    return [];
  }
  
  // Fetch details for each message (batch of 10 at a time to avoid rate limits)
  const results = [];
  const batchSize = 10;
  
  for (let i = 0; i < listData.messages.length; i += batchSize) {
    const batch = listData.messages.slice(i, i + batchSize);
    const details = await Promise.all(
      batch.map(msg => gmailFetch(token, `messages/${msg.id}`, { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] }))
    );
    
    for (const detail of details) {
      const headers = {};
      (detail.payload?.headers || []).forEach(h => { headers[h.name] = h.value; });
      
      const subject = headers['Subject'] || '';
      const from = headers['From'] || '';
      const date = headers['Date'] || '';
      
      if (!isBillingEmail(subject, from)) continue;
      
      const merchant = detectMerchant(subject, from);
      if (!merchant) continue;
      
      // Try to get snippet for price extraction
      const snippet = detail.snippet || '';
      const price = extractPrice(snippet);
      const frequency = detectFrequency(snippet);
      
      results.push({
        id: detail.id,
        name: merchant.name,
        type: merchant.type,
        price: price || null,
        frequency,
        renewalDate: date,
        source: 'gmail',
        detected: new Date().toISOString(),
        status: 'active',
      });
    }
  }
  
  // Deduplicate by merchant name (keep the most recent)
  const seen = new Map();
  for (const sub of results) {
    const existing = seen.get(sub.name);
    if (!existing || new Date(sub.renewalDate) > new Date(existing.renewalDate)) {
      seen.set(sub.name, sub);
    }
  }
  
  return Array.from(seen.values());
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
          const subs = await scanInbox(token);
          await saveSubscriptions(subs);
          sendResponse({ success: true, count: subs.length, subscriptions: subs });
          break;
        }
        
        case 'getSubscriptions': {
          const subs = await loadSubscriptions();
          sendResponse({ subscriptions: subs });
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