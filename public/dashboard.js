import { setToken, getToken, fetchJson } from '/ui/api.js';
import { init as initStore } from '/ui/store.js';
import { initEvents, startSSE, stopSSE, isLive } from '/ui/events.js';
import { boot as bootHome } from '/ui/sections/home.js';
import { boot as bootActivity } from '/ui/sections/activity.js';
import { boot as bootSettings } from '/ui/sections/settings/index.js';

// ── Token bootstrap ──────────────────────────────────────────────────────────
const urlToken = new URLSearchParams(location.search).get('token') || '';
const storedToken = sessionStorage.getItem('relai_dashboard_token') || '';
const token = urlToken || storedToken;
if (token) {
  setToken(token);
  const tokenInput = document.getElementById('token');
  if (tokenInput) tokenInput.value = token;
}

// ── Initial payload ──────────────────────────────────────────────────────────
function readInitialPayload() {
  try {
    const el = document.getElementById('initialDashboardData');
    return el && el.textContent ? JSON.parse(el.textContent) : null;
  } catch (_) { return null; }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  const initial = readInitialPayload();
  initStore(initial);

  // Render initial state immediately (zero-flash)
  if (initial) bootHome(initial);

  // Fetch fresh data
  const fresh = await fetchJson('/api/dashboard/v10?limit=100&requireHttpToken=0');
  if (fresh) {
    bootHome(fresh);
    bootActivity(fresh);
  }

  await loadConnection();

  // Boot settings section (attaches to nav + DOM injection)
  bootSettings();

  // Wire up global controls
  wireControls();
}

async function loadConnection() {
  const payload = await fetchJson('/api/connection');
  const status = document.getElementById('connectorStatus');
  if (status && payload) {
    status.className = 'status-pill ' + (payload.permanentUrlConfigured ? 'ok' : 'warn');
    status.textContent = payload.permanentUrlConfigured ? 'permanent URL' : 'local only';
  }
  const box = document.getElementById('connectorBox');
  if (box && payload) {
    box.textContent = [
      'Dashboard: ' + (payload.dashboardUrl || ''),
      'ChatGPT MCP URL: ' + (payload.chatgptMcpUrl || ''),
      'ChatGPT auth: No Authentication',
      'Health: ' + (payload.chatgptHealthUrl || ''),
      '',
      payload.permanentUrlConfigured ? 'Stable public URL is configured.' : 'No stable public URL configured yet.',
    ].join('\n');
  }
}

function wireControls() {
  // Refresh button
  const refreshBtn = document.querySelector('button[onclick="refresh()"]');
  if (refreshBtn) { refreshBtn.removeAttribute('onclick'); refreshBtn.onclick = doRefresh; }

  // Live button
  const liveBtn = document.getElementById('liveBtn');
  if (liveBtn) { liveBtn.removeAttribute('onclick'); liveBtn.onclick = toggleLive; }

  // Raw button
  const rawBtn = document.querySelector('button[onclick="toggleRaw()"]');
  if (rawBtn) { rawBtn.removeAttribute('onclick'); rawBtn.onclick = toggleRaw; }

  // Token input
  const tokenInput = document.getElementById('token');
  if (tokenInput) tokenInput.addEventListener('input', () => setToken(tokenInput.value.trim()));

  // Diagnostic buttons (keep working)
  const healthBtn = document.querySelector('button[onclick="loadHealth()"]');
  if (healthBtn) { healthBtn.removeAttribute('onclick'); healthBtn.onclick = () => loadDiag('/api/health-monitor'); }
  const readinessBtn = document.querySelector('button[onclick="loadReadiness()"]');
  if (readinessBtn) { readinessBtn.removeAttribute('onclick'); readinessBtn.onclick = () => loadDiag('/api/readiness?requireHttpToken=0'); }
  const logsBtn = document.querySelector('button[onclick="loadLogs()"]');
  if (logsBtn) { logsBtn.removeAttribute('onclick'); logsBtn.onclick = () => loadDiag('/api/logs?limit=100'); }
  const diffBtn = document.querySelector('button[onclick="loadDiff()"]');
  if (diffBtn) { diffBtn.removeAttribute('onclick'); diffBtn.onclick = loadDiff; }
}

async function doRefresh() {
  const data = await fetchJson('/api/dashboard/v10?limit=100&requireHttpToken=0');
  if (data) { bootHome(data); bootActivity(data); }
}

function toggleLive() {
  const btn = document.getElementById('liveBtn');
  if (isLive()) {
    stopSSE();
    if (btn) btn.textContent = 'Start live';
  } else {
    initEvents((data) => { bootHome(data); bootActivity(data); });
    startSSE(getToken);
    if (btn) btn.textContent = 'Stop live';
  }
}

function toggleRaw() {
  const panel = document.getElementById('rawPanel');
  if (!panel) return;
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    const out = document.getElementById('rawOut');
    const data = readInitialPayload();
    if (out && data) out.textContent = JSON.stringify(data, null, 2);
  }
}

async function loadDiag(url) {
  const data = await fetchJson(url);
  const out = document.getElementById('maintenanceOut');
  if (out) out.textContent = JSON.stringify(data, null, 2);
}

async function loadDiff() {
  const w = (document.getElementById('workspace') || {}).value || '';
  const s = (document.getElementById('sessionId') || {}).value || '';
  const data = await fetchJson(`/api/session/diff?workspace=${encodeURIComponent(w)}&sessionId=${encodeURIComponent(s)}`);
  const out = document.getElementById('diffOut');
  if (out) out.textContent = JSON.stringify(data, null, 2);
}

boot();
