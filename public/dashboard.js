import { setToken, getToken, fetchJson, invalidateCache, DASHBOARD_DATA_URL } from './ui/api.js';
import { init as initStore, get as getStore } from './ui/store.js';
import { initRouter, currentSection, currentRoutePath, getRouteParams, replaceRouteParams, rerender } from './ui/router.js';
import { initEvents, startSSE } from './ui/events.js';
import { mountHome, updateHomeLiveState } from './ui/features/home/index.js';
import { initUiPreferences } from './ui/preferences.js';
import { connectionLayerViews, connectionSummary, withConnectionState } from './ui/connection-state.js';
import { initCommandPalette } from './ui/command-palette.js';
import { normalizeRouteKey } from './ui/route-policy.js';
import { closeDrawer } from './ui/components/drawer.js';
import { initWindowChrome } from './ui/window-chrome.js';
import { createDashboardClock } from './ui/clock.js';
import { createSnapshotGate } from './ui/snapshot-order.js';
import { initUpdateAvailableModal } from './ui/update-available-modal.js';
import { initSidebar } from './ui/sidebar.js';

initUiPreferences();
initSidebar();

const launchParams = new URLSearchParams(location.search);
const urlToken = launchParams.get('token') || '';
const surface = launchParams.get('surface') === 'desktop' ? 'desktop' : 'browser';
const requestedChrome = surface === 'desktop' && launchParams.get('chrome') === 'custom' ? 'custom' : 'native';
const requestedPlatform = ['win32', 'darwin', 'linux', 'other'].includes(launchParams.get('platform')) ? launchParams.get('platform') : 'other';
document.documentElement.dataset.surface = surface;
document.documentElement.dataset.windowChrome = requestedChrome;
document.documentElement.dataset.platform = requestedPlatform;
if (surface === 'desktop') initUpdateAvailableModal();
const token = urlToken || sessionStorage.getItem('relai_dashboard_token') || '';
if (token) setToken(token);
cleanLaunchQuery();
restoreRoute();

let _routerReady = false;
let _lastEventAt = null;
let _dashboardClock = null;
let _shellStatus = { label: 'Connecting', tone: 'warn' };
let _liveState = 'connecting';
let _refreshPromise = null;
let _renderFingerprint = '';
let _renderFrame = 0;
let _renderWaiters = [];
let _deferredViewRender = false;
const _snapshotGate = createSnapshotGate();

function cleanLaunchQuery() {
  const clean = new URLSearchParams(location.search);
  clean.delete('token');
  clean.delete('bootstrap');
  const query = clean.toString();
  let cleanUrl = location.pathname;
  if (query) cleanUrl += `?${query}`;
  const rawHash = (location.hash || '').slice(1);
  if (rawHash) cleanUrl += `#${normalizeRouteKey(rawHash)}`;
  history.replaceState(null, '', cleanUrl);
  const note = document.querySelector('.sidebar-note');
  if (note && surface === 'desktop') note.textContent = 'Desktop dashboard · live MCP state';
}

