import { setToken, getToken, fetchJson } from '/ui/api.js';
import { init as initStore, get as getStore } from '/ui/store.js';
import { initRouter, currentSection } from '/ui/router.js';
import { initEvents, startSSE, stopSSE, isLive, setPollCallback } from '/ui/events.js';
import { mountHome } from '/ui/sections/home.js';
import { initCommandPalette, registerActions } from '/ui/components/command-palette.js';

// Restore saved theme
const savedTheme = localStorage.getItem('relai_theme');
if (savedTheme === 'light') document.documentElement.dataset.theme = 'light';

// Token bootstrap
const urlToken = new URLSearchParams(location.search).get('token') || '';
const token = urlToken || sessionStorage.getItem('relai_dashboard_token') || '';
if (token) setToken(token);

function readInitialPayload() {
  try { const el = document.getElementById('initialDashboardData'); return el && el.textContent ? JSON.parse(el.textContent) : null; } catch (_) { return null; }
}

async function boot() {
  const initial = readInitialPayload();
  initStore(initial || {});

  const main = document.getElementById('main');
  if (!main) return;

  const sections = {
    home:        (el) => mountHome(el, getStore()),
    overview:    (el) => mountHome(el, getStore()),
    workspaces:  (el) => import('/ui/sections/workspaces.js').then(m => m.mountWorkspaces(el, getStore())).catch(console.error),
    activity:    (el) => import('/ui/sections/activity.js').then(m => m.mountActivity(el)).catch(console.error),
    approvals:   (el) => import('/ui/sections/approvals.js').then(m => m.mountApprovals(el)).catch(console.error),
    tools:       (el) => import('/ui/sections/tools.js').then(m => m.mountTools(el)).catch(console.error),
    agents:      (el) => import('/ui/sections/agents.js').then(m => m.mountAgents(el, getStore())).catch(console.error),
    settings:    (el) => import('/ui/sections/settings/index.js').then(m => m.mountSettings(el)).catch(console.error),
    connector:   (el) => import('/ui/sections/settings/index.js').then(m => m.mountSettings(el)).catch(console.error),
    diagnostics: (el) => import('/ui/sections/settings/index.js').then(m => m.mountSettings(el)).catch(console.error),
  };

  _buildNav();
  initRouter(main, sections);

  const fresh = await fetchJson('/api/dashboard/v10?limit=100&requireHttpToken=0');
  if (fresh) {
    initStore(fresh);
    const id = currentSection();
    if (sections[id]) { main.innerHTML = ''; sections[id](main); }
  }

  _wireTopControls();
  setPollCallback(_doRefresh);
  _checkOnboarding();

  // Init command palette
  const storeData = getStore();
  const navActions = [
    { label: 'Home', href: '#home', category: 'Navigation' },
    { label: 'Workspaces', href: '#workspaces', category: 'Navigation' },
    { label: 'Activity', href: '#activity', category: 'Navigation' },
    { label: 'Approvals', href: '#approvals', category: 'Navigation' },
    { label: 'Tools', href: '#tools', category: 'Navigation' },
    { label: 'Agents', href: '#agents', category: 'Navigation' },
    { label: 'Settings', href: '#settings', category: 'Navigation' },
    { label: 'Settings → Connector', href: '#settings/connector', category: 'Navigation' },
    { label: 'Settings → Diagnostics', href: '#settings/diagnostics', category: 'Navigation' },
  ];
  const actionActions = [
    { label: 'Refresh dashboard', category: 'Actions', action: _doRefresh },
    { label: 'Toggle live mode', category: 'Actions', action: _toggleLive },
    { label: 'Copy dashboard token', category: 'Actions', action: () => { if (token) navigator.clipboard.writeText(token).catch(() => {}); } },
  ];
  const wsActions = Array.isArray(storeData.config && storeData.config.workspaces ? storeData.config.workspaces : []).map(ws => ({
    label: 'Switch to workspace: ' + ws.alias, category: 'Workspaces',
    action: () => { const el = document.getElementById('workspace'); if (el) el.value = ws.alias; }
  }));
  initCommandPalette([...navActions, ...actionActions, ...wsActions]);

  // Lazy-register tool actions after tools fetch
  fetchJson('/api/tools').then(tools => {
    if (Array.isArray(tools)) {
      registerActions(tools.map(t => ({ label: 'View tool: ' + t.name, category: 'Tools', href: '#tools' })));
    }
  }).catch(() => {});
}

function _buildNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  nav.innerHTML = `
    <a href="#home">Home</a>
    <a href="#workspaces">Workspaces</a>
    <a href="#activity">Activity</a>
    <a href="#approvals">Approvals</a>
    <a href="#tools">Tools</a>
    <a href="#agents">Agents</a>
    <a href="#settings">Settings</a>
  `;
  const mobileNav = document.querySelector('.mobile-nav');
  if (mobileNav) mobileNav.innerHTML = nav.innerHTML;
}

function _wireTopControls() {
  const tokenInput = document.getElementById('token');
  if (tokenInput) {
    if (getToken()) tokenInput.value = getToken();
    tokenInput.addEventListener('input', () => setToken(tokenInput.value.trim()));
  }
  const liveBtn = document.getElementById('liveBtn');
  if (liveBtn) liveBtn.onclick = _toggleLive;
  // Hide raw panel button (Phase 3: moved to Cmd-K)
  const rawBtn = document.getElementById('rawToggleBtn');
  if (rawBtn) rawBtn.style.display = 'none';
}

async function _doRefresh() {
  const data = await fetchJson('/api/dashboard/v10?limit=100&requireHttpToken=0');
  if (data) {
    initStore(data);
    const main = document.getElementById('main');
    const id = currentSection();
    const sectionFns = {
      home:        (el) => mountHome(el, getStore()),
      overview:    (el) => mountHome(el, getStore()),
      workspaces:  (el) => import('/ui/sections/workspaces.js').then(m => m.mountWorkspaces(el, getStore())).catch(console.error),
      activity:    (el) => import('/ui/sections/activity.js').then(m => m.mountActivity(el)).catch(console.error),
      approvals:   (el) => import('/ui/sections/approvals.js').then(m => m.mountApprovals(el)).catch(console.error),
      tools:       (el) => import('/ui/sections/tools.js').then(m => m.mountTools(el)).catch(console.error),
      agents:      (el) => import('/ui/sections/agents.js').then(m => m.mountAgents(el, getStore())).catch(console.error),
      settings:    (el) => import('/ui/sections/settings/index.js').then(m => m.mountSettings(el)).catch(console.error),
    };
    const fn = sectionFns[id];
    if (main && fn) { main.innerHTML = ''; fn(main); }
  }
}

function _toggleLive() {
  const btn = document.getElementById('liveBtn');
  if (isLive()) {
    stopSSE();
    if (btn) btn.textContent = 'Start live';
  } else {
    initEvents(async (data) => {
      initStore(data);
      const main = document.getElementById('main');
      const id = currentSection();
      if (main && id === 'home') mountHome(main, getStore());
      if (main && id === 'activity') import('/ui/sections/activity.js').then(m => m.mountActivity(main)).catch(console.error);
    });
    startSSE(getToken);
    if (btn) btn.textContent = 'Stop live';
  }
}

async function _checkOnboarding() {
  try {
    const status = await fetchJson('/api/onboarding/status');
    if (status && status.needsOnboarding) {
      const { openOnboarding } = await import('/ui/sections/onboarding.js');
      openOnboarding();
    }
  } catch (_) { /* degrade gracefully */ }
}

boot();
