const THEME_KEY = 'relai_ui_theme';
const THEMES = new Set(['system', 'dark', 'light']);

let mediaQuery = null;
let mediaListener = null;

function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences remain active for this page even when storage is unavailable.
  }
}

function normalizeTheme(value) {
  return THEMES.has(value) ? value : 'system';
}

function resolveTheme(theme) {
  if (theme !== 'system') return theme;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme) {
  const normalized = normalizeTheme(theme);
  document.documentElement.dataset.themePreference = normalized;
  document.documentElement.dataset.theme = resolveTheme(normalized);
}

function bindSystemTheme() {
  if (!window.matchMedia) return;
  if (mediaQuery && mediaListener) mediaQuery.removeEventListener?.('change', mediaListener);
  mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
  mediaListener = () => {
    if (document.documentElement.dataset.themePreference === 'system') applyTheme('system');
  };
  mediaQuery.addEventListener?.('change', mediaListener);
}

export function getUiPreferences() {
  return {
    theme: normalizeTheme(readStored(THEME_KEY, document.documentElement.dataset.themePreference || 'system'))
  };
}

export function setThemePreference(theme) {
  const normalized = normalizeTheme(theme);
  writeStored(THEME_KEY, normalized);
  applyTheme(normalized);
}

function markPreferencesReady() {
  document.documentElement.dataset.preferencesReady = '';
}

export function initUiPreferences() {
  const preferences = getUiPreferences();
  applyTheme(preferences.theme);
  bindSystemTheme();
  window.requestAnimationFrame(markPreferencesReady);
  return preferences;
}
