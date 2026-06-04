const DEFAULTS = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:3333',
  token: '',
  pollMs: 1200
};

// Per-tab injection cooldown — prevents double-injection during ChatGPT navigation.
// In-memory only; resets when the service worker restarts, which is acceptable.
const lastInjectedAt = new Map();
const INJECT_COOLDOWN_MS = 10000;

// Background scan cadence. The foreground content script reacts instantly via its
// mutation observer + gated poll, so this alarm only needs to cover throttled
// background tabs. (Chrome clamps packed-extension alarms to a 30s floor anyway.)
const SCAN_PERIOD_MIN = 0.5;
const HEARTBEAT_PERIOD_MIN = 0.5;

// Dashboard reachability is slow-changing; probing it on every scan was wasteful.
// Cache the result and only re-probe when stale or on an explicit user action.
const CONN_TTL_MS = 60000;
let connCache = { at: 0, ok: false };
function invalidateConnCache() { connCache = { at: 0, ok: false }; }

function ensureAlarms() {
  chrome.alarms.create('relai-scan', { periodInMinutes: SCAN_PERIOD_MIN });
  chrome.alarms.create('relai-heartbeat', { periodInMinutes: HEARTBEAT_PERIOD_MIN });
}

chrome.runtime.onInstalled.addListener(ensureAlarms);
chrome.runtime.onStartup.addListener(ensureAlarms);

// Drop per-tab cooldown state when a tab closes so the map cannot grow unbounded.
chrome.tabs.onRemoved.addListener((tabId) => { lastInjectedAt.delete(tabId); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'relai-scan') scanChatGptTabs().catch(() => {});
  if (alarm.name === 'relai-heartbeat') heartbeatChatGptTabs().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  if (message.type === 'relai-config-updated') {
    invalidateConnCache();
    chrome.alarms.create('relai-scan', { periodInMinutes: SCAN_PERIOD_MIN });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'relai-scan-now') {
    invalidateConnCache();
    scanChatGptTabs().then((tabs) => sendResponse({ ok: true, tabs })).catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }
  if (message.type === 'relai-approved') {
    maybeNotify(message.count || 1).catch(() => {});
    chrome.storage.local.set({ lastApprovalAt: Date.now() }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

async function getConfig() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
}

const DISCOVER_PORTS = [3333, 3334, 3335, 3336, 3337, 3338, 3339, 3340, 3341, 3342];

async function probeFetch(url, token) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 900);
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const res = await fetch(url, { headers, cache: 'no-store', signal: ctrl.signal });
    clearTimeout(tid);
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function discoverServer(token) {
  const results = await Promise.all(DISCOVER_PORTS.map(async (port) => {
    const url = `http://127.0.0.1:${port}/api/auto-approve/settings`;
    const ok = await probeFetch(url, token);
    if (!ok) return null;
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 900);
      const res = await fetch(`http://127.0.0.1:${port}/api/local-connect`, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(tid);
      const data = res.ok ? await res.json() : null;
      return { base: `http://127.0.0.1:${port}`, token: (data && data.token) || null };
    } catch (_) {
      return { base: `http://127.0.0.1:${port}`, token: null };
    }
  }));
  return results.find((r) => r !== null) || null;
}

async function dashboardAllows(cfg) {
  if (!cfg.enabled) return false;
  // Reuse a recent reachability result instead of probing localhost every scan.
  // Enabled state is the real gate, so this only governs the status display and
  // opportunistic token sync.
  if (Date.now() - connCache.at < CONN_TTL_MS) return true;
  const base = String(cfg.baseUrl || DEFAULTS.baseUrl).replace(/\/$/, '');
  const settingsPath = cfg.token ? `/api/auto-approve/settings?token=${encodeURIComponent(cfg.token)}` : '/api/auto-approve/settings';
  let reachable = await probeFetch(base + settingsPath, cfg.token);
  if (reachable) {
    // Opportunistically sync token from server (in case it changed)
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 900);
      const res = await fetch(`${base}/api/local-connect`, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(tid);
      const data = res.ok ? await res.json() : null;
      if (data && data.token && data.token !== cfg.token) {
        await chrome.storage.local.set({ token: data.token });
      }
    } catch (_) {}
  }
  if (!reachable) {
    const discovered = await discoverServer(cfg.token);
    if (discovered) {
      reachable = true;
      const updates = {};
      if (discovered.base !== base) updates.baseUrl = discovered.base;
      if (discovered.token && discovered.token !== cfg.token) updates.token = discovered.token;
      if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    }
  }
  connCache = { at: Date.now(), ok: reachable };
  chrome.storage.local.set({ connectionOk: reachable }).catch(() => {});
  return true; // extension enabled state is the gate, not dashboard
}

async function scanChatGptTabs() {
  const cfg = await getConfig();
  if (!cfg.enabled) return 0;
  if (!(await dashboardAllows(cfg))) return 0;
  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
  chrome.storage.local.set({ lastScanAt: Date.now(), activeTabs: tabs.length }).catch(() => {});
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'relai-auto-approve-scan' });
    } catch (_) {
      const now = Date.now();
      const last = lastInjectedAt.get(tab.id) || 0;
      if (now - last < INJECT_COOLDOWN_MS) return;
      lastInjectedAt.set(tab.id, now);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
      await chrome.tabs.sendMessage(tab.id, { type: 'relai-auto-approve-scan' }).catch(() => {});
    }
  }));
  return tabs.length;
}

async function heartbeatChatGptTabs() {
  const cfg = await getConfig();
  if (!cfg.enabled) return;
  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, { type: 'relai-heartbeat' }).catch(() => {});
  }
}

let quietTimer = null;
let approvedSinceQuiet = 0;
async function maybeNotify(count) {
  approvedSinceQuiet += count;

  const current = await chrome.storage.local.get({ approvalCount: 0 });
  chrome.storage.local.set({ approvalCount: current.approvalCount + count }).catch(() => {});

  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = setTimeout(() => {
    const total = approvedSinceQuiet;
    approvedSinceQuiet = 0;
    if (total > 0) {
      chrome.notifications.create('', {
        type: 'basic',
        iconUrl: 'relai-logo-192.png',
        title: 'Rel.AI MCP app requests are quiet',
        message: `Auto-approved ${total} request${total === 1 ? '' : 's'} in the last task.`
      }).catch(() => {});
    }
  }, 12000);
}
