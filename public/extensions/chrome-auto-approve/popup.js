const DEFAULTS = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:3333',
  token: '',
  pollMs: 1200,
  warningAccepted: false
};

const $ = (id) => document.getElementById(id);

async function load() {
  const cfg = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  $('enabled').checked = cfg.enabled === true;
  $('baseUrl').value = cfg.baseUrl || DEFAULTS.baseUrl;
  $('token').value = cfg.token || '';
  $('pollMs').value = Number(cfg.pollMs || DEFAULTS.pollMs);
  setStatus(cfg.enabled ? 'Enabled. Monitoring ChatGPT tabs.' : 'Disabled. Click enable to start.');
  const disableBtn = $('disableBtn');
  if (disableBtn) disableBtn.style.display = cfg.enabled ? '' : 'none';
}

function setStatus(text) {
  $('status').textContent = text;
}

async function save() {
  const next = {
    enabled: $('enabled').checked,
    baseUrl: $('baseUrl').value.trim().replace(/\/$/, '') || DEFAULTS.baseUrl,
    token: $('token').value,
    pollMs: Math.max(500, Number($('pollMs').value || DEFAULTS.pollMs)),
    warningAccepted: true
  };
  if (next.enabled && !confirm('Enable Rel.AI MCP auto-approve?\n\nThis can approve ChatGPT app requests for local repo actions without a manual click. Use only on your own trusted machine.')) {
    next.enabled = false;
    $('enabled').checked = false;
  }
  if (!next.enabled) next.approvalCount = 0;
  await chrome.storage.local.set(next);
  await chrome.runtime.sendMessage({ type: 'relai-config-updated' }).catch(() => {});
  const disableBtn = $('disableBtn');
  if (disableBtn) disableBtn.style.display = next.enabled ? '' : 'none';
  setStatus(next.enabled ? 'Saved and enabled.' : 'Saved and disabled.');
}

async function scanNow() {
  setStatus('Scanning ChatGPT tabs...');
  const res = await chrome.runtime.sendMessage({ type: 'relai-scan-now' }).catch((err) => ({ ok: false, error: String(err) }));
  setStatus(res && res.ok ? `Scan sent to ${res.tabs || 0} tab(s).` : `Scan failed: ${res && res.error ? res.error : 'unknown error'}`);
}

function relativeTime(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

async function refreshStats() {
  const data = await chrome.storage.local.get({ lastScanAt: 0, approvalCount: 0, activeTabs: 0, connectionOk: null, lastApprovalAt: 0 });
  $('lastScan').textContent = relativeTime(data.lastScanAt);
  $('approvalCount').textContent = data.approvalCount;
  $('activeTabs').textContent = data.activeTabs;
  const lastApproval = $('lastApproval');
  if (lastApproval) lastApproval.textContent = relativeTime(data.lastApprovalAt);
  const conn = $('connStatus');
  if (data.connectionOk === true) {
    conn.innerHTML = '<span class="dot ok"></span>OK';
  } else if (data.connectionOk === false) {
    conn.innerHTML = '<span class="dot err"></span>Unreachable';
  } else {
    conn.innerHTML = '<span class="dot"></span>Unknown';
  }
}

$('save').addEventListener('click', save);
$('scanNow').addEventListener('click', scanNow);
const disableBtnEl = $('disableBtn');
if (disableBtnEl) {
  disableBtnEl.addEventListener('click', async () => {
    $('enabled').checked = false;
    await save();
  });
}
load().catch((err) => setStatus(String(err)));
refreshStats().catch(() => {});
const statsInterval = setInterval(() => refreshStats().catch(() => {}), 2000);
window.addEventListener('unload', () => clearInterval(statsInterval));
