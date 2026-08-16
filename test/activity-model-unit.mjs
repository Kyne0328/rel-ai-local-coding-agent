import test from 'node:test';
import assert from 'node:assert/strict';
import * as activityModel from '../src/ui/features/activity/model.js';
import {
  activityAbsoluteTime,
  activityActionLabel,
  activityFilterTransition,
  activityMessage,
  activityStatusGroup,
  filterActivityEntries,
  mergeActivityEntries,
  nextActivityExpiry,
  parseActivityHistoryResponse,
  replaceActivityHistory
} from '../src/ui/features/activity/model.js';

const NOW = Date.parse('2026-08-06T10:00:00.000Z');
const entry = (overrides = {}) => ({
  eventId: 'event-1',
  timestamp: '2026-08-06T09:55:00.000Z',
  tool: 'relai_read',
  workspace: 'app',
  status: 'succeeded',
  title: 'Read repository',
  summary: 'Read the requested files.',
  ...overrides
});

test('history snapshots replace stale local entries', () => {
  const replaced = replaceActivityHistory([
    entry({ eventId: 'server-new', timestamp: '2026-08-06T09:59:00.000Z' })
  ]);
  assert.deepEqual(replaced.map(item => item.eventId), ['server-new']);
});

test('live merges report no-op snapshots and preserve useful message text', () => {
  const current = [entry()];
  const same = mergeActivityEntries(current, [entry()]);
  assert.equal(same.changed, false);
  assert.equal(same.entries, current, 'no-op snapshots should preserve the current array identity');

  const blankPatch = mergeActivityEntries(current, [entry({ summary: '   ', message: '' })]);
  assert.equal(blankPatch.changed, false, 'blank lifecycle fields must not erase useful display text');
  assert.equal(blankPatch.entries[0].summary, 'Read the requested files.');

  const changed = mergeActivityEntries(current, [entry({ status: 'failed', summary: 'Read failed.' })]);
  assert.equal(changed.changed, true);
  assert.equal(changed.entries[0].summary, 'Read failed.');
});

test('activity resolves user-facing work-session context from task or session ids', () => {
  assert.equal(typeof activityModel.activitySessionView, 'function', 'activity model must expose session resolution');
  const { activitySessionView } = activityModel;
  const sessions = new Map([
    ['task-1', { id: 'task-1', title: 'Fix Electron app lag', workspace: 'rel-ai-mcp' }]
  ]);
  assert.deepEqual(activitySessionView(entry({ taskId: 'task-1' }), sessions), {
    id: 'task-1',
    title: 'Fix Electron app lag',
    workspace: 'rel-ai-mcp',
    shortId: 'task-1',
    linked: true
  });
  assert.equal(activitySessionView(entry({ taskId: 'missing-session' }), sessions).title, 'Task missing-');
  assert.equal(activitySessionView(entry({ taskId: '', sessionId: '' }), sessions).title, 'Unlinked activity');
});

test('activity search can match a resolved work-session title', () => {
  const { activitySessionView } = activityModel;
  const base = { search: 'electron app lag', timeRange: 'all', workspace: '', tool: '', status: '', task: '' };
  const sessions = new Map([['task-1', { id: 'task-1', title: 'Fix Electron app lag', workspace: 'rel-ai-mcp' }]]);
  const results = filterActivityEntries([entry({ taskId: 'task-1' })], base, NOW, {
    sessionTitle: item => activitySessionView(item, sessions).title
  });
  assert.equal(results.length, 1);
});

test('activity messages skip whitespace and always provide visible text', () => {
  assert.equal(activityMessage(entry({ summary: '   ', message: '\n', currentActivity: 'Indexing files' })), 'Indexing files');
  assert.equal(activityMessage(entry({ summary: '', title: '', operation: '', path: '' })), 'No additional details recorded.');
});

test('status groups preserve active, blocked, cancelled, failed, and succeeded semantics', () => {
  assert.equal(activityStatusGroup(entry({ status: 'running', ok: undefined })), 'active');
  assert.equal(activityStatusGroup(entry({ status: 'blocked', ok: false })), 'blocked');
  assert.equal(activityStatusGroup(entry({ status: 'cancelled', ok: false })), 'cancelled');
  assert.equal(activityStatusGroup(entry({ status: 'failed', ok: false })), 'failed');
  assert.equal(activityStatusGroup(entry({ status: 'succeeded', ok: true })), 'succeeded');
  assert.equal(activityStatusGroup(entry({ status: '', ok: undefined })), 'other');
});

