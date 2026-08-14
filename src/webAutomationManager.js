import * as crypto from 'node:crypto';
import { chromium } from 'playwright-core';
import { resolveChromiumRuntime as discoverChromiumRuntime } from './chromiumRuntime.js';
import { taskError } from './toolActivity.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const MAX_ACTIVE_SESSIONS = 8;
const MAX_LOG_ENTRIES = 300;
const MAX_SNAPSHOT_CHARS = 64 * 1024;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const UI_SESSION_ID = /^ui_[A-Za-z0-9_-]{20,160}$/;
const sessions = new Map();

async function runUiAction(workspace, _config, args = {}, context = {}) {
  const action = String(args.action || '').trim();
  switch (action) {
    case 'start': return startUiSession(workspace, args, context);
    case 'navigate': return withSession(workspace, args, context, record => navigate(record, args));
    case 'snapshot': return withSession(workspace, args, context, record => snapshot(record, args));
    case 'interact': return withSession(workspace, args, context, record => interact(record, args));
    case 'screenshot': return withSession(workspace, args, context, record => screenshot(record, args));
    case 'console': return withSession(workspace, args, context, record => readEntries(record, 'console', args));
    case 'network': return withSession(workspace, args, context, record => readEntries(record, 'network', args));
    case 'viewport': return withSession(workspace, args, context, record => setViewport(record, args));
    case 'reload': return withSession(workspace, args, context, record => reload(record, args));
    case 'stop': return stopUiSession(workspace, args, context);
    default: throw new Error(`Unsupported relai_ui action '${action || '(missing)'}.`);
  }
}

async function startUiSession(workspace, args = {}, context = {}) {
  const taskId = taskIdFor(args, context);
  if (!taskId) throw taskError('TASK_ID_REQUIRED', 'UI testing requires a workspace-bound work session.');
  const existing = [...sessions.values()].find(record => record.taskId === taskId);
  if (existing) {
    throw taskError('UI_SESSION_ALREADY_ACTIVE', `Work session already has an active UI test session: ${existing.sessionId}. Stop it before starting another.`);
  }
  if (sessions.size >= MAX_ACTIVE_SESSIONS) {
    throw taskError('UI_SESSION_LIMIT', `Rel.AI supports at most ${MAX_ACTIVE_SESSIONS} concurrent UI test sessions.`);
  }

  const port = normalizePort(args.port, 'port');
  const protocol = normalizeProtocol(args.protocol);
  const host = normalizeLoopbackHost(args.host || '127.0.0.1');
  const allowedPorts = normalizeAllowedPorts(port, args.allowedPorts);
  const origin = `${protocol}://${formatHost(host)}:${port}`;
  const initialUrl = resolveUiRoute(origin, args.route || '/');
  const viewport = normalizeViewport(args.width, args.height);
  const runtime = resolveChromiumRuntime();
  const sessionId = `ui_${crypto.randomBytes(24).toString('base64url')}`;
  const consoleEntries = [];
  const networkEntries = [];
  let browser;
  let browserContext;

  try {
    browser = await chromium.launch({
      headless: args.headless !== false,
      executablePath: runtime.executablePath
    });
    browserContext = await browser.newContext({
      viewport,
      ignoreHTTPSErrors: protocol === 'https',
      serviceWorkers: 'block'
    });
    const record = {
      sessionId,
      taskId,
      workspaceId: workspace.alias,
      browser,
      browserContext,
      page: null,
      origin,
      allowedPorts,
      consoleEntries,
      networkEntries,
      browserProduct: runtime.product,
      createdAt: new Date().toISOString()
    };
    await installNetworkBoundary(record);
    const page = await browserContext.newPage();
    record.page = page;
    installPageDiagnostics(record, page);
    sessions.set(sessionId, record);
    browser.once('disconnected', () => sessions.delete(sessionId));
    const response = await page.goto(initialUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutFor(args)
    });
    assertCurrentPageAllowed(record);
    return {
      ok: true,
      workspace: workspace.alias,
      action: 'start',
      sessionId,
      url: sanitizeUiUrl(page.url()),
      origin,
      statusCode: response?.status() ?? null,
      title: await safeTitle(page),
      viewport,
      browserEngine: 'chromium',
      browserProduct: runtime.product,
      allowedPorts: [...allowedPorts].sort((a, b) => a - b),
      createdAt: record.createdAt
    };
  } catch (error) {
    sessions.delete(sessionId);
    await browserContext?.close().catch(() => {});
    await browser?.close().catch(() => {});
    throw error;
  }
}

async function navigate(record, args) {
  const targetUrl = resolveUiRoute(record.origin, args.route);
  const response = await record.page.goto(targetUrl, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutFor(args)
  });
  assertCurrentPageAllowed(record);
  return pageResult(record, 'navigate', {
    statusCode: response?.status() ?? null,
    title: await safeTitle(record.page)
  });
}

