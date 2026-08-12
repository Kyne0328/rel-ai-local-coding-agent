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

console.log('Dashboard bootstrap, renewal, invalidation, and reauthentication tests passed.');
