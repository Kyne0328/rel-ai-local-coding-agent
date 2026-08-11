import { normalizeFailureCategory } from '../../../analyticsFailureCategory.js';

const RANGE_MS = Object.freeze({
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
});

export const ANALYTICS_RANGES = Object.freeze([
  ['1h', 'Last hour'],
  ['24h', 'Last 24 hours'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['month', 'This month'],
  ['custom', 'Custom range']
]);

const TOTAL_KEYS = Object.freeze(['requests', 'toolCalls', 'successes', 'failures', 'requestBytes', 'resultBytes', 'executionMs']);

export function analyticsBounds(range = '24h', { now = new Date(), customStart = '', customEnd = '' } = {}) {
  const endNow = new Date(now);
  if (!Number.isFinite(endNow.getTime())) throw new Error('Analytics range has an invalid current time.');
  let start;
  let end = endNow;
  if (range === 'month') {
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  } else if (range === 'custom') {
    start = parseDateStart(customStart);
    const inclusiveEnd = parseDateStart(customEnd);
    if (!start || !inclusiveEnd) throw new Error('Choose both custom dates.');
    end = new Date(inclusiveEnd.getTime() + 24 * 60 * 60 * 1000);
    if (end > endNow) end = endNow;
    if (start >= end) throw new Error('Custom analytics start must be before the end date.');
    if (end.getTime() - start.getTime() > 90 * 24 * 60 * 60 * 1000) throw new Error('Custom analytics ranges are limited to 90 days.');
  } else {
    const duration = RANGE_MS[range] || RANGE_MS['24h'];
    start = new Date(end.getTime() - duration);
  }
  const duration = Math.max(1, end.getTime() - start.getTime());
  const previousEnd = new Date(start);
  const previousStart = new Date(start.getTime() - duration);
  return { range, start, end, previousStart, previousEnd, label: rangeLabel(range, start, end) };
}

export function analyticsMonths(bounds) {
  const start = new Date(Math.min(bounds.previousStart.getTime(), bounds.start.getTime()));
  const end = new Date(Math.max(bounds.previousEnd.getTime(), bounds.end.getTime()) - 1);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1);
  const months = [];
  while (cursor.getTime() <= last && months.length < 8) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

export function normalizeUsageSnapshot(snapshot, requestedMonth = '') {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.ok === false) throw new Error(String(snapshot?.error || 'Usage unavailable.'));
  const month = normalizeMonth(snapshot.month || requestedMonth);
  if (!month) throw new Error('Usage unavailable for the selected month.');
  return {
    source: snapshot.source === 'local' ? 'local' : 'cloud',
    month,
    totals: normalizeTotals(snapshot.totals),
    tools: normalizeBreakdown(snapshot.tools, 'tool'),
    devices: normalizeBreakdown(snapshot.devices, 'device'),
    workspaces: normalizeBreakdown(snapshot.workspaces, 'workspace'),
    workspaceDimensions: normalizeBreakdown(snapshot.workspaceDimensions, 'workspaceDimension'),
    workspaceTools: normalizeBreakdown(snapshot.workspaceTools, 'workspaceTool'),
    series: normalizeSeries(snapshot.series, 'overall'),
    toolSeries: normalizeSeries(snapshot.toolSeries, 'tool'),
    workspaceSeries: normalizeSeries(snapshot.workspaceSeries, 'workspace'),
    workspaceToolSeries: normalizeSeries(snapshot.workspaceToolSeries, 'workspaceTool'),
    failureCategories: normalizeFailureRows(snapshot.failureCategories),
    workspaceFailureCategories: normalizeFailureRows(snapshot.workspaceFailureCategories, { workspace: true }),
    failureCategorySeries: normalizeFailureRows(snapshot.failureCategorySeries, { series: true }),
    workspaceFailureCategorySeries: normalizeFailureRows(snapshot.workspaceFailureCategorySeries, { workspace: true, series: true })
  };
}