function restoreRoute() {
  if (location.hash) return;
  try {
    const saved = localStorage.getItem('relai_dashboard_route');
    if (saved) location.hash = `#${normalizeRouteKey(saved)}`;
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
  _dashboardClock = createDashboardClock({
    onTick: currentTime => {
      renderLastEventTime(currentTime);
      window.dispatchEvent(new CustomEvent('relai:clock-tick', { detail: { now: currentTime } }));
    }
  }).start();
  window.addEventListener('pagehide', () => _dashboardClock?.stop(), { once: true });
  const initialPayload = readInitialPayload();
  const initial = initialPayload?.ok !== false ? withConnectionState(initialPayload || {}, _liveState) : initialPayload;
  _snapshotGate.accept(initialPayload);
  initStore(initial?.ok !== false ? initial || {} : {});
  const routeRoot = ensureRouteRoot();
  if (!routeRoot) return;
  initCommandPalette({ getData: getStore });
  initDesktopBridge();
  window.addEventListener('relai:route-change', () => {
    closeDrawer();
    _renderFingerprint = '';
  });
  window.addEventListener('relai:route-mounted', event => {
    _renderFingerprint = viewFingerprint(getStore());
    focusWorkspaceCard(event);
  });
  if (initial && initial.ok !== false) {
    activateRouter(routeRoot);
    updateShell(initial);
  } else {
    renderDashboardState('loading', 'Loading workspace state…', 'Rel.AI is checking the connection service, configuration, and workspace status.');
  }
  if (initial?.ok === false || !initial) {
    const refreshed = await doRefresh({ source: 'boot', render: _routerReady });
    if (refreshed?.ok !== false && !_routerReady) activateRouter(routeRoot);
  }
  window.addEventListener('relai:dashboard-refresh', event => doRefresh({
    source: 'local-change',
    render: event.detail?.structural === true ? true : undefined
  }));
  document.addEventListener('focusout', event => {
    if (event.target instanceof HTMLSelectElement) flushDeferredViewRender();
  }, true);
  document.addEventListener('change', event => {
    if (event.target instanceof HTMLSelectElement) flushDeferredViewRender({ ignoreFocusedSelect: true });
  }, true);
  window.addEventListener('relai:dropdown-closed', flushDeferredViewRender);
  initEvents(liveOnEvent, liveStateChange);
  startSSE(getToken, initial?.snapshot?.revision);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void doRefresh({ source: 'visibility-resume' });
  });
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
    tasks: element => import('./ui/features/sessions/index.js').then(module => module.mountTasks(element, getStore())).catch(debugError),
    workspaces: element => import('./ui/features/workspaces/index.js').then(module => module.mountWorkspaces(element, getStore())).catch(debugError),
    activity: element => import('./ui/features/activity/index.js').then(module => module.mountActivity(element, getStore())).catch(debugError),
    settings: element => import('./ui/features/settings/index.js').then(module => module.mountSettings(element, settingsSubPage())).catch(debugError),
    system: element => mountSystemRoute(element, 'connection'),
    connection: element => mountSystemRoute(element, 'connection'),
    processes: element => mountSystemRoute(element, 'processes'),
    diagnostics: element => mountSystemRoute(element, 'diagnostics'),
    tools: element => mountSystemRoute(element, 'tools'),
    usage: element => mountSystemRoute(element, 'usage')
  });
}
function mountSystemRoute(element, pageId) {
  return import('./ui/features/system/index.js').then(module => module.mountSystemPage(element, pageId)).catch(debugError);
}

function settingsSubPage() {
  const parts = currentRoutePath().split('/');
  return parts[0] === 'settings' && parts[1] ? parts[1] : 'preferences';
}

function initDesktopBridge() {
  const desktop = window.relaiDesktop;
  if (!desktop) {
    document.documentElement.dataset.windowChrome = 'native';
    return;
  }
  void initWindowChrome(desktop).catch(debugError);
  desktop.onStatus(applyDesktopStatus);
  desktop.getStatus().then(applyDesktopStatus).catch(debugError);
}

