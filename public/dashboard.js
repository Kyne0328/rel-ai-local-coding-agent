import { fetchJson, invalidateCache, DASHBOARD_DATA_URL } from './ui/api.js';
import { init as initStore, get as getStore, applyLiveEvent, patchLocalConnection } from './ui/store.js';
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
import { initUpdateAvailableModal } from './ui/update-available-modal.js';
import { initConnectorRefreshModal } from './ui/connector-refresh-modal.js';
import { initSidebar } from './ui/sidebar.js';
import { recordRecentWorkspace } from './ui/features/workspaces/recents.js';

initUiPreferences();
initSidebar();

const launchParams = new URLSearchParams(location.search);
const surface = launchParams.get('surface') === 'desktop' ? 'desktop' : 'browser';
const requestedChrome = surface === 'desktop' && launchParams.get('chrome') === 'custom' ? 'custom' : 'native';
const requestedPlatform = ['win32', 'darwin', 'linux', 'other'].includes(launchParams.get('platform')) ? launchParams.get('platform') : 'other';
document.documentElement.dataset.surface = surface;
document.documentElement.dataset.windowChrome = requestedChrome;
document.documentElement.dataset.platform = requestedPlatform;
if (surface === 'desktop') {
  initConnectorRefreshModal();
  initUpdateAvailableModal();
}
cleanLaunchQuery();
restoreRoute();

let _routerReady = false;
let _lastEventAt = null;
let _dashboardClock = null;
let _shellStatus = { label: 'Connecting', tone: 'warn' };
let _liveState = 'connecting';
let _refreshPromise = null;
let _refreshLiveEvents = null;
let _refreshLiveEventOverflow = false;
let _renderRevisionKey = '';
let _renderFrame = 0;
let _renderWaiters = [];
let _deferredViewRender = false;
let _recoveryNoticeTimer = null;
const AUTO_RECOVERY_DELAYS_MS = [0, 600, 1600];
const MAX_REFRESH_LIVE_EVENTS = 500;

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
  if (note && surface === 'desktop') note.textContent = 'Desktop app · live status';
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
  initStore(initial?.ok !== false ? initial || {} : {});
  const routeRoot = ensureRouteRoot();
  if (!routeRoot) return;
  initCommandPalette({ getData: getStore });
  initDesktopBridge();
  window.addEventListener('relai:route-change', () => {
    closeDrawer();
    _renderRevisionKey = '';
  });
  window.addEventListener('relai:route-mounted', event => {
    _renderRevisionKey = viewRevisionKey(getStore());
    focusWorkspaceCard(event);
  });
  if (initial && initial.ok !== false) {
    activateRouter(routeRoot);
    updateShell(initial);
  } else {
    renderDashboardState('loading', 'Loading Rel.AI…', 'Checking your connection and project access.');
  }
  if (initial?.ok === false || !initial) {
    const refreshed = await recoverDashboard({ source: 'boot', render: _routerReady });
    if (refreshed?.ok !== false && !_routerReady) activateRouter(routeRoot);
  }
  window.addEventListener('relai:dashboard-refresh', event => doRefresh({
    source: 'local-change',
    render: event.detail?.structural === true ? true : undefined
  }));
  window.addEventListener('relai:desktop-status-refresh', event => applyDesktopStatus(event.detail));
  document.addEventListener('focusout', event => {
    if (event.target instanceof HTMLSelectElement) flushDeferredViewRender();
  }, true);
  document.addEventListener('change', event => {
    if (event.target instanceof HTMLSelectElement) flushDeferredViewRender({ ignoreFocusedSelect: true });
  }, true);
  window.addEventListener('relai:dropdown-closed', flushDeferredViewRender);
  initEvents(liveOnEvent, liveStateChange);
  startSSE();
  checkOnboarding();
}

function activateRouter(routeRoot = ensureRouteRoot()) {
  if (_routerReady || !routeRoot) return;
  _routerReady = true;
  initRouter(routeRoot, getSections());
}

