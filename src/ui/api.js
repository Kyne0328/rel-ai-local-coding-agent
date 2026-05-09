// Consolidated fetch layer — replaces 4 divergent fetchJson helpers across client files
const TOKEN_KEY = 'relai_dashboard_token';
let _token = '';
const _cache = new Map();

export function setToken(t) {
  _token = String(t || '');
  if (_token) sessionStorage.setItem(TOKEN_KEY, _token);
}

export function getToken() {
  return _token || sessionStorage.getItem(TOKEN_KEY) || '';
}

export async function fetchJson(url, opts = {}) {
  const isGet = !opts.method || opts.method === 'GET';
  const cacheKey = isGet ? url : null;

  if (cacheKey && _cache.has(cacheKey)) {
    const { ts, val } = _cache.get(cacheKey);
    if (Date.now() - ts < 1000) return val;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);

  try {
    const token = getToken();
    const urlWithToken = token ? _addToken(url, token) : url;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(urlWithToken, {
      ...opts,
      signal: ctrl.signal,
      headers: { ...headers, ...(opts.headers || {}) },
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
    return { ok: false, error: isAbort ? 'Request timed out after 8 seconds.' : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function postJson(url, body) {
  return fetchJson(url, { method: 'POST', body: JSON.stringify(body) });
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
