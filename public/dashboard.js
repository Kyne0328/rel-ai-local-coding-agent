import { setToken, getToken, fetchJson, invalidateCache, DASHBOARD_DATA_URL } from './ui/api.js';
import { init as initStore, get as getStore } from './ui/store.js';
import { initRouter, currentSection, currentRoutePath, getWorkspaceFilter, setWorkspaceFilter, rerender } from './ui/router.js';
import { initEvents, startSSE, restartSSE } from './ui/events.js';
import { mountHome } from './ui/sections/home.js';
import { initUiPreferences } from './ui/preferences.js';

initUiPreferences();

const launchParams = new URLSearchParams(location.search);
const urlToken = launchParams.get('token') || '';
const surface = launchParams.get('surface') === 'desktop' ? 'desktop' : 'browser';
document.documentElement.dataset.surface = surface;
const token = urlToken || sessionStorage.getItem('relai_dashboard_token') || '';
if (token) setToken(token);
cleanLaunchQuery();
restoreRoute();

let _routerReady = false;
let _lastEventAt = null;
let _clockTimer = null;
let _shellStatus = { label: 'Connecting', tone: 'warn' };
let _liveState = 'connecting';
let _refreshPromise = null;
let _fallbackRefreshTimer = null;
let _livePollSeconds = null;

function cleanLaunchQuery() {
  const clean = new URLSearchParams(location.search);
  clean.delete('token');
  clean.delete('bootstrap');
  const query = clean.toString();
  let cleanUrl = location.pathname;
  if (query) cleanUrl += `?${query}`;
  cleanUrl += location.hash || '';
  history.replaceState(null, '', cleanUrl);
  const note = document.querySelector('.sidebar-note');
  if (note && surface === 'desktop') note.textContent = 'Desktop dashboard · live MCP state';
}

function restoreRoute() {
  if (location.hash) return;
  try {
    const saved = localStorage.getItem('relai_dashboard_route');
    if (saved) location.hash = `#${saved}`;
  } catch {}
}

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
  wireTopControls();
  initDesktopBridge();
  window.addEventListener('relai:route-change', updateWorkspaceScope);
  if (initial && initial.ok !== false) {
    activateRouter(routeRoot);
    updateShell(initial);
    configureLiveRefresh(initial);
  } else {
    renderDashboardState('loading', 'Loading workspace state…', 'Rel.AI is checking the local service, configuration, and workspace status.');
  }
  if (initial?.ok === false || !initial) {
    const refreshed = await doRefresh({ source: 'boot', render: _routerReady });
    if (refreshed?.ok !== false && !_routerReady) activateRouter(routeRoot);
  }
  window.addEventListener('relai:dashboard-refresh', () => doRefresh({ source: 'local-change', render: true }));
  initEvents(liveOnEvent, liveStateChange);
  startSSE(getToken);
  checkOnboarding();
}

function activateRouter(routeRoot = ensureRouteRoot()) {
  if (_routerReady || !routeRoot) return;
  _routerReady = true;
  initRouter(routeRoot, getSections());
}

let _sectionsCache = null;
function getSections() {
  return _sectionsCache || (_sectionsCache = {
    home: element => mountHome(element, getStore()),
    tasks: element => import('./ui/sections/tasks.js').then(module => module.mountTasks(element, getStore())).catch(debugError),
    workspaces: element => import('./ui/sections/workspaces.js').then(module => module.mountWorkspaces(element, getStore())).catch(debugError),
    activity: element => import('./ui/sections/activity.js').then(module => module.mountActivity(element)).catch(debugError),
    reference: element => import('./ui/sections/tools.js').then(module => module.mountTools(element)).catch(debugError),
    tools: element => import('./ui/sections/tools.js').then(module => module.mountTools(element)).catch(debugError),
    settings: element => import('./ui/sections/settings/index.js').then(module => module.mountSettings(element, settingsSubPage())).catch(debugError),
    connector: element => import('./ui/sections/settings/index.js').then(module => module.mountSettings(element, 'connector')).catch(debugError),
    diagnostics: element => import('./ui/sections/settings/index.js').then(module => module.mountSettings(element, 'diagnostics')).catch(debugError)
  });
}

function settingsSubPage() {
  const parts = currentRoutePath().split('/');
  return parts[0] === 'settings' && parts[1] ? parts[1] : 'general';
}

function wireTopControls() {
  document.getElementById('refreshBtn')?.addEventListener('click', event => {
    event.preventDefault();
    event.currentTarget.closest('details')?.removeAttribute('open');
    void doRefresh({ source: 'manual', render: true });
  });
  document.getElementById('workspaceScope')?.addEventListener('change', event => setWorkspaceFilter(event.target.value));
}

