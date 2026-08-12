import { URL } from 'node:url';

function validateConnection(connection) {
  const target = new URL(String(connection?.url || ''));
  const loopback = target.hostname === '127.0.0.1' || target.hostname === 'localhost' || target.hostname === '[::1]';
  if (target.protocol !== 'http:' || !loopback || target.pathname !== '/dashboard') {
    throw new Error('Electron dashboard must use the local loopback /dashboard route.');
  }
  return target;
}

function normalizeRouteHash(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const hash = text.startsWith('#') ? text : `#${text}`;
  if (!/^#[A-Za-z0-9/_-]+$/.test(hash)) throw new Error('Invalid dashboard route.');
  return hash;
}

function safeUrl(value) {
  try { return new URL(value); } catch { return null; }
}

function safeOrigin(value) {
  return safeUrl(value)?.origin || '';
}

function planDashboardNavigation(current, target, options = {}) {
  const sameDashboard = Boolean(current && current.origin === target.origin && current.pathname === target.pathname);
  const authRefreshRequired = Boolean(
    sameDashboard
    && options.nextAuthGeneration
    && options.currentAuthGeneration
    && options.nextAuthGeneration !== options.currentAuthGeneration
  );
  if (authRefreshRequired && !options.requestedHash && current?.hash) target.hash = current.hash;
  return { sameDashboard, authRefreshRequired };
}

export { normalizeRouteHash, planDashboardNavigation, safeOrigin, safeUrl, validateConnection };
