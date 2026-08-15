// Consolidated fetch layer — replaces divergent fetchJson helpers across client files.
// Dashboard requests authenticate only with the HttpOnly session cookie established
// by the one-time /dashboard bootstrap. The MCP bearer token never enters renderer JS.

// Single source of truth for the aggregate dashboard payload URL. Used by the
// bootstrap, manual/live refresh, workspace mutations, and settings cache
// invalidation — keep them in sync via this constant, not copied literals.
export const DASHBOARD_DATA_URL = '/api/dashboard/v10?limit=100';
const _cache = new Map();


export function requestDashboardRefresh(options = {}) {
  invalidateCache();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('relai:dashboard-refresh', {
      detail: { structural: options.structural === true }
    }));
  }
}

function cacheKeyFor(url, fetchOpts) {
  const isGet = !fetchOpts.method || fetchOpts.method === 'GET';
  const bypassCache = fetchOpts.cache === 'no-store' || fetchOpts.cache === 'reload';
  return isGet && !bypassCache ? url : null;
}

function cachedValue(cacheKey) {
  if (!cacheKey || !_cache.has(cacheKey)) return null;
  const { ts, val } = _cache.get(cacheKey);
  return Date.now() - ts < 1000 ? val : null;
}

function timeoutFor(timeout) {
  return Number.isFinite(timeout) ? timeout : 8000;
}

function requestHeaders(fetchOpts) {
  const headers = { 'Content-Type': 'application/json' };
  if (fetchOpts.headers) Object.assign(headers, fetchOpts.headers);
  return headers;
}

async function parseJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
    return structuredRequestError(text || `Dashboard returned HTTP ${res.status}.`, res.status);
  }
}

function normalizeResponseData(res, data) {
  data.status = res.status;
  if (!res.ok && data.ok !== true) data.ok = false;
  if (res.status === 401) data.error = data.error || 'Dashboard authorization expired. Reopen the dashboard from the Rel.AI desktop app.';
  return data;
}

function structuredRequestError(message, status = 0) {
  return {
    ok: false,
    status,
    errorCode: 'dashboard_unavailable',
    title: 'Dashboard request failed',
    error: String(message || 'The Rel.AI dashboard did not respond.'),
    recovery: { message: 'Refresh the dashboard. Restart the connection service if the problem continues.', actionLabel: 'Open Connection', href: '#connection', retryable: true }
  };
}

function requestError(err, timeoutMs) {
  const isAbort = err?.name === 'AbortError';
  return structuredRequestError(isAbort ? `Request timed out after ${Math.round(timeoutMs / 1000)} seconds.` : String(err));
}

export async function fetchJson(url, opts = {}) {
  // timeout (ms): overrides the 8s default; 0 or negative disables the abort timer
  // entirely. The native folder picker blocks on user input and must not be killed
  // mid-prompt, so it passes timeout: 0.
  const { timeout, ...fetchOpts } = opts;
  const cacheKey = cacheKeyFor(url, fetchOpts);
  const cached = cachedValue(cacheKey);
  if (cached) return cached;

  const timeoutMs = timeoutFor(timeout);
  const ctrl = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      ...fetchOpts,
      credentials: 'same-origin',
      signal: ctrl.signal,
      headers: requestHeaders(fetchOpts)
    });
    const data = normalizeResponseData(res, await parseJsonResponse(res));
    if (cacheKey && res.ok) _cache.set(cacheKey, { ts: Date.now(), val: data });
    return data;
  } catch (err) {
    return requestError(err, timeoutMs);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function postJson(url, body, opts = {}) {
  return fetchJson(url, { method: 'POST', body: JSON.stringify(body), ...opts });
}

export function invalidateCache(url) {
  if (url) _cache.delete(url);
  else _cache.clear();
}
