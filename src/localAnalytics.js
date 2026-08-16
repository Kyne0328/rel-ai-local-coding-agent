import * as fs from 'node:fs';
import * as path from 'node:path';
import { statePath } from './stateLayout.js';
import { writeTextAtomicAsync } from './durableState.js';
import { failureCategoryFromCode, normalizeFailureCategory } from './analyticsFailureCategory.js';
import { classifyAnalyticsOutcome, reliabilityCountersForOutcome } from './analyticsOutcome.js';

const SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const LOCAL_DEVICE_ID = 'local-device';
const LOCAL_DEVICE_NAME = 'This device';
const ANALYTICS_FLUSH_DELAY_MS = 250;
const ANALYTICS_FLUSH_MAX_WAIT_MS = 1000;
const documentCache = new Map();
const writeStates = new Map();

function recordLocalToolOutcome(config = {}, event = {}) {
  try {
    const at = boundedDate(event.at);
    const month = monthKey(at);
    const hour = hourKey(at);
    const tool = boundedLabel(event.tool, 160) || 'unknown-tool';
    const workspace = boundedLabel(event.workspace, 160);
    const durationMs = boundedDuration(event.durationMs);
    const success = event.ok === true ? 1 : 0;
    const failure = success ? 0 : 1;
    const category = failure ? failureCategoryFromCode(event.errorCode) : '';
    const outcome = classifyAnalyticsOutcome(event);
    const reliability = reliabilityCountersForOutcome(outcome);
    const document = readDocument(config, month);

    incrementTotals(document.totals, success, failure, durationMs, reliability);
    incrementNamed(document.tools, 'tool', tool, success, failure, durationMs, reliability);
    if (workspace) {
      incrementNamed(document.workspaces, 'workspace', workspace, success, failure, durationMs, reliability);
      incrementWorkspaceTool(document.workspaceTools, workspace, tool, success, failure, durationMs, reliability);
    }
    if (failure) {
      incrementFailureCategory(document.failureCategories, category);
      if (workspace) incrementWorkspaceFailureCategory(document.workspaceFailureCategories, workspace, category);
    }

    const hourly = findOrCreate(document.hours, row => row.hour === hour, () => ({
      hour,
      ...emptyAggregate(true),
      tools: [],
      workspaces: [],
      workspaceTools: [],
      failureCategories: [],
      workspaceFailureCategories: []
    }));
    incrementTotals(hourly, success, failure, durationMs, reliability);
    incrementNamed(hourly.tools, 'tool', tool, success, failure, durationMs, reliability);
    if (workspace) {
      incrementNamed(hourly.workspaces, 'workspace', workspace, success, failure, durationMs, reliability);
      incrementWorkspaceTool(hourly.workspaceTools, workspace, tool, success, failure, durationMs, reliability);
    }
    if (failure) {
      incrementFailureCategory(hourly.failureCategories, category);
      if (workspace) incrementWorkspaceFailureCategory(hourly.workspaceFailureCategories, workspace, category);
    }
    scheduleDocumentWrite(config, document);
    return true;
  } catch {
    return false;
  }
}

function readLocalUsageSnapshot(config = {}, requestedMonth = '') {
  const month = normalizeMonth(requestedMonth) || monthKey(new Date());
  return projectLocalUsageSnapshot(month, readDocument(config, month));
}

async function readLocalUsageSnapshotAsync(config = {}, requestedMonth = '') {
  const month = normalizeMonth(requestedMonth) || monthKey(new Date());
  return projectLocalUsageSnapshot(month, await readDocumentFresh(config, month));
}

