// Hash-based section router — one section visible at a time
let _sections = {};
let _current = null;
let _currentRouteKey = null;
let _container = null;
let _bound = false;

export function initRouter(container, sections) {
  _container = container;
  _sections = sections || {};

  if (!_bound) {
    window.addEventListener('hashchange', _route);
    _bound = true;
  }
  _route(); // initial mount
}

export function currentSection() {
  const hash = (location.hash || '#home').slice(1) || 'home';
  return hash.split('/')[0] || 'home';
}

function currentRouteKey() {
  return (location.hash || '#home').slice(1) || 'home';
}

export function navigate(sectionId) {
  location.hash = '#' + sectionId;
}

function _route() {
  const id = currentSection();
  const routeKey = currentRouteKey();
  if (routeKey === _currentRouteKey) return;
  _current = id;
  _currentRouteKey = routeKey;

  // Update nav active state
  document.querySelectorAll('.nav a, .mobile-nav a').forEach(a => {
    const href = a.getAttribute('href') || '';
    a.classList.toggle('active', href === '#' + id || (['settings', 'connector', 'diagnostics'].includes(id) && href === '#settings'));
  });

  // Mount section into route container only; persistent shell lives outside it.
  if (!_container) return;
  _container.innerHTML = '';
  const mount = _sections[id] || _sections.home;
  if (mount) mount(_container);
}