let _sectionsCache = null;
function getSections() {
  if (_sectionsCache) return _sectionsCache;
  const systemSection = pageId => lazySection(
    () => import('./ui/features/system/index.js'),
    (module, element) => module.mountSystemPage(element, pageId)
  );
  _sectionsCache = {
    home: routeSection(element => mountHome(element, getStore())),
    tasks: lazySection(() => import('./ui/features/sessions/index.js'), (module, element) => module.mountTasks(element, getStore())),
    code: lazySection(() => import('./ui/features/code/index.js'), (module, element) => module.mountCode(element, getStore())),
    workspaces: lazySection(() => import('./ui/features/workspaces/index.js'), (module, element) => module.mountWorkspaces(element, getStore())),
    activity: lazySection(() => import('./ui/features/activity/index.js'), (module, element) => module.mountActivity(element, getStore())),
    settings: lazySection(() => import('./ui/features/settings/index.js'), (module, element) => module.mountSettings(element, settingsSubPage())),
    processes: systemSection('processes'),
    diagnostics: systemSection('diagnostics'),
    tools: systemSection('tools'),
    usage: systemSection('usage')
  };
  return _sectionsCache;
}

function routeSection(mount) {
  return async (element, context = {}) => {
    try {
      if (context.isCurrent?.() === false) return null;
      return await mount(element, context);
    } catch (error) {
      if (context.isCurrent?.() !== false) renderRouteFailure(element, error);
      debugError(error);
      return null;
    }
  };
}

function lazySection(loadModule, mount) {
  return routeSection(async (element, context) => {
    const module = await loadModule();
    if (context.isCurrent?.() === false) return null;
    return mount(module, element, context);
  });
}

function renderRouteFailure(element, error) {
  const message = error instanceof Error ? error.message : String(error || 'The page could not be loaded.');
  element.innerHTML = `<div class="dashboard-state" role="alert"><div class="dashboard-state-card"><span class="status-pill bad">Page unavailable</span><h2>This page could not load.</h2><p>${escapeHtml(message)}</p><div class="dashboard-state-actions"><button class="primary" type="button" data-route-retry>Retry page</button><a class="buttonlike secondary" href="#diagnostics">Open Troubleshooting</a></div></div></div>`;
  element.querySelector('[data-route-retry]')?.addEventListener('click', retryRouteFailure);
}

function retryRouteFailure() {
  const desktop = window.relaiDesktop;
  if (typeof desktop?.reloadDashboard === 'function') {
    void desktop.reloadDashboard(window.location.hash || '#home').catch(debugError);
    return;
  }
  window.location.reload();
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
  const projected = withConnectionState({ ...getStore(), desktopStatus: status }, _liveState);
  patchLocalConnection({ desktopStatus: status, connectionState: projected.connectionState });
  const data = getStore();
  updateShell(data);
  if (_routerReady) void syncLiveView(data);
}

async function doRefresh(options = {}) {
  if (_refreshPromise) return _refreshPromise;
  _refreshLiveEvents = [];
  _refreshLiveEventOverflow = false;
  _refreshPromise = performRefresh(options);
  try {
    return await _refreshPromise;
  } finally {
    const needsCatchUp = _refreshLiveEventOverflow;
    _refreshPromise = null;
    _refreshLiveEvents = null;
    _refreshLiveEventOverflow = false;
    if (needsCatchUp) queueMicrotask(() => { void doRefresh({ source: 'live-refresh-overflow', quietFailure: true }); });
  }
}