async function reload(record, args) {
  const response = await record.page.reload({
    waitUntil: 'domcontentloaded',
    timeout: timeoutFor(args)
  });
  assertCurrentPageAllowed(record);
  return pageResult(record, 'reload', {
    statusCode: response?.status() ?? null,
    title: await safeTitle(record.page)
  });
}

async function snapshot(record, args) {
  const yaml = await record.page.locator('body').ariaSnapshot({ timeout: timeoutFor(args) });
  const bounded = boundText(yaml, MAX_SNAPSHOT_CHARS);
  return pageResult(record, 'snapshot', {
    title: await safeTitle(record.page),
    snapshot: bounded.text,
    truncated: bounded.truncated
  });
}

async function interact(record, args) {
  const interaction = String(args.interaction || '').trim();
  const locator = targetLocator(record.page, args.target);
  const timeout = timeoutFor(args);
  switch (interaction) {
    case 'click':
      await locator.click({ timeout });
      break;
    case 'fill':
      await locator.fill(String(args.input ?? ''), { timeout });
      break;
    case 'press':
      if (!String(args.key || '').trim()) throw new Error('interact press requires key.');
      await locator.press(String(args.key), { timeout });
      break;
    case 'select':
      if (args.selectValue == null) throw new Error('interact select requires selectValue.');
      await locator.selectOption(String(args.selectValue), { timeout });
      break;
    case 'hover':
      await locator.hover({ timeout });
      break;
    case 'wait':
      await locator.waitFor({ state: normalizeWaitState(args.state), timeout });
      break;
    default:
      throw new Error(`Unsupported UI interaction '${interaction || '(missing)'}.`);
  }
  assertCurrentPageAllowed(record);
  return pageResult(record, 'interact', {
    interaction,
    target: publicTarget(args.target),
    title: await safeTitle(record.page)
  });
}

async function screenshot(record, args) {
  const buffer = await record.page.screenshot({
    type: 'png',
    fullPage: args.fullPage === true,
    animations: 'disabled'
  });
  if (buffer.length > MAX_SCREENSHOT_BYTES) {
    throw new Error(`UI screenshot is ${buffer.length} bytes; the limit is ${MAX_SCREENSHOT_BYTES} bytes. Use the current viewport instead of fullPage.`);
  }
  const viewport = record.page.viewportSize() || DEFAULT_VIEWPORT;
  return pageResult(record, 'screenshot', {
    title: await safeTitle(record.page),
    viewport,
    image: {
      mimeType: 'image/png',
      data: buffer.toString('base64'),
      bytes: buffer.length,
      width: viewport.width,
      height: viewport.height,
      fullPage: args.fullPage === true
    }
  });
}

async function setViewport(record, args) {
  const viewport = normalizeViewport(args.width, args.height, true);
  await record.page.setViewportSize(viewport);
  return pageResult(record, 'viewport', { viewport });
}

function readEntries(record, kind, args) {
  const source = kind === 'console' ? record.consoleEntries : record.networkEntries;
  const limit = clampInteger(args.maxEntries, 1, 200, 100);
  const entries = source.slice(-limit);
  if (args.clear === true) source.length = 0;
  return pageResult(record, kind, {
    ...(kind === 'console' ? { consoleEntries: entries } : { networkEntries: entries }),
    count: entries.length,
    cleared: args.clear === true
  });
}

async function stopUiSession(workspace, args = {}, context = {}) {
  const record = requireSession(workspace, args, context);
  sessions.delete(record.sessionId);
  const failures = [];
  await record.browserContext?.close().catch(error => failures.push(error));
  await record.browser?.close().catch(error => failures.push(error));
  return {
    ok: failures.length === 0,
    workspace: workspace.alias,
    action: 'stop',
    sessionId: record.sessionId,
    status: 'stopped',
    ...(failures.length ? { error: failures.map(error => error instanceof Error ? error.message : String(error)).join('; ') } : {})
  };
}

async function stopAllUiSessions() {
  const records = [...sessions.values()];
  sessions.clear();
  await Promise.allSettled(records.map(async record => {
    await record.browserContext?.close().catch(() => {});
    await record.browser?.close().catch(() => {});
  }));
  return { stopped: records.length };
}

function withSession(workspace, args, context, callback) {
  const record = requireSession(workspace, args, context);
  return callback(record);
}

