import * as dashboardSessions from './dashboardSessions.js';

function isDashboardAuthorized(req, parsed, options, res) {
  if (dashboardSessions.validateDashboardSession(req, options.token, res)) return true;
  if (parsed.pathname !== '/dashboard') return false;
  const bootstrap = parsed.searchParams.get('bootstrap');
  const queryToken = parsed.searchParams.get('token');
  const sessionId = bootstrap
    ? dashboardSessions.consumeDashboardBootstrap(bootstrap, options.token)
    : dashboardSessions.createDashboardSession(queryToken, options.token);
  if (!sessionId) return false;
  dashboardSessions.setDashboardSessionCookie(res, sessionId);
  return true;
}

function resolveRequireHttpToken(parsed, config) {
  const raw = parsed.searchParams.get('requireHttpToken');
  if (raw != null) return raw !== '0';
  return config?.release?.requireHttpToken !== false;
}

export { isDashboardAuthorized, resolveRequireHttpToken };
