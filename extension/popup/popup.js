// Trackd Popup Script
// Handles UI state transitions and user interactions

const $ = (id) => document.getElementById(id);

// State elements
const authState = $('auth-state');
const scanningState = $('scanning-state');
const dashboardState = $('dashboard-state');
const authBtn = $('auth-btn');
const scanBtn = $('scan-btn');
const addBtn = $('add-btn');
const subList = $('sub-list');
const totalAmount = $('total-amount');

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
  if (amount === null || amount === undefined) return '—';
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

function getMonthlyTotal(subs) {
  return subs.reduce((total, sub) => {
    if (!sub.price) return total;
    switch (sub.frequency) {
      case 'yearly': return total + (sub.price / 12);
      case 'monthly': return total + sub.price;
      case 'weekly': return total + (sub.price * 4.33);
      default: return total + sub.price;
    }
  }, 0);
}

// --- Render Dashboard ---

function renderDashboard(subs) {
  const total = getMonthlyTotal(subs);
  totalAmount.textContent = `$${total.toFixed(2)}`;
  
  if (subs.length === 0) {
    subList.innerHTML = '<div class="sub-item" style="justify-content:center;color:var(--text-secondary);padding:20px;">No subscriptions found yet. Click scan to check your inbox.</div>';
    return;
  }
  
  subList.innerHTML = subs.map(sub => `
    <div class="sub-item" data-id="${sub.id}">
      <div class="left">
        <span class="name">${sub.name}</span>
        <span class="meta">${sub.type || 'subscription'} · ${sub.source === 'manual' ? 'manual' : 'auto-detected'}</span>
      </div>
      <div class="right">
        <div class="amount">${formatPrice(sub.price)}${sub.price ? formatFrequency(sub.frequency) : ''}</div>
        <span class="meta">${sub.status || 'active'}</span>
      </div>
    </div>
  `).join('');
}

// --- Auth Flow ---

authBtn.addEventListener('click', async () => {
  showState(scanningState);
  
  const result = await sendMsg('scanInbox');
  
  if (result.error) {
    // Auth might have failed
    showState(authState);
    console.error('Scan error:', result.error);
    return;
  }
  
  renderDashboard(result.subscriptions || []);
  showState(dashboardState);
});

// --- Scan Button ---

scanBtn.addEventListener('click', async () => {
  showState(scanningState);
  
  const result = await sendMsg('scanInbox');
  
  if (result.error) {
    console.error('Scan error:', result.error);
    showState(dashboardState);
    return;
  }
  
  renderDashboard(result.subscriptions || []);
  showState(dashboardState);
});

// --- Add Manual ---

addBtn.addEventListener('click', () => {
  const name = prompt('Subscription name:');
  if (!name) return;
  
  const priceStr = prompt('Monthly price (e.g., 9.99) or leave blank:');
  const price = priceStr ? parseFloat(priceStr) : null;
  
  sendMsg('addManual', {
    subscription: { name, price, frequency: 'monthly', type: 'other', status: 'active' }
  }).then(async () => {
    const result = await sendMsg('getSubscriptions');
    renderDashboard(result.subscriptions || []);
  });
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
})();