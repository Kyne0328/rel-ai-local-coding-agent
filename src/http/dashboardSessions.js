

import * as crypto from "node:crypto";

const BOOTSTRAP_TTL_MS = 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE_NAME = 'relai_dashboard_session';
const bootstraps = new Map();
const sessions = new Map();

function createDashboardBootstrap(staticToken) {
  prune();
  const code = crypto.randomBytes(24).toString('base64url');
  bootstraps.set(code, {
    tokenHash: hashToken(staticToken),
    expiresAt: Date.now() + BOOTSTRAP_TTL_MS
  });
  return code;
}

function consumeDashboardBootstrap(code, staticToken) {
  prune();
  const record = bootstraps.get(String(code || ''));
  bootstraps.delete(String(code || ''));
  if (!record || record.expiresAt < Date.now()) return '';
  if (!safeEqual(record.tokenHash, hashToken(staticToken))) return '';
  const sessionId = crypto.randomBytes(32).toString('base64url');
  sessions.set(sessionId, {
    tokenHash: record.tokenHash,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return sessionId;
}

function validateDashboardSession(req, staticToken) {
  prune();
  const sessionId = cookieValue(req?.headers?.cookie, COOKIE_NAME);
  if (!sessionId) return false;
  const record = sessions.get(sessionId);
  if (!record || record.expiresAt < Date.now()) return false;
  return safeEqual(record.tokenHash, hashToken(staticToken));
}

function setDashboardSessionCookie(res, sessionId) {
  if (!sessionId || res.headersSent) return;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}

function clearDashboardSessions() {
  bootstraps.clear();
  sessions.clear();
}

function cookieValue(header, name) {
  const target = `${name}=`;
  for (const part of String(header || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(target)) return value.slice(target.length);
  }
  return '';
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function prune() {
  const now = Date.now();
  for (const [key, value] of bootstraps) if (value.expiresAt < now) bootstraps.delete(key);
  for (const [key, value] of sessions) if (value.expiresAt < now) sessions.delete(key);
}

export {  createDashboardBootstrap, consumeDashboardBootstrap, validateDashboardSession, setDashboardSessionCookie, clearDashboardSessions };
