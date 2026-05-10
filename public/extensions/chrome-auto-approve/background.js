const DEFAULTS = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:3333',
  token: '',
  pollMs: 1200
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('relai-scan', { periodInMinutes: 0.1 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('relai-scan', { periodInMinutes: 0.1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'relai-scan') scanChatGptTabs().catch(() => {});
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
  const response = await fetch(url.toString(), { headers, cache: 'no-store' });
  if (!response.ok) return false;
  const json = await response.json();
  return json && json.enabled === true;
}

async function scanChatGptTabs() {
  const cfg = await getConfig();
  if (!cfg.enabled) return 0;
  if (!(await dashboardAllows(cfg))) return 0;
  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'relai-auto-approve-scan' });
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
      await chrome.tabs.sendMessage(tab.id, { type: 'relai-auto-approve-scan' }).catch(() => {});
    }
  }));
  return tabs.length;
}

let quietTimer = null;
let approvedSinceQuiet = 0;
async function maybeNotify(count) {
  approvedSinceQuiet += count;
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