function requireSession(workspace, args = {}, context = {}) {
  const sessionId = String(args.sessionId || '').trim();
  if (!UI_SESSION_ID.test(sessionId)) throw new Error('Invalid UI sessionId.');
  const record = sessions.get(sessionId);
  if (!record) throw taskError('UI_SESSION_NOT_FOUND', `Unknown or closed UI test session: ${sessionId}.`);
  if (record.workspaceId !== workspace.alias) throw taskError('UI_SESSION_WORKSPACE_MISMATCH', 'UI test session belongs to a different workspace.');
  const taskId = taskIdFor(args, context);
  if (!taskId || taskId !== record.taskId) throw taskError('UI_SESSION_TASK_MISMATCH', 'UI test session belongs to a different work session.');
  return record;
}

async function installNetworkBoundary(record) {
  await record.browserContext.route('**/*', async route => {
    const request = route.request();
    const url = request.url();
    if (isAllowedResourceUrl(url, record.allowedPorts)) {
      await route.continue();
      return;
    }
    pushEntry(record.networkEntries, {
      type: 'blocked',
      method: request.method(),
      url: sanitizeUiUrl(url),
      reason: 'outside_allowed_loopback_ports'
    });
    await route.abort('blockedbyclient');
  });
  await record.browserContext.routeWebSocket(() => true, async webSocket => {
    const url = webSocket.url();
    if (isAllowedSocketUrl(url, record.allowedPorts)) {
      await webSocket.connectToServer();
      return;
    }
    pushEntry(record.networkEntries, {
      type: 'blocked_websocket',
      url: sanitizeUiUrl(url),
      reason: 'outside_allowed_loopback_ports'
    });
    await webSocket.close({ code: 1008, reason: 'Rel.AI local UI boundary' });
  });
}

function installPageDiagnostics(record, page) {
  page.on('console', message => pushEntry(record.consoleEntries, {
    type: message.type(),
    text: boundText(message.text(), 4000).text,
    url: sanitizeUiUrl(message.location()?.url || '')
  }));
  page.on('pageerror', error => pushEntry(record.consoleEntries, {
    type: 'pageerror',
    text: boundText(error?.message || String(error), 4000).text
  }));
  page.on('requestfailed', request => pushEntry(record.networkEntries, {
    type: 'requestfailed',
    method: request.method(),
    url: sanitizeUiUrl(request.url()),
    error: boundText(request.failure()?.errorText || 'request failed', 1000).text
  }));
  page.on('response', response => {
    if (response.status() < 400) return;
    pushEntry(record.networkEntries, {
      type: 'http_error',
      method: response.request().method(),
      statusCode: response.status(),
      url: sanitizeUiUrl(response.url())
    });
  });
}

function targetLocator(page, target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error('interact requires target.');
  const by = String(target.by || '').trim();
  const value = String(target.value || '');
  if (!value) throw new Error('target.value is required.');
  const exact = target.exact === true;
  let locator;
  switch (by) {
    case 'role': locator = page.getByRole(value, target.name ? { name: String(target.name), exact } : {}); break;
    case 'text': locator = page.getByText(value, { exact }); break;
    case 'label': locator = page.getByLabel(value, { exact }); break;
    case 'placeholder': locator = page.getByPlaceholder(value, { exact }); break;
    case 'testid': locator = page.getByTestId(value); break;
    case 'css': locator = page.locator(value); break;
    default: throw new Error(`Unsupported target.by '${by || '(missing)'}.`);
  }
  const index = Number(target.index);
  if (Number.isInteger(index) && index >= 0) locator = locator.nth(index);
  return locator;
}

function publicTarget(target = {}) {
  return Object.fromEntries(Object.entries({
    by: target.by,
    value: target.value,
    name: target.name,
    exact: target.exact === true ? true : undefined,
    index: Number.isInteger(Number(target.index)) ? Number(target.index) : undefined
  }).filter(([, value]) => value !== undefined && value !== ''));
}

function pageResult(record, action, extra = {}) {
  return {
    ok: true,
    workspace: record.workspaceId,
    action,
    sessionId: record.sessionId,
    url: sanitizeUiUrl(record.page.url()),
    ...extra
  };
}

function normalizeUiRoute(route) {
  const value = String(route ?? '').trim();
  if (!value.startsWith('/')) throw new Error("UI route must be a local path beginning with '/'.");
  if (value.startsWith('//')) throw new Error('Protocol-relative UI routes are not accepted.');
  if (value.includes('\\')) throw new Error('Backslashes are not accepted in UI routes.');
  return value;
}

function resolveUiRoute(origin, route) {
  const value = normalizeUiRoute(route);
  const url = new URL(value, `${origin}/`);
  if (url.origin !== origin) throw new Error('UI route escaped the configured local origin.');
  return url.href;
}

function isAllowedResourceUrl(value, allowedPorts) {
  try {
    const url = new URL(value);
    if (['data:', 'blob:', 'about:'].includes(url.protocol)) return true;
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return isAllowedLoopbackUrl(url, allowedPorts);
  } catch {
    return false;
  }
}