function initDesktopBridge() {
  const desktop = window.relaiDesktop;
  if (!desktop) return;
  desktop.onStatus(applyDesktopStatus);
  desktop.getStatus().then(applyDesktopStatus).catch(debugError);
}

function applyDesktopStatus(status) {
  if (!status) return;
  const data = { ...getStore(), desktopStatus: status };
  initStore(data);
  updateShell(data);
  if (_routerReady && !hasBlockingInteraction()) rerender();
}

async function doRefresh(options = {}) {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = performRefresh(options);
  try {
    return await _refreshPromise;
  } finally {
    _refreshPromise = null;
  }
}

async function performRefresh(options = {}) {
  let refreshState = 'error';
  setRefreshState('loading');
  invalidateCache(DASHBOARD_DATA_URL);
  try {
    const data = await fetchJson(DASHBOARD_DATA_URL);
    if (data && data.ok !== false) {
      initStore(data);
      updateShell(data);
      configureLiveRefresh(data);
      if (!_routerReady) activateRouter(ensureRouteRoot());
      else if (options.render !== false && !hasBlockingInteraction()) rerender();
      refreshState = 'idle';
      return data;
    }
    return renderRefreshFailure(data);
  } catch (error) {
    return renderRefreshFailure({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    setRefreshState(refreshState);
  }
}

function renderRefreshFailure(data) {
  const message = data?.error || 'The dashboard could not reach the local Rel.AI service.';
  _shellStatus = { label: data?.status === 401 ? 'Authentication failed' : 'Disconnected', tone: 'bad' };
  renderConnectionStatus();
  const updated = document.getElementById('lastUpdated');
  if (updated) updated.textContent = message;
  if (!_routerReady) renderDashboardState('error', data?.status === 401 ? 'Dashboard authentication failed.' : 'Rel.AI is not responding.', message);
  return data;
}

function setRefreshState(state) {
  const button = document.getElementById('refreshBtn');
  if (!button) return;
  const labels = { loading: 'Refreshing…', error: 'Retry now', idle: 'Refresh now' };
  button.disabled = state === 'loading';
  button.dataset.state = state;
  button.textContent = labels[state] || labels.idle;
}

function renderDashboardState(kind, title, description) {
  const routeRoot = ensureRouteRoot();
  if (!routeRoot) return;
  if (kind === 'loading') {
    routeRoot.innerHTML = `<div class="dashboard-state"><div class="dashboard-state-card"><div class="loading-mark" aria-hidden="true"></div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p><div class="skeleton-grid" aria-hidden="true"><div class="skeleton-block"></div><div class="skeleton-block"></div><div class="skeleton-block"></div></div></div></div>`;
    return;
  }
  routeRoot.innerHTML = `<div class="dashboard-state"><div class="dashboard-state-card"><span class="status-pill bad">Connection error</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p><div class="dashboard-state-actions"><button class="primary" type="button" data-dashboard-retry>Retry connection</button><a class="buttonlike secondary" href="#settings/diagnostics">Open diagnostics</a></div></div></div>`;
  routeRoot.querySelector('[data-dashboard-retry]')?.addEventListener('click', () => doRefresh({ source: 'retry', render: true }));
}

async function liveOnEvent(data) {
  if (!data || data.ok === false) return;
  initStore(data);
  updateShell(data);
  configureLiveRefresh(data);
  if (!_routerReady) activateRouter();
  if (currentSection() === 'activity') {
    import('./ui/sections/activity.js').then(module => module.mergeEntries(data.auditTail?.entries || [])).catch(debugError);
  } else if (!hasBlockingInteraction()) {
    rerender();
  }
}

function configureLiveRefresh(data) {
  const productUx = data?.config?.productUx || {};
  const refreshSeconds = boundedSeconds(productUx.dashboardRefreshSeconds, 5, 1, 3600);
  if (_fallbackRefreshTimer) clearInterval(_fallbackRefreshTimer);
  _fallbackRefreshTimer = window.setInterval(() => {
    if (_liveState !== 'live' && document.visibilityState !== 'hidden') {
      void doRefresh({ source: 'fallback', render: true });
    }
  }, refreshSeconds * 1000);

  const nextPollSeconds = boundedSeconds(productUx.liveLogPollSeconds, 3, 1, 300);
  if (_livePollSeconds != null && nextPollSeconds !== _livePollSeconds) restartSSE(getToken);
  _livePollSeconds = nextPollSeconds;
}

function boundedSeconds(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(Math.floor(number), min), max) : fallback;
}

function liveStateChange(detail) {
  _liveState = detail.state || 'connecting';
  if (detail.lastEventAt) _lastEventAt = detail.lastEventAt;
  renderConnectionStatus();
  ensureClock();
}

function updateShell(data) {
  const config = data?.config || {};
  const workspaces = Array.isArray(config.workspaces) ? config.workspaces : [];
  const task = data?.taskActivity || {};
  const presentation = shellPresentation(data?.ok !== false, task, workspaces.length, data?.desktopStatus);
  const subtitle = document.getElementById('subtitle');
  if (subtitle) subtitle.textContent = presentation.subtitle;
  _shellStatus = presentation;
  renderConnectionStatus();
  updateWorkspaceScope();
  _lastEventAt ||= Date.parse(data.generatedAt || '') || Date.now();
  renderLastEventTime();
}

function shellPresentation(ok, task, workspaceCount, desktopStatus) {
  if (!ok) return { subtitle: 'The dashboard reported an error.', label: 'Error', tone: 'bad' };
  if (desktopStatus?.tunnelStatus === 'connecting') {
    return { subtitle: 'Local dashboard ready · publishing the ChatGPT endpoint', label: 'Connecting', tone: 'warn' };
  }
  if (desktopStatus?.error || desktopStatus?.tunnelStatus === 'failed') {
    return { subtitle: desktopStatus.error || 'The public tunnel failed.', label: 'Needs attention', tone: 'bad' };
  }
  const taskCount = Number(task.activeTaskCount || task.tasks?.length || 0) || 1;
  const callCount = Number(task.activeCalls || 0);
  if (task.state === 'working') {
    return {
      subtitle: `${taskCount} ${pluralLabel(taskCount, 'ChatGPT task')} running · ${callCount} ${pluralLabel(callCount, 'active tool call')}`,
      label: `${taskCount} running`,
      tone: 'working'
    };
  }
  if (task.state === 'settling') {
    return {
      subtitle: `${taskCount} ${pluralLabel(taskCount, 'task')} waiting for follow-up tool calls`,
      label: `${taskCount} open`,
      tone: 'warn'
    };
  }
  return {
    subtitle: `${workspaceCount} ${pluralLabel(workspaceCount, 'workspace')} available to ChatGPT`,
    label: 'Ready',
    tone: 'ok'
  };
}

function pluralLabel(count, singular) {
  return Number(count) === 1 ? singular : `${singular}s`;
}

function updateWorkspaceScope() {
  const select = document.getElementById('workspaceScope');
  if (!select) return;
  const control = document.getElementById('workspaceScopeControl');
  const supportsWorkspaceScope = ['home', 'tasks', 'workspaces', 'activity'].includes(currentSection());
  if (control) control.hidden = !supportsWorkspaceScope;
  else select.hidden = !supportsWorkspaceScope;
  if (!supportsWorkspaceScope) return;
  const workspaces = getStore()?.config?.workspaces || [];
  const selected = getWorkspaceFilter();
  select.innerHTML = '<option value="">All workspaces</option>' + workspaces.map(workspace => `<option value="${escapeHtml(workspace.alias)}">${escapeHtml(workspace.alias)}</option>`).join('');
  select.value = workspaces.some(workspace => workspace.alias === selected) ? selected : '';
}

function renderConnectionStatus() {
  const status = document.getElementById('connectionStatus');
  if (!status) return;
  let presentation = _shellStatus;
  if (presentation.tone === 'ok') {
    const liveStates = {
      connecting: { label: 'Connecting', tone: 'warn' },
      live: { label: 'Connected', tone: 'ok' },
      reconnecting: { label: 'Reconnecting', tone: 'warn' },
      paused: { label: 'Updates paused', tone: 'warn' },
      stopped: { label: 'Offline', tone: 'bad' }
    };
    presentation = liveStates[_liveState] || presentation;
  }
  status.className = `status-pill ${presentation.tone}`;
  status.textContent = presentation.label;
}

function ensureClock() {
  if (_clockTimer) return;
  _clockTimer = window.setInterval(renderLastEventTime, 1000);
}

function renderLastEventTime() {
  const updated = document.getElementById('lastUpdated');
  if (!updated || !_lastEventAt) return;
  const seconds = Math.max(0, Math.floor((Date.now() - _lastEventAt) / 1000));
  if (seconds < 5) {
    updated.textContent = 'Updated just now';
    return;
  }
  if (seconds < 60) {
    updated.textContent = `Updated ${seconds}s ago`;
    return;
  }
  updated.textContent = `Updated ${Math.floor(seconds / 60)}m ago`;
}

function hasBlockingInteraction() {
  if (document.getElementById('__relai-modal-backdrop')) return true;
  if (document.getElementById('__relai-drawer-backdrop')) return true;
  const saveRow = document.getElementById('__settings-save-row');
  return Boolean(saveRow && !saveRow.hidden);
}

async function checkOnboarding() {
  try {
    const status = await fetchJson('/api/onboarding/status');
    if (status?.needsOnboarding) {
      const { openOnboarding } = await import('./ui/sections/onboarding.js');
      openOnboarding();
    }
  } catch (error) { debugError(error); }
}

function debugError(error) {
  if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

boot();
