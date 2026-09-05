const SIDEBAR_STORAGE_KEY = 'relai_sidebar_collapsed';

export function initSidebar() {
  const root = document.documentElement;
  const toggle = document.getElementById('sidebarToggle');
  const accordions = [...document.querySelectorAll('.sidebar-accordion')];
  const mobileMore = document.querySelector('.mobile-nav-more');

  mobileMore?.addEventListener('click', event => {
    if (event.target.closest('a')) mobileMore.open = false;
  });
  mobileMore?.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !mobileMore.open) return;
    event.preventDefault();
    mobileMore.open = false;
    mobileMore.querySelector(':scope > summary')?.focus();
  });
  document.addEventListener('pointerdown', event => {
    if (mobileMore?.open && !mobileMore.contains(event.target)) mobileMore.open = false;
  });

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
