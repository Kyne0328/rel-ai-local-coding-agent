import assert from 'node:assert/strict';

import { isDashboardAuthorized } from '../src/http/auth.js';
import { clearDashboardSessions, createDashboardBootstrap } from '../src/http/dashboardSessions.js';

const token = 'dashboard-session-test-token';

function responseRecorder() {
  const headers = new Map();
  return {
    headersSent: false,
    headers,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); }
  };
}

function dashboardRequest(url, cookie = '') {
  return {
    req: { headers: cookie ? { cookie } : {} },
    parsed: new URL(url),
    options: { token }
  };
}

clearDashboardSessions();
try {
  const bootstrap = createDashboardBootstrap(token);
  const bootstrapResponse = responseRecorder();
  const first = dashboardRequest(`http://127.0.0.1:3333/dashboard?bootstrap=${bootstrap}`);
  assert.equal(isDashboardAuthorized(first.req, first.parsed, first.options, bootstrapResponse), true);

  const setCookie = String(bootstrapResponse.headers.get('set-cookie') || '');
  const cookie = setCookie.split(';')[0];
  assert.match(cookie, /^relai_dashboard_session=/);

  const bearerResponse = responseRecorder();
  const bearerOnly = dashboardRequest('http://127.0.0.1:3333/api/pick-folder');
  bearerOnly.req.headers.authorization = `Bearer ${token}`;
  assert.equal(isDashboardAuthorized(bearerOnly.req, bearerOnly.parsed, bearerOnly.options, bearerResponse), false, 'dashboard APIs must not accept the MCP bearer token from renderer requests');
  const queryTokenResponse = responseRecorder();
  const queryTokenOnly = dashboardRequest(`http://127.0.0.1:3333/api/pick-folder?token=${encodeURIComponent(token)}`);
  assert.equal(isDashboardAuthorized(queryTokenOnly.req, queryTokenOnly.parsed, queryTokenOnly.options, queryTokenResponse), false, 'dashboard APIs must not accept bearer credentials in URLs');

  const browserLaunchResponse = responseRecorder();
  const browserLaunch = dashboardRequest(`http://127.0.0.1:3333/dashboard?token=${encodeURIComponent(token)}`);
  assert.equal(isDashboardAuthorized(browserLaunch.req, browserLaunch.parsed, browserLaunch.options, browserLaunchResponse), true, 'standalone dashboard may exchange its launch token for a session cookie only on /dashboard');
  const browserCookie = String(browserLaunchResponse.headers.get('set-cookie') || '').split(';')[0];
  assert.match(browserCookie, /relai_dashboard_session=/);
  const browserApiResponse = responseRecorder();
  const browserApi = dashboardRequest('http://127.0.0.1:3333/api/dashboard/v10', browserCookie);
  assert.equal(isDashboardAuthorized(browserApi.req, browserApi.parsed, browserApi.options, browserApiResponse), true, 'standalone dashboard APIs must use the exchanged session cookie');

  const renewalResponse = responseRecorder();
  const protectedRequest = dashboardRequest('http://127.0.0.1:3333/api/pick-folder', cookie);
  assert.equal(isDashboardAuthorized(protectedRequest.req, protectedRequest.parsed, protectedRequest.options, renewalResponse), true);
  assert.match(String(renewalResponse.headers.get('set-cookie') || ''), /^relai_dashboard_session=/, 'active dashboard requests must renew the HttpOnly session cookie');

  clearDashboardSessions();
  const staleResponse = responseRecorder();
  assert.equal(isDashboardAuthorized(protectedRequest.req, protectedRequest.parsed, protectedRequest.options, staleResponse), false, 'a service restart must invalidate the old in-memory dashboard session');

  const refreshedBootstrap = createDashboardBootstrap(token);
  const refreshedResponse = responseRecorder();
  const refreshed = dashboardRequest(`http://127.0.0.1:3333/dashboard?bootstrap=${refreshedBootstrap}`);
  assert.equal(isDashboardAuthorized(refreshed.req, refreshed.parsed, refreshed.options, refreshedResponse), true);
  assert.notEqual(String(refreshedResponse.headers.get('set-cookie') || '').split(';')[0], cookie, 'fresh bootstrap must issue a new dashboard session after restart');
} finally {
  clearDashboardSessions();
}

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalLocation = globalThis.location;
let resolveReload;
const reloadCalls = [];
try {
  globalThis.location = { hash: '#activity' };
  globalThis.window = {
    localStorage: { getItem: () => null },
    relaiDesktop: {
      reloadDashboard(routeHash) {
        reloadCalls.push(routeHash);
        return new Promise(resolve => { resolveReload = resolve; });
      }
    }
  };
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ ok: false })
  });
  const api = await import(`../src/ui/api.js?dashboard-session-recovery=${Date.now()}`);
  const firstExpired = await api.fetchJson('/api/logs?limit=500', { cache: 'no-store' });
  const secondExpired = await api.fetchJson('/api/tools', { cache: 'no-store' });
  assert.equal(firstExpired.status, 401);
  assert.equal(secondExpired.status, 401);
  assert.equal(firstExpired.httpStatus, 401);
  assert.deepEqual(reloadCalls, ['#activity'], 'simultaneous dashboard 401 responses must trigger one desktop reauthentication reload');
  resolveReload?.({ ok: true });
  await Promise.resolve();

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, status: { available: true } })
  });
  const computerStatus = await api.fetchJson('/api/computer', { cache: 'no-store' });
  assert.deepEqual(computerStatus.status, { available: true }, 'dashboard payload status fields must not be replaced by the HTTP status code');
  assert.equal(computerStatus.httpStatus, 200);
} finally {
  if (originalFetch === undefined) delete globalThis.fetch; else globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
}

console.log('Dashboard bootstrap, renewal, invalidation, and reauthentication tests passed.');
