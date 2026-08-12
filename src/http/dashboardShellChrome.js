

function renderDashboardShellBootstrap() {
  return `try {
  const themePreference = localStorage.getItem('relai_ui_theme') || 'system';
  const resolvedTheme = themePreference === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : themePreference;
  const launchParams = new URLSearchParams(location.search);
  const desktopSurface = launchParams.get('surface') === 'desktop';
  Object.assign(document.documentElement.dataset, {
    themePreference,
    theme: resolvedTheme,
    density: localStorage.getItem('relai_ui_density') || 'comfortable',
    sidebar: localStorage.getItem('relai_sidebar_collapsed') === '1' ? 'collapsed' : 'expanded',
    surface: desktopSurface ? 'desktop' : 'browser',
    windowChrome: desktopSurface && launchParams.get('chrome') === 'custom' ? 'custom' : 'native',
    platform: launchParams.get('platform') || 'other'
  });
} catch {}`;
}

function renderDashboardWindowTitlebar() {
  return `<header class="window-titlebar" id="windowTitlebar" aria-label="Application title bar">
  <div class="window-titlebar-identity" aria-hidden="true"><img src="/public/assets/relai-logo.png" alt=""><strong>Rel.AI MCP</strong><span id="windowContext">Overview</span></div>
  <div class="window-titlebar-drag" aria-hidden="true"></div>
  <div class="window-titlebar-controls" id="windowTitlebarControls" role="group" aria-label="Window controls">
    <button class="window-titlebar-button" id="windowMinimizeBtn" type="button" aria-label="Minimize window" title="Minimize window"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5h8" /></svg></button>
    <button class="window-titlebar-button" id="windowMaximizeBtn" type="button" aria-label="Maximize window" title="Maximize window"><svg data-window-icon="maximize" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx=".5" /></svg><svg data-window-icon="restore" viewBox="0 0 12 12" aria-hidden="true" hidden><path d="M4 2.5h5.5V8M2.5 4H8v5.5H2.5z" /></svg></button>
    <button class="window-titlebar-button window-titlebar-close" id="windowCloseBtn" type="button" aria-label="Close window" title="Close window"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 2.5 7 7m0-7-7 7" /></svg></button>
  </div>
</header>`;
}

export { renderDashboardShellBootstrap, renderDashboardWindowTitlebar };
