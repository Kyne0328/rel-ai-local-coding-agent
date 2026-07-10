import { setToken, getToken, fetchJson, DASHBOARD_DATA_URL } from './ui/api.js';
import { init as initStore, get as getStore } from './ui/store.js';
import { initRouter, currentSection, navigate, rerender } from './ui/router.js';
import { initEvents, startSSE } from './ui/events.js';
import { mountHome } from './ui/sections/home.js';
import { initCommandPalette, openCommandPalette } from './ui/components/command-palette.js';
import { initUiPreferences } from './ui/preferences.js';

const ROUTES = [
  { id: 'home', label: 'Overview' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'activity', label: 'Activity' },
  { id: 'tools', label: 'Tools' },
  { id: 'settings', label: 'Settings' },
];
const SETTINGS_SUBROUTES = [
  { id: 'connector', label: 'Settings → Connector' },
  { id: 'diagnostics', label: 'Settings → Diagnostics' },
];

initUiPreferences();

const urlToken = new URLSearchParams(location.search).get('token') || '';
const token = urlToken || sessionStorage.getItem('relai_dashboard_token') || '';
if (token) setToken(token);

let _routerReady = false;

function readInitialPayload() {
  try {
    const element = document.getElementById('initialDashboardData');
    return element?.textContent ? JSON.parse(element.textContent) : null;
  } catch {
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
  main.appendChild(routeRoot);
  return routeRoot;
}

async function boot() {
  const initial = readInitialPayload();
  initStore(initial?.ok !== false ? initial || {} : {});
  const routeRoot = ensureRouteRoot();
  if (!routeRoot) return;

  _wireTopControls();
  if (initial?.ok !== false) {
    _activateRouter(routeRoot);
    _updateShell(initial || {});
  } else {
    _renderDashboardState('loading', 'Loading workspace state…', 'Rel.AI is checking the local service, configuration, and workspace status.');
  }

  const refreshed = await _doRefresh({ source: 'boot', render: _routerReady });
  if (refreshed?.ok !== false && !_routerReady) _activateRouter(routeRoot);
  _setupCommandPalette();

  window.addEventListener('relai:dashboard-refresh', () => _doRefresh({ source: 'local-change', render: true }));
  initEvents(_liveOnEvent);
  startSSE(getToken);
  _checkOnboarding();
}

function _activateRouter(routeRoot = ensureRouteRoot()) {
  if (_routerReady || !routeRoot) return;
  _routerReady = true;
  initRouter(routeRoot, getSections());
}

function _setupCommandPalette() {
  const storeData = getStore();
  const navActions = [
    ...ROUTES.map(route => ({ label: route.label, href: '#' + route.id, category: 'Navigation' })),
    ...SETTINGS_SUBROUTES.map(route => ({ label: route.label, href: '#settings/' + route.id, category: 'Navigation' })),
  ];
  const actionActions = [
    { label: 'Refresh dashboard', category: 'Actions', action: () => _doRefresh({ source: 'manual', render: true }) },
    { label: 'Add workspace', category: 'Actions', action: () => navigate('workspaces') },
    { label: 'Open connector settings', category: 'Actions', href: '#settings/connector' },
    { label: 'Copy MCP endpoint', category: 'Actions', action: () => {
      const endpoint = getStore()?.connection?.chatgptMcpUrl;
      if (endpoint) navigator.clipboard.writeText(endpoint).catch(_debugError);
    } },
    { label: 'Copy dashboard token', category: 'Actions', action: () => { if (getToken()) navigator.clipboard.writeText(getToken()).catch(_debugError); } },
  ];
  const workspaceList = storeData.config && Array.isArray(storeData.config.workspaces) ? storeData.config.workspaces : [];
  const workspaceActions = workspaceList.map(workspace => ({
    label: 'Switch to workspace: ' + workspace.alias,
    category: 'Workspaces',
    action: () => { const element = document.getElementById('workspace'); if (element) element.value = workspace.alias; }
  }));
  initCommandPalette([...navActions, ...actionActions, ...workspaceActions]);
}

let _sectionsCache = null;
function getSections() {
  return _sectionsCache || (_sectionsCache = {
    home:        element => mountHome(element, getStore()),
    workspaces:  element => import('./ui/sections/workspaces.js').then(module => module.mountWorkspaces(element, getStore())).catch(_debugError),
    activity:    element => import('./ui/sections/activity.js').then(module => module.mountActivity(element)).catch(_debugError),
    tools:       element => import('./ui/sections/tools.js').then(module => module.mountTools(element)).catch(_debugError),
    settings:    element => import('./ui/sections/settings/index.js').then(module => module.mountSettings(element, _settingsSubPage())).catch(_debugError),
    connector:   element => import('./ui/sections/settings/index.js').then(module => module.mountSettings(element, 'connector')).catch(_debugError),
    diagnostics: element => import('./ui/sections/settings/index.js').then(module => module.mountSettings(element, 'diagnostics')).catch(_debugError),
  });
}

function _settingsSubPage() {
  const parts = (location.hash || '').replace(/^#/, '').split('/');
  return parts[0] === 'settings' && parts[1] ? parts[1] : 'general';
}

function _wireTopControls() {
  const refreshButton = document.getElementById('refreshBtn');
  if (refreshButton) refreshButton.onclick = () => _doRefresh({ source: 'manual', render: true });

  const commandButton = document.getElementById('commandPaletteBtn');
  if (commandButton) commandButton.onclick = () => openCommandPalette();

  const workspaceSelect = document.getElementById('workspaceQuickNav');
  if (workspaceSelect) {
    workspaceSelect.onchange = () => {
      const alias = workspaceSelect.value;
      if (!alias) return;
      navigate('workspaces');
      window.setTimeout(() => focusWorkspaceCard(alias), 120);
      workspaceSelect.value = '';
    };
  }
}

async function _doRefresh(options = {}) {
  _setRefreshState('loading');
  const data = await fetchJson(DASHBOARD_DATA_URL);
  if (data && data.ok !== false) {
    initStore(data);
    _updateShell(data);
    _setupCommandPalette();
    const routeRoot = ensureRouteRoot();
    if (!_routerReady) _activateRouter(routeRoot);
    else if (options.render !== false && !_hasBlockingInteraction()) rerender();
    _setRefreshState('idle');
    return data;
  }

  _setRefreshState('error');
  const message = data?.error || 'The dashboard could not reach the local Rel.AI service.';
  const status = document.getElementById('serverStatus');
  if (status) {
    status.className = 'status-pill bad';
    status.textContent = data?.status === 401 ? 'Authentication failed' : 'Disconnected';
  }
  const updated = document.getElementById('lastUpdated');
  if (updated) updated.textContent = message;
  if (!_routerReady) {
    _renderDashboardState('error', data?.status === 401 ? 'Dashboard authentication failed.' : 'Rel.AI is not responding.', message);
  }
  return data;
}

function refreshButtonLabel(state) {
  if (state === 'loading') return 'Refreshing…';
  if (state === 'error') return 'Retry';
  return 'Refresh';
}

function _setRefreshState(state) {
  const button = document.getElementById('refreshBtn');
  if (!button) return;
  button.disabled = state === 'loading';
  button.dataset.state = state;
  button.textContent = refreshButtonLabel(state);
}

function _renderDashboardState(kind, title, description) {
  const routeRoot = ensureRouteRoot();
  if (!routeRoot) return;
  if (kind === 'loading') {
    routeRoot.innerHTML = `
      <div class="dashboard-state">
        <div class="dashboard-state-card">
          <div class="loading-mark" aria-hidden="true"></div>
          <h2>${_escapeHtml(title)}</h2>
          <p>${_escapeHtml(description)}</p>
          <div class="skeleton-grid" aria-hidden="true"><div class="skeleton-block"></div><div class="skeleton-block"></div><div class="skeleton-block"></div></div>
        </div>
      </div>`;
    return;
  }
  routeRoot.innerHTML = `
    <div class="dashboard-state">
      <div class="dashboard-state-card">
        <span class="status-pill bad">Connection error</span>
        <h2>${_escapeHtml(title)}</h2>
        <p>${_escapeHtml(description)}</p>
        <div class="dashboard-state-actions">
          <button class="primary" type="button" data-dashboard-retry>Retry connection</button>
          <a class="buttonlike secondary" href="#settings/diagnostics">Open diagnostics</a>
        </div>
      </div>
    </div>`;
  routeRoot.querySelector('[data-dashboard-retry]')?.addEventListener('click', () => _doRefresh({ source: 'retry', render: true }));
}

async function _liveOnEvent(data) {
  if (!data || data.ok === false) return;
  initStore(data);
  _updateShell(data);
  _setupCommandPalette();
  if (!_routerReady) _activateRouter();
  if (currentSection() === 'activity') {
    import('./ui/sections/activity.js')
      .then(module => module.prependEntry(data.auditTail?.entries?.[0] || null))
      .catch(_debugError);
  }
}

function _updateShell(data) {
  const config = data?.config || {};
  const workspaces = Array.isArray(config.workspaces) ? config.workspaces : [];
  const count = workspaces.length;
  populateWorkspaceQuickNav(workspaces);
  const subtitle = document.getElementById('subtitle');
  if (subtitle) subtitle.textContent = `${count} workspace${count === 1 ? '' : 's'} available to ChatGPT`;
  const updated = document.getElementById('lastUpdated');
  if (updated) updated.textContent = 'Updated ' + new Date(data.generatedAt || Date.now()).toLocaleTimeString();
  const status = document.getElementById('serverStatus');
  if (status) {
    status.className = 'status-pill ' + (data?.ok !== false ? 'ok' : 'bad');
    status.textContent = data?.ok !== false ? 'Online' : 'Error';
  }
}

function populateWorkspaceQuickNav(workspaces) {
  const select = document.getElementById('workspaceQuickNav');
  if (!select) return;
  const options = ['<option value="">Workspaces</option>'];
  for (const workspace of workspaces) {
    const alias = _escapeHtml(workspace.alias || 'workspace');
    options.push(`<option value="${alias}">${alias}</option>`);
  }
  select.innerHTML = options.join('');
}

function focusWorkspaceCard(alias) {
  const cards = Array.from(document.querySelectorAll('[data-workspace-card]'));
  const card = cards.find(element => element.dataset.workspaceCard === alias);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.setAttribute('tabindex', '-1');
  card.focus({ preventScroll: true });
}

function _hasBlockingInteraction() {
  if (document.getElementById('__relai-modal-backdrop')) return true;
  if (document.getElementById('__relai-drawer-backdrop')) return true;
  const saveRow = document.getElementById('__settings-save-row');
  return Boolean(saveRow && !saveRow.hidden);
}

async function _checkOnboarding() {
  try {
    const status = await fetchJson('/api/onboarding/status');
    if (status?.needsOnboarding) {
      const { openOnboarding } = await import('./ui/sections/onboarding.js');
      openOnboarding();
    }
  } catch (error) {
    _debugError(error);
  }
}

function _debugError(error) {
  if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
}

function _escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

boot();
