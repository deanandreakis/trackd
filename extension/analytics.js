// Trackd Analytics — Umami integration
// Privacy-friendly: no cookies, no PII, just usage events

const UMAMI_URL = 'https://umami.andreakis.org/api/send';
const WEBSITE_ID = 'ea08a004-72f5-433f-b35c-9c436d8a5795';

let _sessionId = null;

function getSessionId() {
  if (!_sessionId) {
    _sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  return _sessionId;
}

export async function trackEvent(eventName, eventData = {}) {
  try {
    const payload = {
      type: 'event',
      payload: {
        website: WEBSITE_ID,
        url: '/extension',
        event_type: eventName,
        event_data: eventData,
        hostname: 'extension',
        language: navigator.language || 'en',
        screen: `${screen.width}x${screen.height}`,
        session: getSessionId(),
      },
    };

    await fetch(UMAMI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (e) {
    // Silently fail — analytics should never block the extension
    console.debug('[Trackd Analytics] Failed to send event:', e.message);
  }
}

export async function trackPageView() {
  try {
    const payload = {
      type: 'pageview',
      payload: {
        website: WEBSITE_ID,
        url: '/extension',
        hostname: 'extension',
        language: navigator.language || 'en',
        screen: `${screen.width}x${screen.height}`,
        session: getSessionId(),
      },
    };

    await fetch(UMAMI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (e) {
    console.debug('[Trackd Analytics] Failed to send pageview:', e.message);
  }
}