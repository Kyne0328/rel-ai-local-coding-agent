// Hash-based section router with persistent workspace scope.
import { confirmRouteChange, initInteractionSafety } from './interaction-safety.js';
import { normalizeRouteKey } from './route-policy.js';

let _sections = {};
let _currentRouteKey = null;
let _container = null;
let _bound = false;
let _mountGeneration = 0;

const ROUTE_TITLES = {
  home: 'Overview',
  tasks: 'Sessions',
  workspaces: 'Workspaces',
  processes: 'Processes',
  activity: 'Activity',
  tools: 'Tools',
  settings: 'Settings'
};
const SETTINGS_TITLES = {
  dashboard: 'Advanced',
  desktop: 'Connection',
  connection: 'Connection',
  connector: 'Connection',
  'tools-validation': 'Tools & validation',
  diagnostics: 'Diagnostics',
  advanced: 'Advanced',
  about: 'About'
};
const ROUTE_DESCRIPTIONS = {
  home: 'Connection health, workspace readiness, and recent Rel.AI sessions.',
  tasks: 'Review active and completed repository work sessions, validation state, and recorded activity.',
  workspaces: 'Manage the repositories that ChatGPT is allowed to inspect and update.',
  processes: 'Inspect managed operating-system processes, relationships, bounded output, and independent lifecycle state.',
  activity: 'Inspect individual Rel.AI tool calls, failures, and recorded output.',
  tools: 'Browse the MCP tools available to ChatGPT and their parameters.',
  settings: 'Configure the desktop app, connection, validation, and diagnostics.'
};
const SETTINGS_DESCRIPTIONS = {
  general: 'Control dashboard behavior and product preferences.',
  connection: 'Manage the local service, public endpoint, ChatGPT authorization, and live dashboard connection.',
  'tools-validation': 'Choose tool behavior and configure validation commands.',
  diagnostics: 'Review findings, runtime logs, and recovery controls.',
  advanced: 'Manage advanced desktop and state settings.',
  about: 'View Rel.AI MCP version, developer, repository, and license information.'
};

export function initRouter(container, sections) {
  initInteractionSafety();
  _container = container;
  _sections = sections || {};
  if (!_bound) {
    window.addEventListener('hashchange', _route);
    _bound = true;
  }
  _route();
}

export function currentSection() {
  return routeParts().path.split('/')[0] || 'home';
}

export function currentRoutePath() {
  return routeParts().path;
}

export function getRouteParams() {
  return routeParts().params;
}

export function getWorkspaceFilter() {
  return getRouteParams().get('workspace') || '';
}

export function routeHref(sectionId, params = {}) {
  const query = new URLSearchParams();
  const workspace = Object.hasOwn(params, 'workspace') ? params.workspace : getWorkspaceFilter();
  if (workspace) query.set('workspace', workspace);
  for (const [key, value] of Object.entries(params)) {
    if (key === 'workspace' || value == null || value === '') continue;
    query.set(key, String(value));
  }
  return `#${normalizeRouteKey(`${sectionId}${querySuffix(query)}`)}`;
}

export function setWorkspaceFilter(workspace) {
  const parts = routeParts();
  if (workspace) parts.params.set('workspace', workspace);
  else parts.params.delete('workspace');
  parts.params.delete('focus');
  location.hash = `#${normalizeRouteKey(`${parts.path}${querySuffix(parts.params)}`)}`;
}

export function replaceRouteParams(patch = {}) {
  const parts = routeParts();
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') parts.params.delete(key);
    else parts.params.set(key, String(value));
  }
  const routeKey = normalizeRouteKey(`${parts.path}${querySuffix(parts.params)}`);
  replaceRouteState(routeKey);
  return routeParts().params;
}

export function navigate(sectionId, params = {}) {
  location.hash = routeHref(sectionId, params);
}

export function rerender(options = {}) {
  return _mount(currentSection(), { preserveView: options.preserveView !== false });
}

function querySuffix(params) {
  const value = params.toString();
  return value ? `?${value}` : '';
}

function routeParts() {
  const raw = currentRouteKey();
  const separator = raw.indexOf('?');
  const path = separator >= 0 ? raw.slice(0, separator) : raw;
  const query = separator >= 0 ? raw.slice(separator + 1) : '';
  return { path: path || 'home', params: new URLSearchParams(query) };
}

function rawRouteKey() {
  return (location.hash || '#home').slice(1) || 'home';
}

function currentRouteKey() {
  return normalizeRouteKey(rawRouteKey());
}

function replaceRouteState(routeKey) {
  history.replaceState(null, '', `${location.pathname}${location.search}#${routeKey}`);
  try { localStorage.setItem('relai_dashboard_route', routeKey); } catch {}
}

