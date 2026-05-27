import { setToken, getToken, fetchJson } from '/ui/api.js';
import { init as initStore, get as getStore } from '/ui/store.js';
import { initRouter, currentSection } from '/ui/router.js';
import { initEvents, startSSE, stopSSE, isLive, setPollCallback } from '/ui/events.js';
import { mountHome } from '/ui/sections/home.js';
import { initCommandPalette } from '/ui/components/command-palette.js';

const savedTheme = localStorage.getItem('relai_theme');
if (savedTheme === 'light') document.documentElement.dataset.theme = 'light';

const urlToken = new URLSearchParams(location.search).get('token') || '';
const token = urlToken || sessionStorage.getItem('relai_dashboard_token') || '';
if (token) setToken(token);

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

  const sections = _sectionMap();
  initRouter(routeRoot, sections);

  const fresh = await fetchJson('/api/dashboard/v10?limit=100&requireHttpToken=0');
  if (fresh) {
    initStore(fresh);
    _renderCurrentSection(routeRoot, currentSection(), sections);
  }

  _wireTopControls();
  setPollCallback(_doRefresh);
  _checkOnboarding();

  const storeData = getStore();
  const navActions = [
    { label: 'Home', href: '#home', category: 'Navigation' },
    { label: 'Workspaces', href: '#workspaces', category: 'Navigation' },
    { label: 'Activity', href: '#activity', category: 'Navigation' },
    { label: 'Tools', href: '#tools', category: 'Navigation' },
    { label: 'Settings', href: '#settings', category: 'Navigation' },
    { label: 'Settings → Connector', href: '#settings/connector', category: 'Navigation' },
    { label: 'Settings → Diagnostics', href: '#settings/diagnostics', category: 'Navigation' },
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

function _sectionMap() {
  return {
    home:        (el) => mountHome(el, getStore()),
    workspaces:  (el) => import('/ui/sections/workspaces.js').then(m => m.mountWorkspaces(el, getStore())).catch(console.error),
    activity:    (el) => import('/ui/sections/activity.js').then(m => m.mountActivity(el)).catch(console.error),
    tools:       (el) => import('/ui/sections/tools.js').then(m => m.mountTools(el)).catch(console.error),
    approvals:   () => { location.hash = '#home'; },
    agents:      () => { location.hash = '#home'; },
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
  const tokenInput = document.getElementById('token');
  if (tokenInput) {
    if (getToken()) tokenInput.value = getToken();
    tokenInput.addEventListener('input', () => setToken(tokenInput.value.trim()));
  }
  const liveBtn = document.getElementById('liveBtn');
  if (liveBtn) liveBtn.onclick = _toggleLive;
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.onclick = _doRefresh;
}

function _renderCurrentSection(main, id, sections) {
  const fn = sections[id] || sections.home;
  if (main && fn) {
    main.innerHTML = '';
    fn(main);
  }
}

async function _doRefresh() {
  const data = await fetchJson('/api/dashboard/v10?limit=100&requireHttpToken=0');
  if (data) {
    initStore(data);
    _renderCurrentSection(ensureRouteRoot(), currentSection(), _sectionMap());
  }
}

function _toggleLive() {
  const btn = document.getElementById('liveBtn');
  if (isLive()) {
    stopSSE();
    if (btn) btn.textContent = 'Start live';
  } else {
    initEvents(async (data) => {
      initStore(data);
      const routeRoot = ensureRouteRoot();
      const id = currentSection();
      if (!routeRoot) return;

      if (['home', 'workspaces', 'activity', 'tools', 'settings', 'connector', 'diagnostics'].includes(id)) {
        _renderCurrentSection(routeRoot, id, _sectionMap());
      }

      if (id === 'activity') {
        import('/ui/sections/activity.js')
          .then(m => m.prependEntry((data.auditTail && data.auditTail.entries && data.auditTail.entries[0]) || null))
          .catch(console.error);
      }
    });
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