test('filters use exact status groups and an injected current time', () => {
  const entries = [
    entry({ eventId: 'recent-success', status: 'succeeded' }),
    entry({ eventId: 'recent-running', status: 'running' }),
    entry({ eventId: 'recent-blocked', status: 'blocked' }),
    entry({ eventId: 'old-success', timestamp: '2026-08-06T08:00:00.000Z' })
  ];
  const base = { search: '', timeRange: '1h', workspace: '', tool: '', status: '', task: '' };
  assert.deepEqual(filterActivityEntries(entries, base, NOW).map(item => item.eventId), ['recent-success', 'recent-running', 'recent-blocked']);
  const sorted = [entries[1], entries[0], entries[2], entries[3]];
  assert.deepEqual(filterActivityEntries(sorted, base, NOW, { sorted: true }).map(item => item.eventId), ['recent-running', 'recent-success', 'recent-blocked'], 'pre-sorted activity should filter without reordering');
  assert.deepEqual(filterActivityEntries(entries, { ...base, status: 'active' }, NOW).map(item => item.eventId), ['recent-running']);
  assert.deepEqual(filterActivityEntries(entries, { ...base, status: 'blocked' }, NOW).map(item => item.eventId), ['recent-blocked']);
  assert.deepEqual(filterActivityEntries(entries, { ...base, status: 'ok' }, NOW).map(item => item.eventId), ['recent-success'], 'legacy successful routes should map to succeeded only');
  assert.deepEqual(filterActivityEntries(entries, { ...base, status: 'error' }, NOW).map(item => item.eventId), [], 'legacy failed routes must not include blocked or cancelled events');
  assert.deepEqual(filterActivityEntries([entry()], base, Date.parse('2026-08-06T10:55:00.000Z')), [], 'events must expire at the exact range boundary');
  assert.deepEqual(filterActivityEntries([entry({ taskId: '', sessionId: 'session-1' })], { ...base, timeRange: 'all', task: 'session-1' }, NOW).map(item => item.eventId), ['event-1'], 'session filters must accept sessionId-only activity records');
});

test('workspace filter transitions require a route remount while local filters do not', () => {
  const current = { search: 'read', timeRange: '1h', workspace: 'app', tool: '', status: '', task: 'task-1' };
  const workspaceChange = activityFilterTransition(current, { timeRange: '24h', workspace: 'api', tool: 'relai_read', status: 'failed' });
  assert.equal(workspaceChange.workspaceChanged, true);
  assert.deepEqual(workspaceChange.filterState, {
    search: 'read',
    timeRange: '24h',
    workspace: 'api',
    tool: 'relai_read',
    status: 'failed',
    task: 'task-1'
  });

  const localChange = activityFilterTransition(current, { timeRange: 'all', workspace: 'app', tool: '', status: 'active' });
  assert.equal(localChange.workspaceChanged, false);
});

test('time filters expose the next expiration boundary', () => {
  const expiry = nextActivityExpiry([entry()], { timeRange: '1h' }, NOW);
  assert.equal(expiry, Date.parse('2026-08-06T10:55:00.000Z'));
  assert.equal(nextActivityExpiry([entry()], { timeRange: 'all' }, NOW), Number.POSITIVE_INFINITY);
});

test('history responses expose structured fetch failures', () => {
  assert.deepEqual(parseActivityHistoryResponse({ ok: true, entries: [entry()] }).entries.map(item => item.eventId), ['event-1']);
  assert.deepEqual(parseActivityHistoryResponse([entry()]).entries.map(item => item.eventId), ['event-1']);
  assert.deepEqual(parseActivityHistoryResponse({ ok: false, error: 'Request timed out.' }), {
    ok: false,
    entries: [],
    error: 'Request timed out.'
  });
  assert.equal(parseActivityHistoryResponse({ ok: false, error: { message: 'Gateway unavailable.' } }).error, 'Gateway unavailable.');
});

test('detail timestamps and action labels have safe, distinguishable fallbacks', () => {
  assert.equal(activityAbsoluteTime(entry({ timestamp: 'not-a-date' })), 'Time unavailable');
  assert.notEqual(
    activityActionLabel(entry({ eventId: 'a', summary: 'First operation.' })),
    activityActionLabel(entry({ eventId: 'b', summary: 'Second operation.' }))
  );
  assert.equal(activityModel.activityDisplayAction(entry()), 'Read repository');
  assert.equal(activityModel.activityDisplayAction(entry({ title: '', operation: '', tool: 'relai_edit' })), 'Edit');
  assert.equal(activityModel.activityToolLabel('relai_validate'), 'Validate');
  assert.equal(activityModel.activityToolLabel('custom-action'), 'Custom action');
  assert.match(activityActionLabel(entry()), /^Open Read repository details: Read the requested files\./);
});
