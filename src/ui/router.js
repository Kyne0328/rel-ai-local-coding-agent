// Hash-based section router — Phase 1: no-op shell, activated in Phase 2
let _sections = {};

export function initRouter(sections) {
  _sections = sections || {};
  // Phase 2 wires hashchange; Phase 1 all sections render at boot
}

export function currentSection() {
  return (location.hash || '#home').slice(1) || 'home';
}
