import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const dashboard = read('public/dashboard.js');
const api = read('src/ui/api.js');
const system = read('src/ui/features/system/index.js');
const connector = read('src/ui/features/settings/connector.js');
const desktopConnection = read('src/ui/features/settings/desktop-connection.js');
const home = read('src/ui/features/home/index.js');
const diagnostics = read('src/ui/features/settings/diagnostics.js');
const drawer = read('src/ui/components/drawer.js');

function functionSource(source, name) {
  const asyncStart = source.indexOf(`async function ${name}`);
  const syncStart = source.indexOf(`function ${name}`);
  const start = asyncStart >= 0 ? asyncStart : syncStart;
  assert.notEqual(start, -1, `missing function ${name}`);
  const signatureEnd = source.indexOf(')', start);
  const openingBrace = source.indexOf('{', signatureEnd);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

async function exerciseSyncLiveView(updateBehavior) {
  const calls = [];
  const context = {
    updateLiveView: async data => {
      calls.push(['update', data]);
      if (updateBehavior instanceof Error) throw updateBehavior;
      return updateBehavior;
    },
    renderViewIfChanged: async data => {
      calls.push(['render', data]);
      return 'rendered';
    },
    viewRevisionKey: data => `revision:${data.revision}`,
    debugError: error => calls.push(['debug', error.message])
  };
  vm.runInNewContext(`
    let _renderRevisionKey = 'original';
    ${functionSource(dashboard, 'syncLiveView')}
    globalThis.testApi = {
      syncLiveView,
      readFingerprint: () => _renderRevisionKey
    };
  `, context);
  const data = { revision: 2 };
  const result = await context.testApi.syncLiveView(data);
  return { calls, result, revisionKey: context.testApi.readFingerprint() };
}

function exerciseRuntimeLogDelta(runtime, change) {
  const calls = [];
  const context = {
    currentReport: { logs: { runtime } },
    currentContainer: {},
    updateSourceOptions: () => calls.push('sources'),
    renderDiagnosticLogs: () => calls.push('render'),
    announceDiagnosticUpdate: () => calls.push('announce'),
    scheduleLiveTailRefresh: () => calls.push('refresh')
  };
  vm.runInNewContext(`
    ${functionSource(diagnostics, 'finiteRevision')}
    ${functionSource(diagnostics, 'applyRuntimeLogDelta')}
    globalThis.applyRuntimeLogDelta = applyRuntimeLogDelta;
  `, context);
  context.applyRuntimeLogDelta(change);
  return { calls, runtime: context.currentReport.logs.runtime };
}

assert.match(dashboard, /module\.updateSystemLiveState\(root, currentSection\(\), data\)/);
assert.match(dashboard, /connection: systemSection\('connection'\)/);
assert.doesNotMatch(dashboard, /settings\/connection/);
assert.match(system, /updateConnectorLiveState\(content, dashboardState\)/);
assert.match(connector, /export function updateConnectorLiveState/);
assert.match(connector, /replaceRegion\(page,\s*'\.connection-summary-card'/);
assert.match(connector, /replaceRegion\(page,\s*'\.connection-layer-disclosure'/);
assert.match(connector, /replaceRegion\(page,\s*'\.connection-guide-region'/);
assert.match(home, /export function updateHomeLiveState/);
assert.match(home, /syncHomeRegion/);
assert.match(functionSource(home, 'updateHomeLiveState'), /overviewState\(data\)/, 'Home live updates must derive data without rebuilding the full overview tree');
assert.doesNotMatch(functionSource(home, 'updateHomeLiveState'), /buildOverview\(/, 'Home live updates must not build a detached full overview tree');
assert.match(home, /function syncHomeClockText/, 'Home live regions must neutralize clock-only text before structural comparison');
assert.match(functionSource(home, 'syncHomeRegion'), /syncHomeClockText/, 'Home region equality must ignore clock-only text changes');
const sessions = read('src/ui/features/sessions/index.js');
const processes = read('src/ui/features/processes/index.js');
const activity = read('src/ui/features/activity/index.js');

assert.match(dashboard, /async function updateLiveView/);
assert.equal(dashboard.includes('await syncLiveView(refreshed);'), true);
assert.doesNotMatch(
  functionSource(dashboard, 'liveOnEvent'),
  /renderViewIfChanged|rerender/,
  'tool-call snapshots must not remount the active route directly'
);
assert.equal(dashboard.includes('return updateHomeLiveState(root, data);'), true);
assert.equal(dashboard.includes('module.updateTaskSessions(root, data)'), true);
assert.equal(dashboard.includes('module.updateActivityLiveState(data)'), true, 'Activity live updates must receive the full dashboard snapshot for session correlation');
assert.equal(dashboard.includes('module.updateSystemLiveState(root, currentSection(), data)'), true);
{
  const supported = await exerciseSyncLiveView(true);
  assert.deepEqual(supported.calls.map(call => call[0]), ['update']);
  assert.equal(supported.revisionKey, 'revision:2');
  assert.equal(supported.result, true);
}

{
  const unsupported = await exerciseSyncLiveView(false);
  assert.deepEqual(unsupported.calls.map(call => call[0]), ['update'], 'unsupported passive updates must not remount the route');
  assert.equal(unsupported.revisionKey, 'original');
  assert.equal(unsupported.result, false);
}

{
  const failed = await exerciseSyncLiveView(new Error('partial update failed'));
  assert.deepEqual(failed.calls.map(call => call[0]), ['update', 'debug'], 'failed passive updates must leave the mounted route intact');
  assert.equal(failed.revisionKey, 'original');
  assert.equal(failed.result, false);
}

const desktopStatusSource = functionSource(dashboard, 'applyDesktopStatus');
assert.match(desktopStatusSource, /patchLocalConnection/, 'desktop status pushes must update only their owned store slice');
assert.doesNotMatch(desktopStatusSource, /initStore/, 'desktop status pushes must not replace the whole dashboard store');
assert.match(desktopStatusSource, /syncLiveView\(data\)/, 'desktop status pushes must use passive route synchronization');
assert.doesNotMatch(desktopStatusSource, /renderViewIfChanged/, 'desktop status pushes must not structurally rerender the route');
assert.match(home, /export function updateHomeLiveState/);
assert.match(sessions, /export function updateTaskSessions/);
assert.match(activity, /export function updateActivityLiveState/, 'Activity must expose session-aware live synchronization');
assert.match(activity, /<th scope="col" class="activity-tool-column">(?:Tool|Action)<\/th>/, 'Activity must preserve the tool/action column');
assert.match(activity, /<th scope="col" class="activity-workspace-column">(?:Workspace|Project)<\/th>/, 'Activity must preserve the workspace/project column');
assert.match(activity, /<th scope="col" class="activity-message-column">Message<\/th>/, 'Activity must preserve the original Message column');
assert.doesNotMatch(activity, /<th scope="col" class="activity-session-column">Session<\/th>/, 'Activity must not replace the original columns with Session');
assert.match(activity, /routeHref\('tasks'/, 'Activity details must deep-link back to Sessions');
assert.match(sessions, /data-session-fingerprint/, 'session rows must carry semantic fingerprints for keyed reconciliation');
assert.match(functionSource(sessions, 'timingHtml'), /data-clock-relative/, 'ended and inactive task rows must show relative age instead of total duration');
assert.match(functionSource(sessions, 'updateTaskSessions'), /refreshOpenSession\(data\)/, 'live task updates must refresh an already-open task detail drawer');
assert.match(functionSource(sessions, 'refreshOpenSession'), /updateDrawer/, 'open task details must update in place without reopening the drawer');
assert.match(drawer, /export function updateDrawer/, 'shared drawers must support in-place content refreshes');
const sessionFactsSource = functionSource(sessions, 'sessionFacts');
assert.match(sessionFactsSource, /toolCallCount/, 'session rows must show their tool-call count');
assert.match(sessionFactsSource, /(?:tool call|action)/, 'session rows must label action counts');
assert.match(sessionFactsSource, /file.*edited/, 'session rows must show their edited-file count');
assert.doesNotMatch(sessionFactsSource, /risk/, 'session row facts must not surface workflow risk labels');
assert.doesNotMatch(functionSource(sessions, 'workflowTechnicalHtml'), /risk/, 'session details must not surface workflow risk labels');
assert.doesNotMatch(functionSource(sessions, 'updateTaskSessions'), /mountTasks\(detached|sessions-history-card[^\n]*replaceWith/, 'session live updates must not rebuild or replace the complete history card');
assert.match(processes, /export function updateProcessesLiveState/);
assert.match(functionSource(processes, 'updateProcessesLiveState'), /syncProcessClockText/, 'Process list equality must ignore live elapsed text changes');
assert.match(functionSource(processes, 'updateProcessesLiveState'), /reconcileProcessList/, 'Process live updates must reconcile the existing list instead of replacing it wholesale');
assert.match(processes, /function copyProcessDisclosureState/, 'Process live updates must preserve output disclosure state');
assert.match(processes, /function captureProcessFocus/, 'Process live updates must preserve focused process controls');
assert.doesNotMatch(functionSource(processes, 'updateProcessesLiveState'), /currentList\.replaceWith\(nextList\)/, 'Process live updates must not replace the whole process list');
assert.match(diagnostics, /function syncDiagnosticRegions/, 'Diagnostics live updates must reconcile stable report regions');
assert.match(diagnostics, /data-diagnostic-region="maintenance"/, 'Diagnostics maintenance controls must live in a stable region');
assert.match(diagnostics, /function copyDiagnosticDisclosureState/, 'Diagnostics must preserve technical disclosure state when a changed region is replaced');
assert.doesNotMatch(functionSource(diagnostics, 'renderCurrentReport'), /root\.innerHTML\s*=/, 'Diagnostics live updates must not remount the whole report');
{
  const runtime = { revision: 4, count: 1, entries: [{ message: 'existing' }] };
  const duplicate = exerciseRuntimeLogDelta(runtime, { type: 'append', revision: 4, count: 1, entry: { message: 'duplicate', level: 'info' } });
  assert.deepEqual(duplicate.runtime.entries.map(entry => entry.message), ['existing'], 'duplicate diagnostic revisions must not duplicate log rows');
  assert.deepEqual(duplicate.calls, []);

  const gap = exerciseRuntimeLogDelta(runtime, { type: 'append', revision: 6, count: 2, entry: { message: 'gap', level: 'warning' } });
  assert.deepEqual(gap.runtime.entries.map(entry => entry.message), ['existing'], 'a missed diagnostic revision must not apply a partial live tail');
  assert.deepEqual(gap.calls, ['refresh'], 'revision gaps must request an authoritative diagnostic refresh');

  const next = exerciseRuntimeLogDelta(runtime, { type: 'append', revision: 5, count: 2, entry: { message: 'next', level: 'warning' } });
  assert.equal(next.runtime.revision, 5);
  assert.deepEqual(Array.from(next.runtime.entries, entry => entry.message), ['existing', 'next']);
  assert.deepEqual(next.calls, ['sources', 'render', 'announce']);
}
assert.match(sessions, /renderSessionRows\(body, \[\.\.\._sessionsById\.values\(\)\], scopeKey\)/, 'Show more must render the latest live session snapshot instead of the mount-time data object');
const reconcileSessionsSource = functionSource(sessions, 'reconcileSessionRows');
assert.match(reconcileSessionsSource, /body\.children\[index\]/, 'keyed reconciliation must compare against the current DOM child after a row replacement');
assert.doesNotMatch(reconcileSessionsSource, /let cursor/, 'keyed reconciliation must not retain a cursor that can become detached by replaceWith');
assert.match(connector, /export function updateConnectorLiveState/);
assert.doesNotMatch(connector, /connector-technical-details|Execution mode|Native MCP Tasks/, 'Connection must not expose protocol execution internals in the normal UI.');
for (const moduleSource of [home, processes, connector]) {
  assert.match(moduleSource, /isEqualNode/, 'live region updaters must preserve unchanged DOM nodes');
}
assert.doesNotMatch(sessions, /currentHistory\.replaceWith\(nextHistory\)/, 'session history must reconcile rows instead of replacing the card');
assert.equal(
  functionSource(connector, 'updateConnectorLiveState').includes("replaceConnectorRegion(page, '.connector-details'"),
  false,
  'live connection updates must preserve the setup guide'
);

const bootSource = functionSource(dashboard, 'boot');
assert.match(bootSource, /relai:dashboard-refresh', event =>/, 'dashboard refresh events must carry explicit refresh intent');
assert.match(bootSource, /event\.detail\?\.structural === true/, 'structural refreshes must be opt-in');
assert.doesNotMatch(bootSource, /visibilitychange[\s\S]*doRefresh/, 'visibility changes must rely on SSE revision catch-up instead of rebuilding the dashboard');
assert.match(functionSource(dashboard, 'liveCatchUpRequired'), /remoteRevisions/, 'SSE reconnects must compare typed server revisions before refreshing');
assert.match(functionSource(dashboard, 'lazySection'), /context\.isCurrent/, 'lazy route modules must verify the current router generation before mounting');
assert.match(dashboard, /data-route-retry/, 'lazy route failures must render a visible retry action');
assert.doesNotMatch(dashboard, /\.then\(module => module\.mount[^\n]*\.catch\(debugError\)/, 'lazy route failures must not be swallowed by debug-only handlers');

const refreshSource = functionSource(dashboard, 'performRefresh');
assert.match(refreshSource, /initStore\(hydrated\)[\s\S]*replayLiveEventsDuringRefresh\(\)[\s\S]*const refreshed = getStore\(\)/, 'aggregate refreshes must replay typed live events that arrived while the snapshot was in flight');
assert.match(refreshSource, /options\.render === true[\s\S]*renderViewIfChanged\(refreshed\)/, 'explicit structural refreshes must retain rerender support');
assert.match(refreshSource, /options\.render !== false[\s\S]*syncLiveView\(refreshed\)/, 'ordinary refreshes must use passive synchronization');
assert.match(functionSource(dashboard, 'liveOnEvent'), /bufferLiveEventDuringRefresh\(event\)/, 'live events must be retained while an aggregate refresh is in flight');
const refreshCoordinatorSource = functionSource(dashboard, 'doRefresh');
assert.match(refreshCoordinatorSource, /_refreshLiveEvents = \[\]/, 'each aggregate refresh must start a fresh bounded live-event buffer');
assert.match(refreshCoordinatorSource, /needsCatchUp[\s\S]*live-refresh-overflow/, 'buffer overflow must schedule an authoritative catch-up refresh instead of silently dropping state');
assert.match(functionSource(dashboard, 'bufferLiveEventDuringRefresh'), /MAX_REFRESH_LIVE_EVENTS[\s\S]*_refreshLiveEventOverflow = true/, 'refresh buffering must stay bounded and record overflow');

assert.match(api, /export function requestDashboardRefresh\(options = \{\}\)/, 'dashboard refresh helper must accept refresh intent');
assert.match(api, /structural: options\.structural === true/, 'dashboard refresh helper must default structural intent to false');
assert.match(desktopConnection, /saveSettings\([\s\S]*requestDashboardRefresh\(\{ structural: true \}\)/, 'Secure tunnel configuration changes must structurally refresh the Connection route');
assert.doesNotMatch(functionSource(dashboard, 'viewRevisionKey'), /JSON\.stringify/, 'route invalidation must use explicit revisions instead of serializing dashboard objects');
assert.match(functionSource(dashboard, 'viewRevisionKey'), /data\.live\?\.revisions/, 'route invalidation must use typed domain revisions');

console.log('Dashboard live rendering contracts passed.');
