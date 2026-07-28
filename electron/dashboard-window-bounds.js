

const DASHBOARD_WINDOW_STATE_VERSION = 2;
const DASHBOARD_WINDOW_LIMITS = Object.freeze({
  minWidth: 900,
  minHeight: 600,
  defaultMinWidth: 1000,
  defaultMinHeight: 600,
  defaultMaxWidth: 1180,
  defaultMaxHeight: 760,
  defaultWorkAreaRatio: 0.8,
  edgeInset: 16
});
const FALLBACK_WORK_AREA = Object.freeze({ x: 0, y: 0, width: 1440, height: 900 });

function defaultDashboardBounds(screenApi) {
  return constrainBounds({}, screenApi, true);
}

function restoreDashboardBounds(value, screenApi) {
  if (!value || Number(value.version) !== DASHBOARD_WINDOW_STATE_VERSION) {
    return defaultDashboardBounds(screenApi);
  }
  return constrainBounds(value, screenApi, false);
}

function dashboardWindowState(win, screenApi) {
  return {
    version: DASHBOARD_WINDOW_STATE_VERSION,
    ...constrainBounds(readNormalBounds(win), screenApi, false)
  };
}

function readNormalBounds(win) {
  if (!win) return {};
  try {
    if (typeof win.getNormalBounds === 'function') return win.getNormalBounds();
  } catch { /* fall back to current bounds */ }
  return typeof win.getBounds === 'function' ? win.getBounds() : {};
}

function constrainBounds(raw, screenApi, useDefaultSize) {
  const area = resolveWorkArea(screenApi, raw);
  const inset = Math.min(DASHBOARD_WINDOW_LIMITS.edgeInset, Math.floor(Math.min(area.width, area.height) / 4));
  const availableWidth = Math.max(1, area.width - (inset * 2));
  const availableHeight = Math.max(1, area.height - (inset * 2));
  const minWidth = Math.min(useDefaultSize ? DASHBOARD_WINDOW_LIMITS.defaultMinWidth : DASHBOARD_WINDOW_LIMITS.minWidth, availableWidth);
  const minHeight = Math.min(useDefaultSize ? DASHBOARD_WINDOW_LIMITS.defaultMinHeight : DASHBOARD_WINDOW_LIMITS.minHeight, availableHeight);
  const maxWidth = useDefaultSize ? Math.min(DASHBOARD_WINDOW_LIMITS.defaultMaxWidth, availableWidth) : availableWidth;
  const maxHeight = useDefaultSize ? Math.min(DASHBOARD_WINDOW_LIMITS.defaultMaxHeight, availableHeight) : availableHeight;
  const requestedWidth = useDefaultSize ? area.width * DASHBOARD_WINDOW_LIMITS.defaultWorkAreaRatio : Number(raw.width);
  const requestedHeight = useDefaultSize ? area.height * DASHBOARD_WINDOW_LIMITS.defaultWorkAreaRatio : Number(raw.height);
  const width = clampDimension(requestedWidth, minWidth, maxWidth);
  const height = clampDimension(requestedHeight, minHeight, maxHeight);
  const centeredX = area.x + Math.floor((area.width - width) / 2);
  const centeredY = area.y + Math.floor((area.height - height) / 2);
  const x = useDefaultSize ? centeredX : clampPosition(Number(raw.x), area.x + inset, area.x + area.width - width - inset, centeredX);
  const y = useDefaultSize ? centeredY : clampPosition(Number(raw.y), area.y + inset, area.y + area.height - height - inset, centeredY);
  return { x, y, width, height };
}

function resolveWorkArea(screenApi, bounds) {
  let display = null;
  try {
    if (screenApi && typeof screenApi.getDisplayMatching === 'function' && hasPosition(bounds)) {
      display = screenApi.getDisplayMatching(bounds);
    }
    if (!display && screenApi && typeof screenApi.getPrimaryDisplay === 'function') display = screenApi.getPrimaryDisplay();
  } catch { /* use fallback work area */ }
  const area = display?.workArea;
  if (area && positive(area.width) && positive(area.height)) {
    return { x: finite(area.x, 0), y: finite(area.y, 0), width: Number(area.width), height: Number(area.height) };
  }
  const size = display?.workAreaSize;
  if (size && positive(size.width) && positive(size.height)) {
    return { x: 0, y: 0, width: Number(size.width), height: Number(size.height) };
  }
  return { ...FALLBACK_WORK_AREA };
}

function clampDimension(value, min, max) {
  const resolved = Number.isFinite(value) && value > 0 ? Math.round(value) : min;
  return Math.max(min, Math.min(resolved, max));
}

function clampPosition(value, min, max, fallback) {
  if (max < min) return fallback;
  return Math.max(min, Math.min(Number.isFinite(value) ? Math.round(value) : fallback, max));
}

function hasPosition(value) {
  return Number.isFinite(Number(value?.x)) && Number.isFinite(Number(value?.y));
}

function positive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export { DASHBOARD_WINDOW_LIMITS, DASHBOARD_WINDOW_STATE_VERSION, dashboardWindowState, defaultDashboardBounds, restoreDashboardBounds };