function projectLocalUsageSnapshot(month, document) {
  const activeDays = new Set(document.hours.map(row => row.hour.slice(0, 10))).size;
  const totals = {
    ...aggregateDto(document.totals),
    requests: number(document.totals.requests),
    requestBytes: 0,
    resultBytes: 0,
    activeDays
  };
  return {
    source: 'local',
    month,
    totals,
    tools: document.tools.map(row => ({ tool: row.tool, ...aggregateDto(row) })),
    devices: [{ deviceId: LOCAL_DEVICE_ID, displayName: LOCAL_DEVICE_NAME, ...aggregateDto(document.totals) }],
    workspaces: document.workspaces.map(row => ({ workspace: row.workspace, ...aggregateDto(row) })),
    workspaceDimensions: document.workspaces.map(row => ({
      deviceId: LOCAL_DEVICE_ID,
      displayName: LOCAL_DEVICE_NAME,
      workspace: row.workspace,
      workspaceKey: `${LOCAL_DEVICE_ID}::${row.workspace}`,
      ...aggregateDto(row)
    })),
    workspaceTools: document.workspaceTools.map(row => ({
      deviceId: LOCAL_DEVICE_ID,
      workspace: row.workspace,
      workspaceKey: `${LOCAL_DEVICE_ID}::${row.workspace}`,
      tool: row.tool,
      ...aggregateDto(row)
    })),
    series: document.hours.map(row => ({
      hour: row.hour,
      requests: number(row.requests),
      ...aggregateDto(row),
      requestBytes: 0,
      resultBytes: 0
    })),
    toolSeries: document.hours.flatMap(row => row.tools.map(item => ({ hour: row.hour, tool: item.tool, ...aggregateDto(item) }))),
    workspaceSeries: document.hours.flatMap(row => row.workspaces.map(item => ({
      hour: row.hour,
      deviceId: LOCAL_DEVICE_ID,
      displayName: LOCAL_DEVICE_NAME,
      workspace: item.workspace,
      workspaceKey: `${LOCAL_DEVICE_ID}::${item.workspace}`,
      ...aggregateDto(item)
    }))),
    workspaceToolSeries: document.hours.flatMap(row => row.workspaceTools.map(item => ({
      hour: row.hour,
      deviceId: LOCAL_DEVICE_ID,
      workspace: item.workspace,
      workspaceKey: `${LOCAL_DEVICE_ID}::${item.workspace}`,
      tool: item.tool,
      ...aggregateDto(item)
    }))),
    failureCategories: document.failureCategories.map(item => ({ category: item.category, failures: number(item.failures) })),
    workspaceFailureCategories: document.workspaceFailureCategories.map(item => ({
      deviceId: LOCAL_DEVICE_ID,
      workspace: item.workspace,
      workspaceKey: `${LOCAL_DEVICE_ID}::${item.workspace}`,
      category: item.category,
      failures: number(item.failures)
    })),
    failureCategorySeries: document.hours.flatMap(row => row.failureCategories.map(item => ({ hour: row.hour, category: item.category, failures: number(item.failures) }))),
    workspaceFailureCategorySeries: document.hours.flatMap(row => row.workspaceFailureCategories.map(item => ({
      hour: row.hour,
      deviceId: LOCAL_DEVICE_ID,
      workspace: item.workspace,
      workspaceKey: `${LOCAL_DEVICE_ID}::${item.workspace}`,
      category: item.category,
      failures: number(item.failures)
    })))
  };
}

function readDocument(config, month) {
  const file = analyticsPath(config, month);
  const cached = documentCache.get(file);
  if (cached) return cached;
  let document;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) document = emptyDocument(month);
    else document = parseDocument(fs.readFileSync(file, 'utf8'), month);
  } catch {
    document = emptyDocument(month);
  }
  documentCache.set(file, document);
  return document;
}

async function readDocumentFresh(config, month) {
  const file = analyticsPath(config, month);
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return emptyDocument(month);
    return parseDocument(await fs.promises.readFile(file, 'utf8'), month);
  } catch {
    return emptyDocument(month);
  }
}

function parseDocument(text, month) {
  const parsed = JSON.parse(text);
  const supportedSchema = parsed?.schemaVersion === SCHEMA_VERSION || parsed?.schemaVersion === LEGACY_SCHEMA_VERSION;
  return supportedSchema && parsed?.month === month
    ? sanitizeDocument(parsed, month, { resetReliability: parsed.schemaVersion !== SCHEMA_VERSION })
    : emptyDocument(month);
}

function scheduleDocumentWrite(config, document) {
  const file = analyticsPath(config, document.month);
  documentCache.set(file, document);
  let state = writeStates.get(file);
  if (!state) {
    state = { document, version: 0, persistedVersion: 0, timer: null, writing: false, firstQueuedAt: 0, promise: Promise.resolve() };
    writeStates.set(file, state);
  }
  state.document = document;
  state.version += 1;
  const now = Date.now();
  if (!state.firstQueuedAt) state.firstQueuedAt = now;
  if (state.timer) clearTimeout(state.timer);
  if (state.writing) return;
  const remaining = Math.max(0, ANALYTICS_FLUSH_MAX_WAIT_MS - (now - state.firstQueuedAt));
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushDocumentWrite(file, state);
  }, Math.min(ANALYTICS_FLUSH_DELAY_MS, remaining));
  state.timer.unref?.();
}

