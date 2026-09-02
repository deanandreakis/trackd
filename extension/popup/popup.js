// Trackd Popup Script
// Handles UI state transitions and user interactions

import { trackEvent, trackPageView } from '../analytics.js';

const $ = (id) => document.getElementById(id);

// State elements
const authState = $('auth-state');
const scanningState = $('scanning-state');
const dashboardState = $('dashboard-state');
const authBtn = $('auth-btn');
const scanBtn = $('scan-btn');
const addBtn = $('add-btn');
const subList = $('sub-list');
const reviewList = $('review-list');
const reviewSection = $('review-section');
const reviewCount = $('review-count');
const totalAmount = $('total-amount');
const trialsBar = $('trials-bar');
const trialsCount = $('trials-count');
const modal = $('modal');
const modalTitle = $('modal-title');
const modalFields = $('modal-fields');
const modalCancel = $('modal-cancel');
const modalSave = $('modal-save');
const settingsToggle = $('settings-toggle');
const settingsPanel = $('settings-panel');
const maxMessagesSlider = $('max-messages-slider');
const maxMessagesValue = $('max-messages-value');
const tierBadge = $('tier-badge');
const licenseInput = $('license-input');
const licenseActivateBtn = $('license-activate-btn');
const licenseStatus = $('license-status');

let subsCache = [];

// --- Helpers ---

function sendMsg(action, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        resolve(response || {});
      }
    });
  });
}

function showState(state) {
  [authState, scanningState, dashboardState].forEach(s => s.classList.add('hidden'));
  state.classList.remove('hidden');
}

function formatPrice(amount) {
  if (amount === null || amount === undefined) return '\u2014';
  return `$${amount.toFixed(2)}`;
}

function formatFrequency(freq) {
  switch (freq) {
    case 'yearly': return '/yr';
    case 'monthly': return '/mo';
    case 'weekly': return '/wk';
    default: return '';
  }
}

function isConfirmed(sub) {
  return sub && sub.status !== 'pending';
}

/**
 * Build a deep link into Gmail for a message ID (used by items detected from email).
 * Manual items have no message ID and cannot be linked.
 */
