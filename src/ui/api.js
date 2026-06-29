// Consolidated fetch layer — replaces 4 divergent fetchJson helpers across client files
const TOKEN_KEY = 'relai_dashboard_token';

// Single source of truth for the aggregate dashboard payload URL. Used by the
// bootstrap, manual/live refresh, workspace mutations, and settings cache
// invalidation — keep them in sync via this constant, not copied literals.
export const DASHBOARD_DATA_URL = '/api/dashboard/v10?limit=100&requireHttpToken=0';
let _token = '';
const _cache = new Map();

export function setToken(t) {
  _token = String(t || '');
  if (_token) sessionStorage.setItem(TOKEN_KEY, _token);
}

export function getToken() {
  return _token || sessionStorage.getItem(TOKEN_KEY) || '';
}

// Full-page reload that preserves the dashboard token. The boot script strips
// ?token from the URL after reading it, so a bare location.reload() re-requests
// the token-gated /dashboard route with no credentials and gets a 401. Re-attach
// the token here (boot strips it from the URL again on the next load). The hash
// is preserved so the user stays on the current section.
export function reloadWithToken() {
  const t = getToken();
  const query = t ? '?token=' + encodeURIComponent(t) : '';
  location.assign('/dashboard' + query + (location.hash || ''));
}

export async function fetchJson(url, opts = {}) {
  // timeout (ms): overrides the 8s default; 0 or negative disables the abort timer
  // entirely. The native folder picker blocks on user input and must not be killed
  // mid-prompt, so it passes timeout: 0.
  const { timeout, ...fetchOpts } = opts;
  const isGet = !fetchOpts.method || fetchOpts.method === 'GET';
  const cacheKey = isGet ? url : null;

  if (cacheKey && _cache.has(cacheKey)) {
    const { ts, val } = _cache.get(cacheKey);
    if (Date.now() - ts < 1000) return val;
  }

  const timeoutMs = Number.isFinite(timeout) ? timeout : 8000;
  const ctrl = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;

  try {
    const token = getToken();
    const urlWithToken = token ? _addToken(url, token) : url;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(urlWithToken, {
      ...fetchOpts,
      signal: ctrl.signal,
      headers: { ...headers, ...(fetchOpts.headers || {}) },
    });

    let data;
    const text = await res.text();
    try { data = JSON.parse(text); } catch (_) { data = { ok: false, error: text, status: res.status }; }
    if (!res.ok && data.ok !== true) data.ok = false;
    if (res.status === 401) data.error = data.error || 'Unauthorized — check dashboard token.';

    if (cacheKey && res.ok) _cache.set(cacheKey, { ts: Date.now(), val: data });
    return data;
  } catch (err) {
    const isAbort = err && err.name === 'AbortError';
    return { ok: false, error: isAbort ? `Request timed out after ${Math.round(timeoutMs / 1000)} seconds.` : String(err) };
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

function _addToken(url, token) {
  try {
    const u = new URL(url, location.origin);
    if (u.origin === location.origin && !u.searchParams.has('token')) {
      u.searchParams.set('token', token);
    }
    return u.pathname + u.search + u.hash;
  } catch (_) {
    return url;
  }
}
