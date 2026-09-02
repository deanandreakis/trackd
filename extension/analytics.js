// Trackd Analytics — Umami tracking
// Privacy-friendly: no cookies, no PII, just usage events

const UMAMI_URL = 'https://umami.andreakis.org/api/send';
const WEBSITE_ID = 'ea08a004-72f5-433f-b35c-9c436d8a5795';

let _sessionId = null;

function getSessionId() {
  if (!_sessionId) {
    _sessionId = 'trackd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  return _sessionId;
}

export async function trackEvent(eventName, eventData = {}) {
  try {
    const payload = {
      type: 'event',
      payload: {
        website: WEBSITE_ID,
        hostname: 'extension',
        url: '/extension',
        language: (navigator.language || 'en').substring(0, 35),
        screen: (screen.width + 'x' + screen.height).substring(0, 11),
        referrer: '',
        name: eventName,
        data: Object.keys(eventData).length > 0 ? eventData : undefined,
        id: getSessionId(),
      },
    };

    await fetch(UMAMI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Trackd/0.1.0',
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (e) {
    console.debug('[Trackd Analytics] Failed to send event:', e.message);
  }
}

export async function trackPageView() {
  try {
    const payload = {
      type: 'event',
      payload: {
        website: WEBSITE_ID,
        hostname: 'extension',
        url: '/extension',
        language: (navigator.language || 'en').substring(0, 35),
        screen: (screen.width + 'x' + screen.height).substring(0, 11),
        title: 'Trackd',
        referrer: '',
        id: getSessionId(),
      },
    };

    await fetch(UMAMI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Trackd/0.1.0',
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (e) {
    console.debug('[Trackd Analytics] Failed to send pageview:', e.message);
  }
}