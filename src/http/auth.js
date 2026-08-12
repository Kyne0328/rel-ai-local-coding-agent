import { isAuthorized, timingSafeEqual } from './io.js';
import * as dashboardSessions from './dashboardSessions.js';

function hasDashboardQueryToken(parsed, options) {
  if (!options.token) return false;
  const supplied = parsed.searchParams.get('token');
  return supplied != null && timingSafeEqual(String(supplied).trim(), String(options.token).trim());
}

function isDashboardAuthorized(req, parsed, options, res) {
  if (isAuthorized(req, options) || hasDashboardQueryToken(parsed, options)) return true;
  if (dashboardSessions.validateDashboardSession(req, options.token, res)) return true;
  const bootstrap = parsed.searchParams.get('bootstrap');
  if (!bootstrap) return false;
  const sessionId = dashboardSessions.consumeDashboardBootstrap(bootstrap, options.token);
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
