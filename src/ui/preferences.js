const THEME_KEY = 'relai_ui_theme';
const DENSITY_KEY = 'relai_ui_density';
const THEMES = new Set(['system', 'dark', 'light']);
const DENSITIES = new Set(['comfortable', 'compact']);

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

function normalizeDensity(value) {
  return DENSITIES.has(value) ? value : 'comfortable';
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

function applyDensity(density) {
  document.documentElement.dataset.density = normalizeDensity(density);
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
    theme: normalizeTheme(readStored(THEME_KEY, document.documentElement.dataset.themePreference || 'system')),
    density: normalizeDensity(readStored(DENSITY_KEY, document.documentElement.dataset.density || 'comfortable'))
  };
}

export function setThemePreference(theme) {
  const normalized = normalizeTheme(theme);
  writeStored(THEME_KEY, normalized);
  applyTheme(normalized);
  document.dispatchEvent(new CustomEvent('relai:appearance-change', { detail: getUiPreferences() }));
}

export function setDensityPreference(density) {
  const normalized = normalizeDensity(density);
  writeStored(DENSITY_KEY, normalized);
  applyDensity(normalized);
  document.dispatchEvent(new CustomEvent('relai:appearance-change', { detail: getUiPreferences() }));
}

function markPreferencesReady() {
  document.documentElement.dataset.preferencesReady = '';
}

export function initUiPreferences() {
  const preferences = getUiPreferences();
  applyTheme(preferences.theme);
  applyDensity(preferences.density);
  bindSystemTheme();
  window.requestAnimationFrame(markPreferencesReady);
  return preferences;
}