export function analyticsRangeScope(models, bounds, { workspace = '', deviceId = '', monthlyFallback = false } = {}) {
  const all = Array.isArray(models) ? models : [];
  const rows = all.flatMap(model => model.series).filter(row => inRange(row.hour, bounds.start, bounds.end));
  const workspaceRows = all.flatMap(model => model.workspaceSeries).filter(row => inRange(row.hour, bounds.start, bounds.end) && workspaceMatch(row, workspace, deviceId));
  const baseRows = workspace ? workspaceRows : rows;
  let totals = sumRows(baseRows);
  let usedMonthlyFallback = false;
  let fallbackModel = null;
  if (monthlyFallback && bounds.range === 'month') {
    const model = all.find(item => item.month === monthKey(bounds.end.getTime() - 1));
    fallbackModel = model || null;
    if (model) {
      if (workspace) {
        const relevant = model.workspaceDimensions.filter(row => workspaceMatch(row, workspace, deviceId));
        if (relevant.length) totals = sumRows(relevant);
        else {
          const legacy = model.workspaces.filter(row => row.workspace === workspace);
          if (legacy.length) totals = sumRows(legacy);
        }
      } else {
        totals = { ...model.totals };
      }
      usedMonthlyFallback = true;
    }
  }
  if (!usedMonthlyFallback) totals.activeDays = uniqueActiveDays(baseRows);
  else if (!Number.isFinite(totals.activeDays)) totals.activeDays = uniqueActiveDays(baseRows);
  const toolRows = workspace
    ? all.flatMap(model => model.workspaceToolSeries).filter(row => inRange(row.hour, bounds.start, bounds.end) && workspaceMatch(row, workspace, deviceId))
    : all.flatMap(model => model.toolSeries).filter(row => inRange(row.hour, bounds.start, bounds.end));
  const tools = groupRows(toolRows, row => row.tool || 'Unknown tool', 'tool');
  const deviceNames = new Map(all.flatMap(model => model.workspaceDimensions).map(row => [row.deviceId, row.displayName || row.deviceId]));
  const devices = workspace ? groupRows(workspaceRows, row => row.deviceId || '', 'device', row => deviceNames.get(row.deviceId) || row.displayName || row.deviceId || '') : [];
  const workspaces = workspace ? [] : groupRows(all.flatMap(model => model.workspaceSeries).filter(row => inRange(row.hour, bounds.start, bounds.end)), row => row.workspace || 'Unattributed', 'workspace');
  const categoryRows = workspace
    ? all.flatMap(model => model.workspaceFailureCategorySeries).filter(row => inRange(row.hour, bounds.start, bounds.end) && workspaceMatch(row, workspace, deviceId))
    : all.flatMap(model => model.failureCategorySeries).filter(row => inRange(row.hour, bounds.start, bounds.end));
  let failureCategories = groupFailureCategories(categoryRows);
  if (usedMonthlyFallback && fallbackModel) {
    const monthlyCategories = workspace
      ? fallbackModel.workspaceFailureCategories.filter(row => workspaceMatch(row, workspace, deviceId))
      : fallbackModel.failureCategories;
    failureCategories = groupFailureCategories(monthlyCategories);
  }
  const points = bucketSeries(baseRows, bounds.start, bounds.end);
  return {
    source: all.length && all.every(model => model.source === 'local') ? 'local' : 'cloud',
    kind: workspace ? 'workspace' : 'all',
    label: workspace || 'All workspaces',
    workspace,
    deviceId,
    ...totals,
    completed: totals.successes + totals.failures,
    successRate: totals.successes + totals.failures ? totals.successes / (totals.successes + totals.failures) * 100 : 0,
    averageDuration: totals.successes + totals.failures ? totals.executionMs / (totals.successes + totals.failures) : 0,
    tools,
    devices,
    workspaces,
    failureCategories,
    points,
    usedMonthlyFallback
  };
}

