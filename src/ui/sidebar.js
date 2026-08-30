const SIDEBAR_STORAGE_KEY = 'relai_sidebar_collapsed';

export function initSidebar() {
  const root = document.documentElement;
  const toggle = document.getElementById('sidebarToggle');
  const accordions = [...document.querySelectorAll('.sidebar-accordion')];
  if (!toggle) return;

  const syncToggle = () => {
    const collapsed = root.dataset.sidebar === 'collapsed';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  };

  toggle.addEventListener('click', () => {
    const collapsed = root.dataset.sidebar === 'collapsed';
    root.dataset.sidebar = collapsed ? 'expanded' : 'collapsed';
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '0' : '1'); } catch {}
    syncToggle();
  });

  accordions.forEach(accordion => accordion.addEventListener('toggle', () => {
    if (!accordion.open) return;
    accordions.forEach(other => {
      if (other !== accordion) other.open = false;
    });
  }));

  syncToggle();
}