async function flushDocumentWrite(file, state) {
  if (!state || state.writing || state.persistedVersion >= state.version) return state?.promise || Promise.resolve();
  state.writing = true;
  const version = state.version;
  const document = state.document;
  let succeeded = false;
  state.promise = writeTextAtomicAsync(file, `${JSON.stringify(document)}\n`, { mode: 0o600, durable: false })
    .then(() => { succeeded = true; })
    .catch(error => {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] deferred local analytics write:', error);
    })
    .finally(() => {
      state.writing = false;
      if (succeeded) {
        state.persistedVersion = version;
        state.firstQueuedAt = 0;
      }
      if (state.persistedVersion < state.version && !state.timer) {
        state.firstQueuedAt ||= Date.now();
        state.timer = setTimeout(() => {
          state.timer = null;
          void flushDocumentWrite(file, state);
        }, succeeded ? 0 : 1000);
        state.timer.unref?.();
      }
    });
  return state.promise;
}

async function flushLocalAnalytics(config = null) {
  const prefix = config ? `${statePath(config, 'analytics', 'local')}${path.sep}` : '';
  const entries = [...writeStates.entries()].filter(([file]) => !prefix || file.startsWith(prefix));
  for (const [file, state] of entries) {
    while (state.persistedVersion < state.version) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      await flushDocumentWrite(file, state);
    }
  }
}

function analyticsPath(config, month) {
  return statePath(config, 'analytics', 'local', `${month}.json`);
}

function emptyDocument(month) {
  return { schemaVersion: SCHEMA_VERSION, month, totals: emptyAggregate(true), tools: [], workspaces: [], workspaceTools: [], failureCategories: [], workspaceFailureCategories: [], hours: [] };
}

function sanitizeDocument(value, month, { resetReliability = false } = {}) {
  const doc = emptyDocument(month);
  doc.totals = sanitizeAggregate(value.totals, true, resetReliability);
  doc.tools = sanitizeNamedRows(value.tools, 'tool', resetReliability);
  doc.workspaces = sanitizeNamedRows(value.workspaces, 'workspace', resetReliability);
  doc.workspaceTools = sanitizeWorkspaceTools(value.workspaceTools, resetReliability);
  doc.failureCategories = sanitizeFailureCategories(value.failureCategories);
  doc.workspaceFailureCategories = sanitizeWorkspaceFailureCategories(value.workspaceFailureCategories);
  doc.hours = (Array.isArray(value.hours) ? value.hours : []).filter(row => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(String(row?.hour || ''))).slice(-744).map(row => ({
    hour: String(row.hour),
    ...sanitizeAggregate(row, true, resetReliability),
    tools: sanitizeNamedRows(row.tools, 'tool', resetReliability),
    workspaces: sanitizeNamedRows(row.workspaces, 'workspace', resetReliability),
    workspaceTools: sanitizeWorkspaceTools(row.workspaceTools, resetReliability),
    failureCategories: sanitizeFailureCategories(row.failureCategories),
    workspaceFailureCategories: sanitizeWorkspaceFailureCategories(row.workspaceFailureCategories)
  }));
  return doc;
}