export function deltaFor(current, previous, key, { rate = false, inverse = false, neutral = false } = {}) {
  const now = Number(current?.[key] || 0);
  const before = Number(previous?.[key] || 0);
  if (rate) {
    const delta = now - before;
    return { value: delta, text: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pp`, tone: delta === 0 ? '' : (inverse ? delta < 0 : delta > 0) ? 'good' : 'bad' };
  }
  if (before === 0) return now === 0 ? { value: 0, text: 'No change', tone: '' } : { value: Infinity, text: 'New activity', tone: inverse ? 'bad' : '' };
  const value = (now - before) / before * 100;
  return { value, text: `${value < 0 ? '-' : '+'}${Math.abs(value) > 999 ? '>999' : Math.abs(value).toFixed(1)}%`, tone: neutral || value === 0 ? '' : (inverse ? value < 0 : value > 0) ? 'good' : 'bad' };
}

export function workspaceOptions(models) {
  const map = new Map();
  for (const row of (models || []).flatMap(model => model.workspaceDimensions)) {
    const alias = row.workspace;
    if (!alias) continue;
    if (!map.has(alias)) map.set(alias, new Map());
    map.get(alias).set(row.deviceId, row.displayName || row.deviceId);
  }
  for (const model of models || []) for (const row of model.workspaces) if (row.workspace && !map.has(row.workspace)) map.set(row.workspace, new Map());
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([workspace, devices]) => ({ workspace, devices: [...devices.entries()].map(([deviceId, displayName]) => ({ deviceId, displayName })) }));
}

function normalizeTotals(value) {
  if (!value || typeof value !== 'object') throw new Error('Usage unavailable: monthly totals were not returned.');
  const result = {};
  for (const key of [...TOTAL_KEYS, 'activeDays']) result[key] = exactNumber(value[key], key);
  return result;
}

function normalizeBreakdown(value, kind) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const row = item && typeof item === 'object' ? item : {};
    return {
      ...(kind.toLowerCase().includes('tool') ? { tool: String(row.tool || '') } : {}),
      ...(kind === 'device' || kind.includes('workspace') ? { deviceId: String(row.deviceId || ''), displayName: String(row.displayName || '') } : {}),
      ...(kind.includes('workspace') || kind === 'workspace' ? { workspace: String(row.workspace || '') } : {}),
      ...(row.workspaceKey ? { workspaceKey: String(row.workspaceKey) } : {}),
      toolCalls: exactNumber(row.toolCalls ?? row.calls, `${kind}.toolCalls`),
      successes: exactNumber(row.successes, `${kind}.successes`),
      failures: exactNumber(row.failures, `${kind}.failures`),
      executionMs: exactNumber(row.executionMs, `${kind}.executionMs`)
    };
  });
}

function normalizeSeries(value, kind) {
  if (!Array.isArray(value)) return [];
  return value.map(item => ({
    hour: String(item?.hour || ''),
    ...(kind.toLowerCase().includes('tool') ? { tool: String(item?.tool || '') } : {}),
    ...(kind.includes('workspace') ? { deviceId: String(item?.deviceId || ''), workspace: String(item?.workspace || ''), workspaceKey: String(item?.workspaceKey || ''), displayName: String(item?.displayName || '') } : {}),
    requests: exactNumber(item?.requests ?? 0, `${kind}.requests`),
    toolCalls: exactNumber(item?.toolCalls ?? 0, `${kind}.toolCalls`),
    successes: exactNumber(item?.successes ?? 0, `${kind}.successes`),
    failures: exactNumber(item?.failures ?? 0, `${kind}.failures`),
    requestBytes: exactNumber(item?.requestBytes ?? 0, `${kind}.requestBytes`),
    resultBytes: exactNumber(item?.resultBytes ?? 0, `${kind}.resultBytes`),
    executionMs: exactNumber(item?.executionMs ?? 0, `${kind}.executionMs`)
  })).filter(row => hourTime(row.hour) !== null);
}

function normalizeFailureRows(value, { workspace = false, series = false } = {}) {
  if (!Array.isArray(value)) return [];
  return value.map(item => ({
    ...(series ? { hour: String(item?.hour || '') } : {}),
    ...(workspace ? { deviceId: String(item?.deviceId || ''), workspace: String(item?.workspace || ''), workspaceKey: String(item?.workspaceKey || '') } : {}),
    category: normalizeFailureCategory(item?.category),
    failures: exactNumber(item?.failures ?? 0, 'failureCategory.failures')
  })).filter(row => row.failures > 0 && (!series || hourTime(row.hour) !== null));
}

function sumRows(rows) {
  const totals = Object.fromEntries(TOTAL_KEYS.map(key => [key, 0]));
  for (const row of rows || []) for (const key of TOTAL_KEYS) totals[key] += Number(row[key] || 0);
  return totals;
}

function groupFailureCategories(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const category = normalizeFailureCategory(row?.category);
    grouped.set(category, (grouped.get(category) || 0) + Number(row?.failures || 0));
  }
  return [...grouped.entries()].map(([category, failures]) => ({ category, failures })).filter(row => row.failures > 0).sort((a, b) => b.failures - a.failures || a.category.localeCompare(b.category));
}

function groupRows(rows, identity, kind, displayName = null) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = identity(row);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, { toolCalls: 0, successes: 0, failures: 0, executionMs: 0 });
    const target = grouped.get(key);
    target.toolCalls += row.toolCalls;
    target.successes += row.successes;
    target.failures += row.failures;
    target.executionMs += row.executionMs;
  }
  return [...grouped.entries()].map(([key, totals]) => ({
    ...(kind === 'tool' ? { tool: key } : {}),
    ...(kind === 'workspace' ? { workspace: key } : {}),
    ...(kind === 'device' ? { deviceId: key, displayName: displayName ? displayName((rows || []).find(row => identity(row) === key)) : key } : {}),
    ...totals
  })).sort((a, b) => b.toolCalls - a.toolCalls);
}

function bucketSeries(rows, start, end) {
  const duration = end.getTime() - start.getTime();
  const bucketMs = duration <= 48 * 60 * 60 * 1000 ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const count = Math.max(1, Math.ceil(duration / bucketMs));
  const points = Array.from({ length: count }, (_, index) => ({ at: start.getTime() + index * bucketMs, requests: 0, toolCalls: 0, successes: 0, failures: 0, executionMs: 0 }));
  for (const row of rows || []) {
    const time = hourTime(row.hour);
    if (time === null) continue;
    const index = Math.floor((time - start.getTime()) / bucketMs);
    if (index < 0 || index >= points.length) continue;
    for (const key of ['requests', 'toolCalls', 'successes', 'failures', 'executionMs']) points[index][key] += Number(row[key] || 0);
  }
  return points;
}

function uniqueActiveDays(rows) {
  return new Set((rows || []).map(row => row.hour.slice(0, 10))).size;
}

function workspaceMatch(row, workspace, deviceId) {
  if (workspace && row.workspace !== workspace) return false;
  return !deviceId || row.deviceId === deviceId;
}

function inRange(hour, start, end) {
  const time = hourTime(hour);
  return time !== null && time >= start.getTime() && time < end.getTime();
}

function hourTime(hour) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(String(hour || ''))) return null;
  const value = Date.parse(`${hour}:00:00Z`);
  return Number.isFinite(value) ? value : null;
}

function parseDateStart(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function rangeLabel(range, start, end) {
  const known = ANALYTICS_RANGES.find(([key]) => key === range)?.[1];
  if (range !== 'custom') return known || 'Last 24 hours';
  const format = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `${format.format(start)} – ${format.format(new Date(end.getTime() - 1))}`;
}

function monthKey(value) {
  const date = new Date(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function normalizeMonth(value) {
  const text = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : '';
}

function exactNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Usage unavailable: invalid ${field} value.`);
  return number;
}