function applyDesktopStatus(status) {
  if (!status) return;
  const data = withConnectionState({ ...getStore(), desktopStatus: status }, _liveState);
  initStore(data);
  updateShell(data);
  if (_routerReady) void syncLiveView(data);
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
  invalidateCache(DASHBOARD_DATA_URL);
  try {
    const data = await fetchJson(DASHBOARD_DATA_URL, { cache: 'no-store' });
    if (data && data.ok !== false) {
      const hydrated = withConnectionState(data, _liveState);
      initStore(hydrated);
      updateShell(hydrated);
      if (!_routerReady) activateRouter(ensureRouteRoot());
      else if (options.render === true) await renderViewIfChanged(hydrated);
      else if (options.render !== false) await syncLiveView(hydrated);
      _lastEventAt = Date.now();
      return hydrated;
    }
    return renderRefreshFailure(data);
  } catch (error) {
    return renderRefreshFailure({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function renderRefreshFailure(data) {
  const message = data?.error || 'The dashboard could not reach the Rel.AI connection service.';
  _shellStatus = { label: data?.status === 401 ? 'Authentication failed' : 'Disconnected', tone: 'bad' };
  renderConnectionStatus();
  const updated = document.getElementById('lastUpdated');
  if (updated) updated.textContent = message;
  if (!_routerReady) renderDashboardState('error', data?.status === 401 ? 'Dashboard authentication failed.' : 'Rel.AI is not responding.', message);
  return data;
}

function renderDashboardState(kind, title, description) {
  const routeRoot = ensureRouteRoot();
  if (!routeRoot) return;
  if (kind === 'loading') {
    routeRoot.innerHTML = `<div class="dashboard-state" role="status" aria-live="polite" aria-busy="true"><div class="dashboard-state-card"><div class="loading-mark" aria-hidden="true"></div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p><div class="skeleton-grid" aria-hidden="true"><div class="skeleton-block"></div><div class="skeleton-block"></div><div class="skeleton-block"></div></div></div></div>`;
    return;
  }
  routeRoot.innerHTML = `<div class="dashboard-state" role="alert"><div class="dashboard-state-card"><span class="status-pill bad">Connection error</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p><div class="dashboard-state-actions"><button class="primary" type="button" data-dashboard-retry>Retry connection</button><a class="buttonlike secondary" href="#diagnostics">Open diagnostics</a></div></div></div>`;
  routeRoot.querySelector('[data-dashboard-retry]')?.addEventListener('click', () => doRefresh({ source: 'retry', render: true }));
}

async function liveOnEvent(data) {
  if (!data || data.ok === false || !_snapshotGate.accept(data)) return;
  const hydrated = withConnectionState(data, _liveState);
  initStore(hydrated);
  updateShell(hydrated);
  if (!_routerReady) activateRouter();
  await syncLiveView(hydrated);
}

async function syncLiveView(data) {
  let updated = false;
  try {
    updated = await updateLiveView(data);
  } catch (error) {
    debugError(error);
  }
  if (!updated) return false;
  _renderFingerprint = viewFingerprint(data);
  return true;
}

async function updateLiveView(data) {
  const root = ensureRouteRoot();
  if (!root) return false;
  switch (currentSection()) {
    case 'home':
      return updateHomeLiveState(root, data);
    case 'activity': {
      const module = await import('./ui/features/activity/index.js');
      return module.updateActivityLiveState(data);
    }
    case 'tasks': {
      const module = await import('./ui/features/sessions/index.js');
      return module.updateTaskSessions(root, data);
    }
    case 'system':
    case 'connection':
    case 'processes': {
      const module = await import('./ui/features/system/index.js');
      return module.updateSystemLiveState(root, currentSection(), data);
    }
    case 'usage':
      return true;
    default:
      return false;
  }
}

function liveStateChange(detail) {
  _liveState = detail.state || 'connecting';
  if (detail.lastEventAt) _lastEventAt = detail.lastEventAt;
  const data = withConnectionState(getStore(), _liveState);
  initStore(data);
  renderConnectionStatus();
  if (_routerReady && ['system', 'connection'].includes(currentRoutePath())) void syncLiveView(data);
}

function updateShell(data) {
  const config = data?.config || {};
  const workspaces = Array.isArray(config.workspaces) ? config.workspaces : [];
  const task = data?.taskActivity || {};
  const presentation = shellPresentation(data?.ok !== false, task, workspaces.length, data?.connectionState);
  _shellStatus = presentation;
  renderConnectionStatus();
  _lastEventAt ||= Date.parse(data.generatedAt || '') || Date.now();
  renderLastEventTime();
}

function shellPresentation(ok, task, workspaceCount, connectionState) {
  if (!ok) return { subtitle: 'The dashboard reported an error.', label: 'Error', tone: 'bad' };
  const connection = connectionSummary(connectionState);
  if (connection.tone !== 'ok') return { subtitle: connection.message, label: connection.label, tone: connection.tone };
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
    label: 'Available',
    tone: 'ok'
  };
}

function pluralLabel(count, singular) {
  return Number(count) === 1 ? singular : `${singular}s`;
}

function renderViewIfChanged(data) {
  if (!_routerReady) return Promise.resolve(false);
  if (hasBlockingInteraction()) {
    _deferredViewRender = true;
    return Promise.resolve(false);
  }
  _deferredViewRender = false;
  const nextFingerprint = viewFingerprint(data);
  if (nextFingerprint === _renderFingerprint) return Promise.resolve(false);
  _renderFingerprint = nextFingerprint;
  return new Promise(resolve => {
    _renderWaiters.push(resolve);
    if (_renderFrame) return;
    _renderFrame = window.requestAnimationFrame(async () => {
      _renderFrame = 0;
      let rendered = false;
      try {
        if (!hasBlockingInteraction()) {
          await rerender({ preserveView: true });
          rendered = true;
        } else {
          _renderFingerprint = '';
          _deferredViewRender = true;
        }
      } catch (error) {
        _renderFingerprint = '';
        debugError(error);
      }
      const waiters = _renderWaiters.splice(0);
      waiters.forEach(waiter => waiter(rendered));
    });
  });
}

function viewFingerprint(data = {}) {
  const path = currentRoutePath();
  const route = `${path}?${getRouteParams().toString()}`;
  const config = data.config || {};
  const desktop = data.desktopStatus || {};
  const desktopState = {
    serverRunning: desktop.serverRunning,
    starting: desktop.starting,
    tunnelStatus: desktop.tunnelStatus,
    tunnelId: desktop.tunnelId,
    tunnelHealthUrl: desktop.tunnelHealthUrl,
    localMcpUrl: desktop.localMcpUrl,
    errorCode: desktop.errorCode,
    error: desktop.error
  };
  let payload;
  switch (currentSection()) {
    case 'activity':
      payload = route;
      break;
    case 'tasks':
      payload = [route, data.tasks || [], data.taskActivity || {}];
      break;
    case 'workspaces':
      payload = [route, config.workspaces || [], data.workspaceStates || {}, data.health || {}];
      break;
    case 'processes':
      payload = [route, data.managedProcesses || []];
      break;
    case 'tools':
    case 'reference':
      payload = [route, data.tools || []];
      break;
    case 'usage':
      payload = route;
      break;
    case 'settings':
    case 'system':
    case 'connection':
    case 'diagnostics':
      payload = [route, data.application || {}, config, data.connectionState || {}, data.mcpAuthentication || {}, data.mcpConnection || {}, desktopState];
      break;
    default:
      payload = [route, config.workspaces || [], data.tasks || [], data.taskActivity || {}, data.health || {}, data.connectionState || {}, data.mcpAuthentication || {}, data.mcpConnection || {}, desktopState];
  }
  return JSON.stringify(payload);
}

function focusWorkspaceCard(event) {
  if (event?.detail?.section !== 'workspaces') return;
  const params = event.detail.params || getRouteParams();
  const alias = params.get('workspace') || '';
  if (!alias || params.get('focus') !== '1') return;
  recordRecentWorkspace(alias);
  const selector = `[data-workspace-card="${cssEscape(alias)}"]`;
  const card = document.querySelector(selector);
  if (!card) return;
  card.tabIndex = -1;
  card.classList.add('workspace-card-focused');
  card.focus({ preventScroll: true });
  card.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  replaceRouteParams({ focus: null });
  window.setTimeout(() => card.classList.remove('workspace-card-focused'), 1800);
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`);
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function renderConnectionStatus() {
  const status = document.getElementById('connectionStatus');
  if (!status) return;
  let presentation = _shellStatus;
  if (presentation.tone === 'ok') {
    const dashboardLayer = connectionLayerViews(getStore().connectionState).find(layer => layer.key === 'dashboardUpdates');
    if (dashboardLayer) presentation = { label: dashboardLayer.label, tone: dashboardLayer.tone };
  }
  status.className = `status-pill ${presentation.tone}`;
  status.textContent = presentation.label;
  status.setAttribute('aria-label', `Open Connection settings; current status ${presentation.label}`);
}

function renderLastEventTime(now = Date.now()) {
  const updated = document.getElementById('lastUpdated');
  if (!updated || !_lastEventAt) return;
  const seconds = Math.max(0, Math.floor((now - _lastEventAt) / 1000));
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

function hasBlockingInteraction(options = {}) {
  if (document.getElementById('__relai-modal-backdrop')) return true;
  if (document.getElementById('__relai-drawer-backdrop')) return true;
  if (document.querySelector('[aria-haspopup][aria-expanded="true"]')) return true;
  if (!options.ignoreFocusedSelect && document.activeElement instanceof HTMLSelectElement) return true;
  const saveRow = document.getElementById('__settings-save-row');
  return Boolean(saveRow && !saveRow.hidden);
}

function flushDeferredViewRender(options = {}) {
  if (!_deferredViewRender) return;
  window.requestAnimationFrame(() => {
    if (!_deferredViewRender || hasBlockingInteraction(options)) return;
    _deferredViewRender = false;
    _renderFingerprint = '';
    void renderViewIfChanged(getStore());
  });
}

async function checkOnboarding() {
  try {
    const status = await fetchJson('/api/onboarding/status');
    const onboarding = await import('./ui/features/onboarding/index.js');
    const pending = onboarding.syncDesktopSetupState(status || {});
    if (!pending) document.querySelector('[data-desktop-setup-checklist]')?.remove();
    else if (_routerReady && currentSection() === 'home') await rerender({ preserveView: true });
  } catch (error) { debugError(error); }
}

function debugError(error) {
  if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

boot();