function sanitizeNamedRows(rows, field, resetReliability = false) {
  return (Array.isArray(rows) ? rows : []).slice(0, 512).map(row => ({ [field]: boundedLabel(row?.[field], 160), ...sanitizeAggregate(row, false, resetReliability) })).filter(row => row[field]);
}
function sanitizeWorkspaceTools(rows, resetReliability = false) {
  return (Array.isArray(rows) ? rows : []).slice(0, 2048).map(row => ({ workspace: boundedLabel(row?.workspace, 160), tool: boundedLabel(row?.tool, 160), ...sanitizeAggregate(row, false, resetReliability) })).filter(row => row.workspace && row.tool);
}
function sanitizeFailureCategories(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 32).map(row => ({ category: normalizeFailureCategory(row?.category), failures: number(row?.failures) })).filter(row => row.failures > 0);
}
function sanitizeWorkspaceFailureCategories(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 512).map(row => ({ workspace: boundedLabel(row?.workspace, 160), category: normalizeFailureCategory(row?.category), failures: number(row?.failures) })).filter(row => row.workspace && row.failures > 0);
}
function sanitizeAggregate(row, includeRequests = false, resetReliability = false) {
  const successes = number(row?.successes);
  const failures = number(row?.failures);
  const reliabilityCalls = resetReliability ? 0 : number(row?.reliabilityCalls);
  const reliableCalls = resetReliability ? 0 : number(row?.reliableCalls);
  return {
    ...(includeRequests ? { requests: number(row?.requests) } : {}),
    toolCalls: number(row?.toolCalls),
    successes,
    failures,
    reliabilityCalls,
    reliableCalls,
    infrastructureFailures: resetReliability ? 0 : number(row?.infrastructureFailures),
    operationFailures: resetReliability ? 0 : number(row?.operationFailures),
    recoverableFailures: resetReliability ? 0 : number(row?.recoverableFailures),
    cancellations: resetReliability ? 0 : number(row?.cancellations),
    executionMs: number(row?.executionMs)
  };
}
function aggregateDto(row) {
  return {
    toolCalls: number(row?.toolCalls), successes: number(row?.successes), failures: number(row?.failures),
    reliabilityCalls: number(row?.reliabilityCalls), reliableCalls: number(row?.reliableCalls),
    infrastructureFailures: number(row?.infrastructureFailures), operationFailures: number(row?.operationFailures),
    recoverableFailures: number(row?.recoverableFailures), cancellations: number(row?.cancellations),
    executionMs: number(row?.executionMs)
  };
}
function emptyAggregate(includeRequests = false) {
  return {
    ...(includeRequests ? { requests: 0 } : {}),
    toolCalls: 0, successes: 0, failures: 0,
    reliabilityCalls: 0, reliableCalls: 0, infrastructureFailures: 0,
    operationFailures: 0, recoverableFailures: 0, cancellations: 0,
    executionMs: 0
  };
}
function incrementTotals(row, success, failure, durationMs, reliability) { row.requests = number(row.requests) + 1; incrementAggregate(row, success, failure, durationMs, reliability); }
function incrementNamed(rows, field, value, success, failure, durationMs, reliability) { const row = findOrCreate(rows, item => item[field] === value, () => ({ [field]: value, ...emptyAggregate() })); incrementAggregate(row, success, failure, durationMs, reliability); }
function incrementWorkspaceTool(rows, workspace, tool, success, failure, durationMs, reliability) { const row = findOrCreate(rows, item => item.workspace === workspace && item.tool === tool, () => ({ workspace, tool, ...emptyAggregate() })); incrementAggregate(row, success, failure, durationMs, reliability); }
function incrementFailureCategory(rows, category) { const normalized = normalizeFailureCategory(category); const row = findOrCreate(rows, item => item.category === normalized, () => ({ category: normalized, failures: 0 })); row.failures = number(row.failures) + 1; }
function incrementWorkspaceFailureCategory(rows, workspace, category) { const normalized = normalizeFailureCategory(category); const row = findOrCreate(rows, item => item.workspace === workspace && item.category === normalized, () => ({ workspace, category: normalized, failures: 0 })); row.failures = number(row.failures) + 1; }
function incrementAggregate(row, success, failure, durationMs, reliability = {}) {
  row.toolCalls = number(row.toolCalls) + 1;
  row.successes = number(row.successes) + success;
  row.failures = number(row.failures) + failure;
  for (const key of ['reliabilityCalls', 'reliableCalls', 'infrastructureFailures', 'operationFailures', 'recoverableFailures', 'cancellations']) {
    row[key] = number(row[key]) + number(reliability[key]);
  }
  row.executionMs = number(row.executionMs) + durationMs;
}
function findOrCreate(rows, predicate, create) { let row = rows.find(predicate); if (!row) { row = create(); rows.push(row); } return row; }
function boundedDate(value) { const date = value instanceof Date ? value : new Date(value == null ? Date.now() : value); return Number.isFinite(date.getTime()) ? date : new Date(); }
function boundedDuration(value) { const n = Number(value); return Number.isFinite(n) ? Math.min(MAX_DURATION_MS, Math.max(0, Math.round(n))) : 0; }
function boundedLabel(value, max) { return String(value || '').trim().slice(0, max); }
function number(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; }
function monthKey(date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`; }
function hourKey(date) { return `${monthKey(date)}-${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}`; }
function normalizeMonth(value) { const text = String(value || '').trim(); return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : ''; }

export { flushLocalAnalytics, recordLocalToolOutcome, readLocalUsageSnapshot, readLocalUsageSnapshotAsync };
