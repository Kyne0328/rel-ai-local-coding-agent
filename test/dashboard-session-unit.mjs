import assert from 'node:assert/strict';

import * as sessions from "../src/http/dashboardSessions.js";
import { isDashboardAuthorized } from "../src/http/auth.js";

sessions.clearDashboardSessions();
const bootstrap = sessions.createDashboardBootstrap('static-secret');
assert.ok(bootstrap.length > 20);
const bootstrapHeaders = {};
const bootstrapResponse = {
  headersSent: false,
  setHeader(name, value) { bootstrapHeaders[name] = value; }
};
const bootstrapParsed = new URL(`http://127.0.0.1/dashboard?bootstrap=${encodeURIComponent(bootstrap)}`);
assert.equal(isDashboardAuthorized({ headers: {} }, bootstrapParsed, { token: 'static-secret' }, bootstrapResponse), true);
assert.match(bootstrapHeaders['Set-Cookie'], /relai_dashboard_session=/);
const bootstrapCookie = bootstrapHeaders['Set-Cookie'].split(';')[0];
assert.equal(isDashboardAuthorized({ headers: { cookie: bootstrapCookie } }, new URL('http://127.0.0.1/api/dashboard/v10'), { token: 'static-secret' }, {}), true);
assert.equal(isDashboardAuthorized({ headers: {} }, bootstrapParsed, { token: 'static-secret' }, {}), false, 'bootstrap codes must be single-use');

const directBootstrap = sessions.createDashboardBootstrap('static-secret');
const sessionId = sessions.consumeDashboardBootstrap(directBootstrap, 'static-secret');
assert.ok(sessionId.length > 30);

const headers = {};
const response = {
  headersSent: false,
  setHeader(name, value) { headers[name] = value; }
};
sessions.setDashboardSessionCookie(response, sessionId);
assert.match(headers['Set-Cookie'], /relai_dashboard_session=/);
assert.match(headers['Set-Cookie'], /HttpOnly/);
assert.match(headers['Set-Cookie'], /SameSite=Strict/);

const cookie = headers['Set-Cookie'].split(';')[0];
assert.equal(sessions.validateDashboardSession({ headers: { cookie } }, 'static-secret'), true);
assert.equal(sessions.validateDashboardSession({ headers: { cookie } }, 'wrong-secret'), false);
sessions.clearDashboardSessions();
assert.equal(sessions.validateDashboardSession({ headers: { cookie } }, 'static-secret'), false);

console.log('Dashboard one-time session tests passed.');
