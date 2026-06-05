import { setToken, getToken, fetchJson, DASHBOARD_DATA_URL } from '/ui/api.js';
import { init as initStore, get as getStore } from '/ui/store.js';
import { initRouter, currentSection, rerender } from '/ui/router.js';
import { initEvents, startSSE, stopSSE, isLive, setPollCallback, setPollInterval } from '/ui/events.js';
import { mountHome } from '/ui/sections/home.js';
import { initCommandPalette } from '/ui/components/command-palette.js';

// Single source of truth for navigable sections. The command palette and the
// live-rerender allowlist derive from this; the sidebar/mobile nav markup lives
// in the server-rendered shell (httpServer.renderDashboardHtml).
const ROUTES = [
  { id: 'home', label: 'Home' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'activity', label: 'Activity' },
  { id: 'tools', label: 'Tools' },
  { id: 'settings', label: 'Settings' },
];
const SETTINGS_SUBROUTES = [
  { id: 'connector', label: 'Settings → Connector' },
  { id: 'diagnostics', label: 'Settings → Diagnostics' },
];

const urlToken = new URLSearchParams(location.search).get('token') || '';
const token = urlToken || sessionStorage.getItem('relai_dashboard_token') || '';
if (token) setToken(token);
if (urlToken && window.history && typeof window.history.replaceState === 'function') {
  const params = new URLSearchParams(location.search);
  params.delete('token');
  const query = params.toString();
  const safeUrl = location.pathname + (query ? '?' + query : '') + (location.hash || '');
  window.history.replaceState(null, '', safeUrl);
}

function readInitialPayload() {
  try {
    const el = document.getElementById('initialDashboardData');
    return el && el.textContent ? JSON.parse(el.textContent) : null;
  } catch (_) {
    return null;
  }
}

function ensureRouteRoot() {
  const main = document.getElementById('main');
  if (!main) return null;

  let routeRoot = document.getElementById('routeRoot');
  if (routeRoot) return routeRoot;

  routeRoot = document.createElement('div');
  routeRoot.id = 'routeRoot';
  routeRoot.className = 'route-root';

  const persistent = Array.from(main.children);
  for (const node of persistent) {
    const keep = node.classList.contains('mobile-nav') || node.classList.contains('topbar');
    if (!keep) node.remove();
  }

  main.appendChild(routeRoot);
  return routeRoot;
}

async function boot() {
  const initial = readInitialPayload();
  initStore(initial || {});

  const routeRoot = ensureRouteRoot();
  if (!routeRoot) return;

  initRouter(routeRoot, getSections());
  await _doRefresh();

  _wireTopControls();
  setPollCallback(_doRefresh);
  // Register the SSE/visibility manager ONCE at boot (it adds a visibilitychange
  // listener). _toggleLive previously re-called initEvents on every toggle, stacking
  // duplicate listeners. The live-update callback is the same one used by SSE.
  initEvents(_liveOnEvent);
  const storeData0 = getStore();
  const refreshSeconds = storeData0.config && storeData0.config.productUx && storeData0.config.productUx.dashboardRefreshSeconds;
  if (refreshSeconds) setPollInterval(Number(refreshSeconds) * 1000);
  _checkOnboarding();

  const storeData = getStore();
  const navActions = [
    ...ROUTES.map(r => ({ label: r.label, href: '#' + r.id, category: 'Navigation' })),
    ...SETTINGS_SUBROUTES.map(r => ({ label: r.label, href: '#settings/' + r.id, category: 'Navigation' })),
  ];
  const actionActions = [
    { label: 'Refresh dashboard', category: 'Actions', action: _doRefresh },
    { label: 'Toggle live mode', category: 'Actions', action: _toggleLive },
    { label: 'Copy dashboard token', category: 'Actions', action: () => { if (getToken()) navigator.clipboard.writeText(getToken()).catch(() => {}); } },
  ];
  const workspaceList = storeData.config && Array.isArray(storeData.config.workspaces) ? storeData.config.workspaces : [];
  const wsActions = workspaceList.map(ws => ({
    label: 'Switch to workspace: ' + ws.alias,
    category: 'Workspaces',
    action: () => { const el = document.getElementById('workspace'); if (el) el.value = ws.alias; }
  }));
  initCommandPalette([...navActions, ...actionActions, ...wsActions]);

}

let _sectionsCache = null;
function getSections() {
  return _sectionsCache || (_sectionsCache = _buildSectionMap());
}

function _buildSectionMap() {
  return {
    home:        (el) => mountHome(el, getStore()),
    workspaces:  (el) => import('/ui/sections/workspaces.js').then(m => m.mountWorkspaces(el, getStore())).catch(console.error),
    activity:    (el) => import('/ui/sections/activity.js').then(m => m.mountActivity(el)).catch(console.error),
    tools:       (el) => import('/ui/sections/tools.js').then(m => m.mountTools(el)).catch(console.error),
    settings:    (el) => import('/ui/sections/settings/index.js').then(m => m.mountSettings(el, _settingsSubPage())).catch(console.error),
    connector:   (el) => import('/ui/sections/settings/index.js').then(m => m.mountSettings(el, 'connector')).catch(console.error),
    diagnostics: (el) => import('/ui/sections/settings/index.js').then(m => m.mountSettings(el, 'diagnostics')).catch(console.error),
  };
}

function _settingsSubPage() {
  const parts = (location.hash || '').replace(/^#/, '').split('/');
  return parts[0] === 'settings' && parts[1] ? parts[1] : 'general';
}

function _wireTopControls() {
  // Token comes from the URL / sessionStorage at boot (see top of file); the topbar
  // no longer shows a token field. Refresh (manual reload) and the live toggle remain.
  const liveBtn = document.getElementById('liveBtn');
  if (liveBtn) liveBtn.onclick = _toggleLive;
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.onclick = _doRefresh;
}

// Single fetch-and-render path shared by boot, manual refresh, and the command
// palette. Re-mounts the current section against fresh store state via the router.
async function _doRefresh() {
  const data = await fetchJson(DASHBOARD_DATA_URL);
  if (data) {
    initStore(data);
    rerender();
  }
}

// Shared live-update handler — fed to initEvents once at boot and reused by SSE.
async function _liveOnEvent(data) {
  initStore(data);
  const id = currentSection();
  if (Object.prototype.hasOwnProperty.call(getSections(), id)) {
    rerender();
  }
  if (id === 'activity') {
    import('/ui/sections/activity.js')
      .then(m => m.prependEntry((data.auditTail && data.auditTail.entries && data.auditTail.entries[0]) || null))
      .catch(console.error);
  }
}

function _toggleLive() {
  const btn = document.getElementById('liveBtn');
  if (isLive()) {
    stopSSE();
    if (btn) btn.textContent = 'Start live';
  } else {
    startSSE(getToken);
    if (btn) btn.textContent = 'Stop live';
  }
}

async function _checkOnboarding() {
  try {
    const status = await fetchJson('/api/onboarding/status');
    if (status && status.needsOnboarding) {
      const { openOnboarding } = await import('/ui/sections/onboarding.js');
      openOnboarding();
    }
  } catch (_) { /* degrade gracefully */ }
}

boot();
