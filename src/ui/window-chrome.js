const SUPPORTED_PLATFORMS = new Set(['win32', 'darwin', 'linux', 'other']);

export async function initWindowChrome(desktop) {
  if (!desktop || typeof desktop.getWindowState !== 'function') {
    document.documentElement.dataset.windowChrome = 'native';
    return () => {};
  }

  const minimize = document.getElementById('windowMinimizeBtn');
  const maximize = document.getElementById('windowMaximizeBtn');
  const close = document.getElementById('windowCloseBtn');

  minimize?.addEventListener('click', () => runWindowAction(desktop.minimizeWindow));
  maximize?.addEventListener('click', () => runWindowAction(desktop.toggleMaximizeWindow));
  close?.addEventListener('click', () => runWindowAction(desktop.closeWindow));

  const removeListener = typeof desktop.onWindowState === 'function'
    ? desktop.onWindowState(applyWindowState)
    : () => {};
  applyWindowState(await desktop.getWindowState());
  return typeof removeListener === 'function' ? removeListener : () => {};
}

function applyWindowState(state = {}) {
  const root = document.documentElement;
  const platform = SUPPORTED_PLATFORMS.has(state.platform) ? state.platform : 'other';
  const custom = state.customTitleBar === true;
  root.dataset.platform = platform;
  root.dataset.windowChrome = custom ? 'custom' : 'native';
  root.dataset.windowMaximized = state.maximized === true ? 'true' : 'false';

  const controls = document.getElementById('windowTitlebarControls');
  if (controls) controls.hidden = !custom || state.controls !== 'custom';

  const maximize = document.getElementById('windowMaximizeBtn');
  if (!maximize) return;
  const maximized = state.maximized === true;
  const label = maximized ? 'Restore window' : 'Maximize window';
  maximize.setAttribute('aria-label', label);
  maximize.setAttribute('title', label);
  maximize.dataset.maximized = maximized ? 'true' : 'false';
  maximize.querySelector('[data-window-icon="maximize"]')?.toggleAttribute('hidden', maximized);
  maximize.querySelector('[data-window-icon="restore"]')?.toggleAttribute('hidden', !maximized);
}

function runWindowAction(action) {
  if (typeof action !== 'function') return;
  Promise.resolve(action()).then(state => {
    if (state && Object.hasOwn(state, 'customTitleBar')) applyWindowState(state);
  }).catch(debugError);
}

function debugError(error) {
  if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
}