function _route() {
  const rawKey = rawRouteKey();
  const routeKey = normalizeRouteKey(rawKey);
  if (routeKey !== rawKey) replaceRouteState(routeKey);
  if (routeKey === _currentRouteKey) return;
  if (_currentRouteKey && !confirmRouteChange()) {
    replaceRouteState(_currentRouteKey);
    return;
  }
  const id = routeKey.split(/[/?]/)[0] || 'home';
  _currentRouteKey = routeKey;
  try { localStorage.setItem('relai_dashboard_route', routeKey); } catch {}
  _updatePageIdentity(id);
  _updateNavActive(id);
  _mount(id);
  window.dispatchEvent(new CustomEvent('relai:route-change', { detail: { section: id, params: getRouteParams() } }));
}

function _updateNavActive(id) {
  document.querySelectorAll('.nav a, .mobile-nav a, .secondary-nav a').forEach(anchor => {
    const href = anchor.getAttribute('href') || '';
    const target = href.replace(/^#/, '').split(/[/?]/)[0];
    const active = target === id || (['settings', 'connector', 'connection', 'diagnostics'].includes(id) && target === 'settings');
    anchor.classList.toggle('active', active);
    if (active) anchor.setAttribute('aria-current', 'page');
    else anchor.removeAttribute('aria-current');
  });
}

function _updatePageIdentity(id) {
  const title = pageTitleFor(id);
  const heading = document.getElementById('pageTitle');
  if (heading) {
    heading.textContent = title;
    heading.tabIndex = -1;
  }
  const subtitle = document.getElementById('subtitle');
  if (subtitle) subtitle.textContent = pageDescriptionFor(id);
  const windowContext = document.getElementById('windowContext');
  if (windowContext) windowContext.textContent = title;
  const announcer = document.getElementById('routeAnnouncer');
  if (announcer) announcer.textContent = `${title} page loaded.`;
  document.title = `${title} · Rel.AI MCP`;
}

function pageTitleFor(id) {
  if (id === 'connector' || id === 'connection') return 'Settings · Connection';
  if (id === 'diagnostics') return 'Settings · Diagnostics';
  if (id !== 'settings') return ROUTE_TITLES[id] || ROUTE_TITLES.home;
  const subPage = currentRoutePath().split('/')[1] || 'general';
  const subTitle = SETTINGS_TITLES[subPage];
  return subTitle ? `Settings · ${subTitle}` : 'Settings';
}

function pageDescriptionFor(id) {
  if (id === 'connector' || id === 'connection') return SETTINGS_DESCRIPTIONS.connection;
  if (id === 'diagnostics') return SETTINGS_DESCRIPTIONS.diagnostics;
  if (id !== 'settings') return ROUTE_DESCRIPTIONS[id] || ROUTE_DESCRIPTIONS.home;
  const subPage = currentRoutePath().split('/')[1] || 'general';
  return SETTINGS_DESCRIPTIONS[subPage] || ROUTE_DESCRIPTIONS.settings;
}

function _mount(id, options = {}) {
  if (!_container) return;
  const generation = ++_mountGeneration;
  const view = options.preserveView ? captureViewState() : null;
  if (view) _container.style.minHeight = `${Math.ceil(_container.getBoundingClientRect().height)}px`;
  _container.setAttribute('aria-busy', 'true');
  // Keep the current route visible while a lazy feature module resolves. Each
  // feature owns its synchronous DOM replacement once its mount function starts.
  const mount = _sections[id] || _sections.home;
  let result;
  try {
    result = mount ? mount(_container) : null;
  } catch (error) {
    finishMount(generation, view);
    throw error;
  }
  return Promise.resolve(result).finally(() => finishMount(generation, view));
}

function captureViewState() {
  const active = document.activeElement;
  const scroller = pageScroller();
  return {
    routeKey: currentRouteKey(),
    scrollX: scroller === window ? window.scrollX : scroller.scrollLeft,
    scrollY: scroller === window ? window.scrollY : scroller.scrollTop,
    activeId: active instanceof HTMLElement ? active.id : ''
  };
}

function pageScroller() {
  const main = document.getElementById('main');
  return document.documentElement.dataset.windowChrome === 'custom' && main ? main : window;
}

function finishMount(generation, view) {
  if (generation !== _mountGeneration || !_container) return;
  if (!view) {
    _container.style.minHeight = '';
    _container.removeAttribute('aria-busy');
    announceRouteMounted();
    return;
  }
  requestAnimationFrame(() => {
    if (generation !== _mountGeneration || currentRouteKey() !== view.routeKey) return;
    pageScroller().scrollTo(view.scrollX, view.scrollY);
    if (view.activeId) document.getElementById(view.activeId)?.focus({ preventScroll: true });
    _container.style.minHeight = '';
    _container.removeAttribute('aria-busy');
    announceRouteMounted();
  });
}

function announceRouteMounted() {
  window.dispatchEvent(new CustomEvent('relai:route-mounted', {
    detail: { section: currentSection(), path: currentRoutePath(), params: getRouteParams() }
  }));
}