async function performRefresh(options = {}) {
  invalidateCache(DASHBOARD_DATA_URL);
  try {
    const data = await fetchJson(DASHBOARD_DATA_URL, { cache: 'no-store' });
    if (data && data.ok !== false) {
      const hydrated = withConnectionState(data, _liveState);
      initStore(hydrated);
      replayLiveEventsDuringRefresh();
      const projected = withConnectionState(getStore(), _liveState);
      patchLocalConnection({ connectionState: projected.connectionState });
      const refreshed = getStore();
      updateShell(refreshed);
      if (!_routerReady) activateRouter(ensureRouteRoot());
      else if (options.render === true) await renderViewIfChanged(refreshed, { force: true });
      else if (options.render !== false) await syncLiveView(refreshed);
      _lastEventAt = Date.now();
      clearRecoveryNotice({ announce: true });
      return refreshed;
    }
    return options.quietFailure === true ? data : renderRefreshFailure(data);
  } catch (error) {
    const failure = {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
    return options.quietFailure === true ? failure : renderRefreshFailure(failure);
  }
}

async function recoverDashboard(options = {}) {
  let latest = { ok: false, error: 'The dashboard could not connect to Rel.AI.' };
  for (let attempt = 0; attempt < AUTO_RECOVERY_DELAYS_MS.length; attempt += 1) {
    const delay = AUTO_RECOVERY_DELAYS_MS[attempt];
    if (delay) await wait(delay);
    latest = await doRefresh({ ...options, source: options.source || 'automatic-recovery', quietFailure: true });
    if (latest?.ok !== false) return latest;
    if (latest?.status === 401) break;
  }
  return renderRefreshFailure(latest);
}

function renderRefreshFailure(data = {}) {
  const message = data?.error || 'The dashboard could not connect to Rel.AI.';
  _shellStatus = { label: data?.status === 401 ? 'Authentication failed' : 'Disconnected', tone: 'bad' };
  renderConnectionStatus();
  const updated = document.getElementById('lastUpdated');
  if (updated) updated.textContent = message;
  const title = data?.status === 401 ? 'Dashboard authentication failed.' : 'Rel.AI is not responding.';
  if (!_routerReady) renderDashboardState('error', title, message, data);
  else showRecoveryNotice(title, message, data);
  return data;
}

function renderDashboardState(kind, title, description, data = {}) {
  const routeRoot = ensureRouteRoot();
  if (!routeRoot) return;
  if (kind === 'loading') {
    routeRoot.innerHTML = `<div class="dashboard-state" role="status" aria-live="polite" aria-busy="true"><div class="dashboard-state-card"><div class="loading-mark" aria-hidden="true"></div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p><div class="skeleton-grid" aria-hidden="true"><div class="skeleton-block"></div><div class="skeleton-block"></div><div class="skeleton-block"></div></div></div></div>`;
    return;
  }
  routeRoot.innerHTML = `<div class="dashboard-state" role="alert"><div class="dashboard-state-card"><span class="status-pill bad">Connection error</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p><div class="dashboard-state-actions" data-recovery-actions></div></div></div>`;
  mountRecoveryActions(routeRoot, data);
}

function showRecoveryNotice(title, description, data = {}) {
  const notice = recoveryNoticeElement();
  if (!notice) return;
  if (_recoveryNoticeTimer) window.clearTimeout(_recoveryNoticeTimer);
  _recoveryNoticeTimer = null;
  notice.hidden = false;
  notice.className = 'connection-notice bad';
  notice.setAttribute('role', 'alert');
  notice.innerHTML = `<strong>${escapeHtml(title)}</strong><div>${escapeHtml(description)}</div><div class="dashboard-state-actions" data-recovery-actions></div>`;
  mountRecoveryActions(notice, data);
}

function recoveryNoticeElement() {
  let notice = document.getElementById('dashboardRecoveryNotice');
  if (notice) return notice;
  const routeRoot = ensureRouteRoot();
  if (!routeRoot?.parentElement) return null;
  notice = document.createElement('section');
  notice.id = 'dashboardRecoveryNotice';
  notice.hidden = true;
  notice.setAttribute('aria-live', 'polite');
  routeRoot.parentElement.insertBefore(notice, routeRoot);
  return notice;
}

function clearRecoveryNotice(options = {}) {
  const notice = document.getElementById('dashboardRecoveryNotice');
  if (!notice || notice.hidden) return;
  if (_recoveryNoticeTimer) window.clearTimeout(_recoveryNoticeTimer);
  _recoveryNoticeTimer = null;
  if (options.announce === true) {
    notice.className = 'connection-notice';
    notice.setAttribute('role', 'status');
    notice.innerHTML = '<strong>Connection restored.</strong><div>Rel.AI is responding again.</div>';
    _recoveryNoticeTimer = window.setTimeout(() => {
      notice.hidden = true;
      _recoveryNoticeTimer = null;
    }, 3000);
    return;
  }
  notice.hidden = true;
}

function mountRecoveryActions(container, data = {}) {
  const actions = container.querySelector('[data-recovery-actions]');
  if (!actions) return;
  const recovery = recoveryAction(data);
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'primary';
  primary.textContent = recovery.label;
  primary.addEventListener('click', () => runDashboardRecovery(recovery, data, primary));
  actions.appendChild(primary);

  if (typeof window.relaiDesktop?.relaunchApp === 'function') {
    const restart = document.createElement('button');
    restart.type = 'button';
    restart.className = 'secondary';
    restart.textContent = 'Restart Rel.AI';
    restart.addEventListener('click', () => runAppRelaunch(restart));
    actions.appendChild(restart);
  }

  const diagnostics = document.createElement('a');
  diagnostics.className = 'buttonlike secondary';
  diagnostics.href = '#diagnostics';
  diagnostics.textContent = 'Open Troubleshooting';
  actions.appendChild(diagnostics);
}

function recoveryAction(data = {}) {
  if (data?.status === 401 && typeof window.relaiDesktop?.reloadDashboard === 'function') {
    return { kind: 'reload', label: 'Reload dashboard', busyLabel: 'Reloading dashboard…' };
  }
  if (typeof window.relaiDesktop?.restartConnection === 'function') {
    return { kind: 'restart', label: 'Retry connection', busyLabel: 'Retrying connection…' };
  }
  return { kind: 'retry', label: 'Retry connection', busyLabel: 'Retrying connection…' };
}

async function runDashboardRecovery(recovery, data, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = recovery.busyLabel;
  try {
    if (recovery.kind === 'reload') {
      await window.relaiDesktop.reloadDashboard(location.hash || '#home');
      return;
    }
    if (recovery.kind === 'restart') {
      const status = await window.relaiDesktop.restartConnection();
      if (status) applyDesktopStatus(status);
    }
    await recoverDashboard({ source: 'manual-recovery', render: true });
  } catch (error) {
    renderRefreshFailure({ ...data, ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

async function runAppRelaunch(button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Restarting Rel.AI…';
  try {
    await window.relaiDesktop.relaunchApp();
  } catch (error) {
    renderRefreshFailure({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function wait(milliseconds) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

function bufferLiveEventDuringRefresh(event) {
  if (!_refreshLiveEvents) return false;
  if (_refreshLiveEvents.length >= MAX_REFRESH_LIVE_EVENTS) {
    _refreshLiveEvents.shift();
    _refreshLiveEventOverflow = true;
  }
  _refreshLiveEvents.push(event);
  return true;
}

function replayLiveEventsDuringRefresh() {
  for (const event of _refreshLiveEvents || []) {
    if (!event?.type || !event.data || event.data.ok === false) continue;
    applyLiveEvent(event.type, event.data);
  }
}

async function liveOnEvent(event) {
  if (!event?.type || !event.data) return;
  if (event.type === 'dashboard.error') {
    debugError(new Error(event.data.error || 'A live dashboard update failed.'));
    await recoverDashboard({ source: 'live-event-recovery', render: true });
    return;
  }
  if (event.data.ok === false) return;
  bufferLiveEventDuringRefresh(event);
  window.dispatchEvent(new CustomEvent('relai:diagnostics-live', { detail: event }));
  const applied = applyLiveEvent(event.type, event.data);
  if (!applied.accepted) return;
  if (event.type === 'diagnostics.updated') return;
  const projected = withConnectionState(applied.state, _liveState);
  patchLocalConnection({ connectionState: projected.connectionState });
  const data = getStore();
  updateShell(data);
  if (!_routerReady) activateRouter();
  await syncLiveView(data);
}

async function syncLiveView(data) {
  let updated = false;
  try {
    updated = await updateLiveView(data);
  } catch (error) {
    debugError(error);
  }
  if (!updated) return false;
  _renderRevisionKey = viewRevisionKey(data);
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
    case 'code': {
      const module = await import('./ui/features/code/index.js');
      return module.updateCodeLiveState(root, data);
    }
    case 'workspaces': {
      const module = await import('./ui/features/workspaces/index.js');
      return module.updateWorkspacesLiveState(root, data);
    }
    case 'settings': {
      if (currentRoutePath() !== 'settings/connection') return false;
      const module = await import('./ui/features/settings/connector.js');
      return module.updateConnectorLiveState(root, data);
    }
    case 'processes':
    case 'diagnostics':
    case 'usage': {
      const module = await import('./ui/features/system/index.js');
      return module.updateSystemLiveState(root, currentSection(), data);
    }
    default:
      return false;
  }
}

function liveStateChange(detail) {
  const catchUpRequired = detail.state === 'live' && liveCatchUpRequired(getStore().live, detail);
  const reconnectProbeRequired = surface === 'desktop' && detail.state === 'reconnecting' && detail.recoveryProbe === true;
  _liveState = detail.state || 'connecting';
  if (detail.lastEventAt) _lastEventAt = detail.lastEventAt;
  const projected = withConnectionState(getStore(), _liveState);
  patchLocalConnection({ connectionState: projected.connectionState });
  const data = getStore();
  renderConnectionStatus();
  if (_routerReady && currentRoutePath() === 'settings/connection') void syncLiveView(data);
  if (reconnectProbeRequired) void doRefresh({ source: 'sse-reconnect-probe', quietFailure: true, render: false });
  if (catchUpRequired) void doRefresh({ source: 'sse-catch-up' });
}

function liveCatchUpRequired(localLive = {}, remote = {}) {
  const localStreamId = String(localLive?.streamId || '');
  const remoteStreamId = String(remote?.streamId || '');
  if (remoteStreamId && localStreamId !== remoteStreamId) return true;
  const localRevisions = localLive?.revisions || {};
  const remoteRevisions = remote?.revisions || {};
  return Object.entries(remoteRevisions).some(([domain, revision]) => (
    Number(revision || 0) > Number(localRevisions[domain] || 0)
  ));
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
      subtitle: `${taskCount} ${pluralLabel(taskCount, 'ChatGPT task')} running · ${callCount} ${pluralLabel(callCount, 'action')} in progress`,
      label: `${taskCount} running`,
      tone: 'working'
    };
  }
  if (task.state === 'settling') {
    return {
      subtitle: `${taskCount} ${pluralLabel(taskCount, 'task')} waiting for the next ChatGPT action`,
      label: `${taskCount} open`,
      tone: 'warn'
    };
  }
  return {
    subtitle: `${workspaceCount} ${pluralLabel(workspaceCount, 'project')} available to ChatGPT`,
    label: 'Available',
    tone: 'ok'
  };
}

function pluralLabel(count, singular) {
  return Number(count) === 1 ? singular : `${singular}s`;
}

function renderViewIfChanged(data, options = {}) {
  if (!_routerReady) return Promise.resolve(false);
  if (hasBlockingInteraction()) {
    _deferredViewRender = true;
    return Promise.resolve(false);
  }
  _deferredViewRender = false;
  const nextRevisionKey = viewRevisionKey(data);
  if (options.force !== true && nextRevisionKey === _renderRevisionKey) return Promise.resolve(false);
  _renderRevisionKey = nextRevisionKey;
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
          _renderRevisionKey = '';
          _deferredViewRender = true;
        }
      } catch (error) {
        _renderRevisionKey = '';
        debugError(error);
      }
      const waiters = _renderWaiters.splice(0);
      waiters.forEach(waiter => waiter(rendered));
    });
  });
}

function viewRevisionKey(data = {}) {
  const route = `${currentRoutePath()}?${getRouteParams().toString()}`;
  const revisions = data.live?.revisions || {};
  const structural = data.snapshot?.revision || '';
  const task = Number(revisions.task || 0);
  const connection = Number(revisions.connection || 0);
  const workspace = Number(revisions.workspace || 0);
  const process = Number(revisions.process || 0);
  switch (currentSection()) {
    case 'activity':
    case 'tasks':
    case 'code': return `${route}|t:${task}`;
    case 'workspaces': return `${route}|t:${task}|w:${workspace}`;
    case 'processes': return `${route}|p:${process}`;
    case 'settings': return currentRoutePath() === 'settings/connection' ? `${route}|c:${connection}` : `${route}|s:${structural}`;
    case 'tools':
    case 'reference':
    case 'diagnostics':
    case 'usage': return `${route}|s:${structural}`;
    default: return `${route}|t:${task}|c:${connection}|w:${workspace}|p:${process}|s:${structural}`;
  }
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
    _renderRevisionKey = '';
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
