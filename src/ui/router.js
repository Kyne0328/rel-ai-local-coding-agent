// Hash-based section router — one section visible at a time
let _sections = {};
let _current = null;
let _container = null;

export function initRouter(container, sections) {
  _container = container;
  _sections = sections || {};

  window.addEventListener('hashchange', _route);
  _route(); // initial mount
}

export function currentSection() {
  const hash = (location.hash || '#home').slice(1) || 'home';
  return hash.split('/')[0] || 'home';
}

export function navigate(sectionId) {
  location.hash = '#' + sectionId;
}

function _route() {
  const id = currentSection();
  if (id === _current) return;
  _current = id;

  // Update nav active state
  document.querySelectorAll('.nav a, .mobile-nav a').forEach(a => {
    const href = a.getAttribute('href') || '';
    a.classList.toggle('active', href === '#' + id || href === '#' + id.replace(/^home$/, 'overview'));
  });

  // Mount section into container
  if (!_container) return;
  _container.innerHTML = '';
  const mount = _sections[id];
  if (mount) mount(_container);
}
