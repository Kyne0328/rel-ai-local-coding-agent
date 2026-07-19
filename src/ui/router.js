// Hash-based section router with persistent workspace scope.
let _sections = {};
let _currentRouteKey = null;
let _container = null;
let _bound = false;
let _mountGeneration = 0;

export function initRouter(container, sections) {
  _container = container;
  _sections = sections || {};
  if (!_bound) {
    window.addEventListener('hashchange', _route);
    _bound = true;
  }
  _route();
}

export function currentSection() {
  const section = routeParts().path.split('/')[0] || 'home';
  return section === 'tools' ? 'reference' : section;
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
  return `#${sectionId}${querySuffix(query)}`;
}

export function setWorkspaceFilter(workspace) {
  const parts = routeParts();
  if (workspace) parts.params.set('workspace', workspace);
  else parts.params.delete('workspace');
  location.hash = `#${parts.path}${querySuffix(parts.params)}`;
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
  const raw = (location.hash || '#home').slice(1) || 'home';
  const separator = raw.indexOf('?');
  const path = separator >= 0 ? raw.slice(0, separator) : raw;
  const query = separator >= 0 ? raw.slice(separator + 1) : '';
  return { path: path || 'home', params: new URLSearchParams(query) };
}

function currentRouteKey() {
  return (location.hash || '#home').slice(1) || 'home';
}

function _route() {
  const id = currentSection();
  const routeKey = currentRouteKey();
  if (routeKey === _currentRouteKey) return;
  _currentRouteKey = routeKey;
  try { localStorage.setItem('relai_dashboard_route', routeKey); } catch {}
  _updateNavActive(id);
  _mount(id);
  window.dispatchEvent(new CustomEvent('relai:route-change', { detail: { section: id, params: getRouteParams() } }));
}

function _updateNavActive(id) {
  document.querySelectorAll('.nav a, .mobile-nav a, .secondary-nav a').forEach(anchor => {
    const href = anchor.getAttribute('href') || '';
    const target = href.replace(/^#/, '').split(/[/?]/)[0];
    const active = target === id || (['settings', 'connector', 'diagnostics'].includes(id) && target === 'settings');
    anchor.classList.toggle('active', active);
  });
}

function _mount(id, options = {}) {
  if (!_container) return;
  const generation = ++_mountGeneration;
  const view = options.preserveView ? captureViewState() : null;
  if (view) _container.style.minHeight = `${Math.ceil(_container.getBoundingClientRect().height)}px`;
  _container.innerHTML = '';
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
  return {
    routeKey: currentRouteKey(),
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    activeId: active instanceof HTMLElement ? active.id : ''
  };
}

function finishMount(generation, view) {
  if (generation !== _mountGeneration || !_container) return;
  if (!view) {
    _container.style.minHeight = '';
    return;
  }
  requestAnimationFrame(() => {
    if (generation !== _mountGeneration || currentRouteKey() !== view.routeKey) return;
    window.scrollTo(view.scrollX, view.scrollY);
    if (view.activeId) document.getElementById(view.activeId)?.focus({ preventScroll: true });
    _container.style.minHeight = '';
  });
}
