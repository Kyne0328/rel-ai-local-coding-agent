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

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('relai-scan', { periodInMinutes: 0.1 });
  chrome.alarms.create('relai-heartbeat', { periodInMinutes: 0.5 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('relai-scan', { periodInMinutes: 0.1 });
  chrome.alarms.create('relai-heartbeat', { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'relai-scan') scanChatGptTabs().catch(() => {});
  if (alarm.name === 'relai-heartbeat') heartbeatChatGptTabs().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  if (message.type === 'relai-config-updated') {
    chrome.alarms.create('relai-scan', { periodInMinutes: 0.1 });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'relai-scan-now') {
    scanChatGptTabs().then((tabs) => sendResponse({ ok: true, tabs })).catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }
  if (message.type === 'relai-approved') {
    maybeNotify(message.count || 1).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

async function getConfig() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
}

async function dashboardAllows(cfg) {
  if (!cfg.enabled) return false;
  const base = String(cfg.baseUrl || DEFAULTS.baseUrl).replace(/\/$/, '');
  const url = new URL(base + '/api/auto-approve/settings');
  if (cfg.token) url.searchParams.set('token', cfg.token);
  const headers = cfg.token ? { Authorization: 'Bearer ' + cfg.token } : {};
  try {
    const response = await fetch(url.toString(), { headers, cache: 'no-store' });
    const ok = response.ok && (await response.json())?.enabled === true;
    chrome.storage.local.set({ connectionOk: ok }).catch(() => {});
    return ok;
  } catch (_) {
    chrome.storage.local.set({ connectionOk: false }).catch(() => {});
    return false;
  }
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
