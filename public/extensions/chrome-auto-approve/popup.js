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
  setStatus(cfg.enabled ? 'Enabled. Dashboard setting must also be enabled.' : 'Disabled.');
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
  await chrome.storage.local.set(next);
  await chrome.runtime.sendMessage({ type: 'relai-config-updated' }).catch(() => {});
  setStatus(next.enabled ? 'Saved and enabled.' : 'Saved and disabled.');
}

async function scanNow() {
  setStatus('Scanning ChatGPT tabs...');
  const res = await chrome.runtime.sendMessage({ type: 'relai-scan-now' }).catch((err) => ({ ok: false, error: String(err) }));
  setStatus(res && res.ok ? `Scan sent to ${res.tabs || 0} tab(s).` : `Scan failed: ${res && res.error ? res.error : 'unknown error'}`);
}

$('save').addEventListener('click', save);
$('scanNow').addEventListener('click', scanNow);
load().catch((err) => setStatus(String(err)));