function gmailMessageUrl(messageId) {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(messageId)}`;
}

function canOpenEmail(sub) {
  return sub.source === 'gmail' && sub.id;
}

function openEmail(sub) {
  if (!canOpenEmail(sub)) return;
  chrome.tabs.create({ url: gmailMessageUrl(sub.id) });
}

// --- Reusable Modal ---

let modalOnSave = null;

function openModal({ title, fields, onSave }) {
  modalTitle.textContent = title;
  modalFields.innerHTML = fields.map(f => `
    <div class="modal-field">
      <label for="modal-${f.id}">${f.label}</label>
      <input
        id="modal-${f.id}"
        type="${f.type || 'text'}"
        placeholder="${f.placeholder || ''}"
        ${f.required ? 'required' : ''}
      />
    </div>
  `).join('');

  modalOnSave = () => {
    const values = {};
    let valid = true;
    for (const f of fields) {
      const input = document.getElementById(`modal-${f.id}`);
      const raw = input.value.trim();
      if (f.required && !raw) {
        input.focus();
        input.style.borderColor = 'var(--red)';
        valid = false;
        break;
      }
      values[f.id] = f.type === 'number' ? (raw ? parseFloat(raw) : null) : raw;
    }
    if (!valid) return;
    closeModal();
    onSave(values);
  };

  modal.classList.remove('hidden');
  const first = modalFields.querySelector('input');
  if (first) first.focus();
}

function closeModal() {
  modalOnSave = null;
  modal.classList.add('hidden');
}

modalSave.addEventListener('click', () => {
  if (modalOnSave) modalOnSave();
});

modalCancel.addEventListener('click', closeModal);

modal.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && modalOnSave) modalOnSave();
  if (e.key === 'Escape') closeModal();
});

function getMonthlyTotal(subs) {
  // Only confirmed subscriptions count toward the total.
  return (subs || [])
    .filter(isConfirmed)
    .reduce((total, sub) => {
      if (!sub.price) return total;
      switch (sub.frequency) {
        case 'yearly': return total + (sub.price / 12);
        case 'monthly': return total + sub.price;
        case 'weekly': return total + (sub.price * 4.33);
        default: return total + sub.price;
      }
    }, 0);
}

// --- Trial Alerts ---

/**
 * Fetch trial alerts from the background service worker and render them.
 */
async function renderTrialAlerts() {
  const result = await sendMsg('getTrials');
  const trials = result.trials || [];

  // Filter to only upcoming trials (within the next 7 days for the "ending soon" indicator)
  const now = Date.now();
  const sevenDaysFromNow = now + 7 * 24 * 60 * 60 * 1000;

  const upcoming = trials.filter(t => {
    const endMs = new Date(t.endDate).getTime();
    return endMs > now && endMs <= sevenDaysFromNow;
  });

  if (upcoming.length > 0) {
    trialsCount.textContent = upcoming.length;
    trialsBar.classList.remove('hidden');
  } else {
    trialsBar.classList.add('hidden');
  }
}

// --- Review Candidates ---

/**
 * Render unrecognized billing senders that need the user's confirmation before
 * they count toward the monthly total.
 */
function renderReviewCandidates(subs) {
  const pending = (subs || []).filter(s => s.status === 'pending');

  if (pending.length === 0) {
    reviewSection.classList.add('hidden');
    reviewList.innerHTML = '';
    return;
  }

  reviewCount.textContent = pending.length;
  reviewSection.classList.remove('hidden');
  reviewList.innerHTML = pending.map(sub => `
    <div class="sub-item review-item" data-id="${sub.id}">
      <div class="left">
        <span class="name">${sub.name}</span>
        <span class="meta">Possible subscription · needs review</span>
      </div>
      <div class="right">
        <span class="meta">${formatPrice(sub.price)}</span>
        <div class="review-actions">
          <button class="btn-small view-email-btn" title="Open original email">📧</button>
          <button class="btn-small confirm-btn" title="Confirm as subscription">✓</button>
          <button class="btn-small dismiss-btn" title="Dismiss">✕</button>
        </div>
      </div>
    </div>
  `).join('');
}

async function refreshAndRender() {
  const result = await sendMsg('getSubscriptions');
  renderDashboard(result.subscriptions || []);
}

/**
 * Confirm a review candidate as a real subscription (adds it to the total).
 */
async function confirmCandidate(id) {
  openModal({
    title: 'Confirm subscription',
    fields: [
      { id: 'price', label: 'Monthly price (leave blank to use detected)', type: 'number', placeholder: '0.00' },
    ],
    onSave: async (values) => {
      const price = values.price;
      await sendMsg('confirmSubscription', { id, price });
      await refreshAndRender();
      trackEvent('candidate_confirmed');
    },
  });
}

/**
 * Dismiss a review candidate (removes it entirely).
 */
async function dismissCandidate(id) {
  await sendMsg('removeSubscription', { id });
  await refreshAndRender();
  trackEvent('candidate_dismissed');
}

// --- Render Dashboard ---

function renderDashboard(subs) {
  subsCache = (subs || []);
  const confirmed = (subs || []).filter(isConfirmed);
  const total = getMonthlyTotal(subs);
  totalAmount.textContent = `$${total.toFixed(2)}`;

  if (confirmed.length === 0) {
    subList.innerHTML = '<div class="sub-item" style="justify-content:center;color:var(--text-secondary);padding:20px;">No confirmed subscriptions yet. Review candidates below, then click scan to check your inbox.</div>';
    renderReviewCandidates(subs);
    renderTrialAlerts();
    return;
  }

  subList.innerHTML = confirmed.map(sub => `
    <div class="sub-item" data-id="${sub.id}">
      <div class="left">
        <span class="name">${sub.name}</span>
        <span class="meta">${sub.type || 'subscription'} · ${sub.source === 'manual' ? 'manual' : autoLabel(sub)}</span>
      </div>
      <div class="right">
        <div class="amount">${sub.price !== null && sub.price !== undefined ? `${formatPrice(sub.price)}${formatFrequency(sub.frequency)}` : '<button class="btn-small set-price-btn" title="Set monthly price">Add price</button>'}</div>
        <span class="meta">${sub.status || 'active'}</span>
        <div class="item-actions">
          ${sub.source === 'gmail' ? '<button class="btn-small view-email-btn" title="Open original email">📧</button>' : ''}
          <button class="btn-small remove-btn" title="Remove from list">✕</button>
        </div>
      </div>
    </div>
  `).join('');

  renderReviewCandidates(subs);

  // Also render trial alerts
  renderTrialAlerts();
}

/**
 * Prompt for and set a monthly price on an existing confirmed subscription.
 */
async function setPrice(id) {
  openModal({
    title: 'Add monthly price',
    fields: [
      { id: 'price', label: 'Monthly price', type: 'number', placeholder: '9.99', required: true },
    ],
    onSave: async (values) => {
      const result = await sendMsg('updateSubscriptionPrice', { id, price: values.price });
      if (result && !result.error) await refreshAndRender();
    },
  });
}

/**
 * Confirm and remove a subscription from the list (e.g. user determined it
 * does not belong / was canceled).
 */
function confirmRemove(id) {
  openModal({
    title: 'Remove subscription?',
    fields: [
      { id: 'confirm-remove', label: 'Type REMOVE to delete this item', placeholder: 'REMOVE', required: true },
    ],
    onSave: async (values) => {
      const typed = String(values['confirm-remove'] || '').toUpperCase();
      if (typed !== 'REMOVE') return; // mismatch -> keep modal open for correction
      await sendMsg('removeSubscription', { id });
      await refreshAndRender();
    },
  });
}

// --- Main List Price Action Delegation ---

subList.addEventListener('click', (e) => {
  const btn = e.target.closest('.set-price-btn');
  if (btn) {
    const item = btn.closest('.sub-item');
    if (item) setPrice(item.dataset.id);
    return;
  }
  const viewBtn = e.target.closest('.view-email-btn');
  if (viewBtn) {
    const item = viewBtn.closest('.sub-item');
    const sub = (subsCache || []).find(s => s.id === item.dataset.id);
    if (sub) openEmail(sub);
    return;
  }
  const removeBtn = e.target.closest('.remove-btn');
  if (removeBtn) {
    const item = removeBtn.closest('.sub-item');
    if (item) confirmRemove(item.dataset.id);
  }
});

function autoLabel(sub) {
  return sub.status === 'active' ? 'auto-detected' : sub.status;
}

// --- Review Action Delegation ---

reviewList.addEventListener('click', (e) => {
  const item = e.target.closest('.review-item');
  if (!item) return;
  const id = item.dataset.id;
  if (e.target.classList.contains('view-email-btn')) {
    const sub = (subsCache || []).find(s => s.id === id);
    if (sub) openEmail(sub);
  } else if (e.target.classList.contains('confirm-btn')) {
    confirmCandidate(id);
  } else if (e.target.classList.contains('dismiss-btn')) {
    dismissCandidate(id);
  }
});

// --- Auth Flow ---

authBtn.addEventListener('click', async () => {
  showState(scanningState);
  trackEvent('gmail_connect_start');

  const result = await sendMsg('scanInbox');

  if (result.error) {
    showState(authState);
    console.error('Scan error:', result.error);
    trackEvent('gmail_connect_error', { error: result.error.substring(0, 100) });
    return;
  }

  renderDashboard(result.subscriptions || []);
  showState(dashboardState);
  trackEvent('gmail_connected');
  trackEvent('scan_completed', { count: result.subscriptions.length });
});

// --- Scan Button ---

scanBtn.addEventListener('click', async () => {
  showState(scanningState);

  const result = await sendMsg('scanInbox');

  if (result.error) {
    console.error('Scan error:', result.error);
    showState(dashboardState);
    trackEvent('scan_error', { error: result.error.substring(0, 100) });
    return;
  }

  renderDashboard(result.subscriptions || []);
  showState(dashboardState);
  trackEvent('scan_completed', { count: result.subscriptions.length });
});

// --- Add Manual ---

addBtn.addEventListener('click', () => {
  openModal({
    title: 'Add subscription',
    fields: [
      { id: 'name', label: 'Subscription name', placeholder: 'e.g. Netflix', required: true },
      { id: 'price', label: 'Monthly price (optional)', type: 'number', placeholder: '0.00' },
    ],
    onSave: async (values) => {
      const result = await sendMsg('addManual', {
        subscription: { name: values.name, price: values.price, frequency: 'monthly', type: 'other', status: 'active' }
      });
      if (result.error === 'limit') {
        alert(`Free tier limited to ${result.limit} subscriptions. Upgrade to Pro for unlimited.`);
        return;
      }
      await refreshAndRender();
    },
  });
});

$('upgrade-link').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://gumroad.com/l/trackd-pro' });
});

// --- Initialization ---

(async () => {
  const result = await sendMsg('getSubscriptions');

  if (result.subscriptions && result.subscriptions.length > 0) {
    renderDashboard(result.subscriptions);
    showState(dashboardState);
  } else {
    showState(authState);
  }

  // Track first run
  const firstRun = await new Promise(r => chrome.storage.local.get('trackd_first_run', r));
  if (!firstRun.trackd_first_run) {
    trackEvent('extension_opened');
    await new Promise(r => chrome.storage.local.set({ trackd_first_run: true }, r));
  }
})();

// --- Settings Toggle ---

settingsToggle.addEventListener('click', async () => {
  // Check Pro status
  const result = await sendMsg('checkPro');
  if (result.pro) {
    tierBadge.textContent = 'Pro';
    tierBadge.classList.add('pro');
    licenseStatus.textContent = 'Pro active';
    licenseInput.disabled = true;
  } else {
    tierBadge.textContent = 'Free';
    tierBadge.classList.remove('pro');
    licenseStatus.textContent = 'Up to 10 subscriptions. Upgrade to Pro for unlimited.';
  }
  settingsPanel.classList.remove('hidden');
});

$('settings-close').addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

// Close on overlay click
settingsPanel.addEventListener('click', (e) => {
  if (e.target === settingsPanel) {
    settingsPanel.classList.add('hidden');
  }
});

maxMessagesSlider.addEventListener('input', () => {
  const val = maxMessagesSlider.value;
  maxMessagesValue.textContent = val;
});

maxMessagesSlider.addEventListener('change', () => {
  const val = parseInt(maxMessagesSlider.value, 10);
  sendMsg('saveSettings', { settings: { maxMessages: val } });
  console.log(`[Trackd] Max messages setting saved: ${val}`);
});

// Load current setting
(async () => {
  const data = await new Promise(r => chrome.storage.local.get('trackd_settings', r));
  const maxMsg = (data.trackd_settings && data.trackd_settings.maxMessages) || 200;
  maxMessagesSlider.value = maxMsg;
  maxMessagesValue.textContent = maxMsg;
})();

// --- License Activation ---

licenseActivateBtn.addEventListener('click', async () => {
  const key = licenseInput.value.trim();
  if (!key) return;

  licenseActivateBtn.disabled = true;
  licenseActivateBtn.textContent = 'Verifying...';
  licenseStatus.textContent = '';

  const result = await sendMsg('activateLicense', { key });

  if (result.valid) {
    licenseStatus.textContent = 'Pro activated!';
    licenseStatus.style.color = 'var(--green)';
    tierBadge.textContent = 'Pro';
    tierBadge.classList.add('pro');
    licenseInput.disabled = true;
    licenseActivateBtn.textContent = 'Done';
  } else {
    licenseStatus.textContent = result.error || 'Invalid key';
    licenseStatus.style.color = 'var(--red)';
    licenseActivateBtn.disabled = false;
    licenseActivateBtn.textContent = 'Activate';
  }
});