function isAllowedSocketUrl(value, allowedPorts) {
  try {
    const url = new URL(value);
    if (!['ws:', 'wss:'].includes(url.protocol)) return false;
    return isAllowedLoopbackUrl(url, allowedPorts);
  } catch {
    return false;
  }
}

function isAllowedLoopbackUrl(url, allowedPorts) {
  const host = normalizeHostForComparison(url.hostname);
  if (!LOOPBACK_HOSTS.has(host)) return false;
  const port = url.port ? Number(url.port) : defaultPortForProtocol(url.protocol);
  return Number.isInteger(port) && allowedPorts.has(port);
}

function sanitizeUiUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    if (url.search) url.search = '?[redacted]';
    return url.href;
  } catch {
    return '';
  }
}

function assertCurrentPageAllowed(record) {
  const value = record.page.url();
  if (!isAllowedPageUrl(value, record.allowedPorts)) {
    throw taskError('UI_NAVIGATION_BLOCKED', 'The page navigated outside the allowed local UI boundary.');
  }
}

function isAllowedPageUrl(value, allowedPorts) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return isAllowedLoopbackUrl(url, allowedPorts);
  } catch {
    return false;
  }
}

function resolveChromiumRuntime() {
  const override = String(process.env.REL_AI_UI_CHROMIUM_PATH || '').trim();
  try {
    return discoverChromiumRuntime({ override });
  } catch (error) {
    if (override && error?.code === 'CHROMIUM_RUNTIME_OVERRIDE_INVALID') {
      throw new Error('REL_AI_UI_CHROMIUM_PATH does not point to an available file.', { cause: error });
    }
    const unavailable = taskError(
      'UI_RUNTIME_UNAVAILABLE',
      'No supported local Chromium runtime was found. Install Chrome, Edge, or Chromium, or set REL_AI_UI_CHROMIUM_PATH.'
    );
    unavailable.cause = error;
    throw unavailable;
  }
}

function normalizeAllowedPorts(primaryPort, values) {
  const ports = new Set([primaryPort]);
  if (values != null && !Array.isArray(values)) throw new Error('allowedPorts must be an array of local TCP ports.');
  for (const value of values || []) ports.add(normalizePort(value, 'allowedPorts entry'));
  if (ports.size > 10) throw new Error('allowedPorts supports at most 10 local ports per UI session.');
  return ports;
}

function normalizeViewport(width, height, requireBoth = false) {
  if (requireBoth && (width == null || height == null)) throw new Error('viewport requires width and height.');
  return {
    width: clampInteger(width, 320, 3840, DEFAULT_VIEWPORT.width),
    height: clampInteger(height, 240, 2160, DEFAULT_VIEWPORT.height)
  };
}

function normalizeLoopbackHost(value) {
  const host = normalizeHostForComparison(value);
  if (!LOOPBACK_HOSTS.has(host)) throw new Error('UI host must be localhost, 127.0.0.1, or ::1.');
  return host;
}

function normalizeHostForComparison(value) {
  return String(value || '').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

function formatHost(host) {
  return host.includes(':') ? `[${host}]` : host;
}

function normalizeProtocol(value) {
  const protocol = String(value || 'http').trim().toLowerCase().replace(/:$/, '');
  if (!['http', 'https'].includes(protocol)) throw new Error('UI protocol must be http or https.');
  return protocol;
}

function normalizePort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} must be an integer from 1 to 65535.`);
  return port;
}

function normalizeWaitState(value) {
  const state = String(value || 'visible').trim().toLowerCase();
  if (!['visible', 'hidden', 'attached', 'detached'].includes(state)) throw new Error('wait state must be visible, hidden, attached, or detached.');
  return state;
}

function timeoutFor(args) {
  return clampInteger(args.timeoutMs, 100, 30_000, DEFAULT_TIMEOUT_MS);
}

function defaultPortForProtocol(protocol) {
  return ['https:', 'wss:'].includes(protocol) ? 443 : 80;
}

function taskIdFor(args, context) {
  return String(context.taskId || args.work_id || '').trim();
}

async function safeTitle(page) {
  try { return boundText(await page.title(), 1000).text; } catch { return ''; }
}

function pushEntry(entries, entry) {
  entries.push({ at: new Date().toISOString(), ...entry });
  if (entries.length > MAX_LOG_ENTRIES) entries.splice(0, entries.length - MAX_LOG_ENTRIES);
}

function boundText(value, maxChars) {
  const text = String(value || '');
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n[truncated]`, truncated: true };
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

export {
  isAllowedResourceUrl,
  normalizeUiRoute,
  resolveUiRoute,
  runUiAction,
  sanitizeUiUrl,
  stopAllUiSessions
};
