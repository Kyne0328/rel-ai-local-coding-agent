import { setToken, getToken, fetchJson } from '/ui/api.js';
import { init as initStore, get as getStore } from '/ui/store.js';
import { initRouter, currentSection } from '/ui/router.js';
import { initEvents, startSSE, stopSSE, isLive } from '/ui/events.js';
import { mountHome } from '/ui/sections/home.js';
import { mountActivity } from '/ui/sections/activity.js';
import { mountApprovals } from '/ui/sections/approvals.js';
import { mountSettings } from '/ui/sections/settings/index.js';
import { mountWorkspaces } from '/ui/sections/workspaces.js';
import { mountAgents } from '/ui/sections/agents.js';

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
    workspaces:  (el) => mountWorkspaces(el, getStore()),
    activity:    (el) => mountActivity(el),
    approvals:   (el) => mountApprovals(el),
    tools:       (el) => { import('/ui/sections/tools.js').then(m => m.mountTools(el)); },
    agents:      (el) => mountAgents(el, getStore()),
    settings:    (el) => mountSettings(el),
    connector:   (el) => mountSettings(el),
    diagnostics: (el) => mountSettings(el),
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
  _checkOnboarding();
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
    const fns = { home: mountHome, overview: mountHome, workspaces: mountWorkspaces, activity: mountActivity, approvals: mountApprovals, tools: (el) => import('/ui/sections/tools.js').then(m => m.mountTools(el)), agents: mountAgents, settings: mountSettings };
    const fn = fns[id];
    if (main && fn) { main.innerHTML = ''; fn(main, getStore()); }
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
      if (main && id === 'activity') mountActivity(main);
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
