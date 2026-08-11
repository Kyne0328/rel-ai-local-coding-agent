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
const home = read('src/ui/features/home/index.js');

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
    viewFingerprint: data => `fingerprint:${data.revision}`,
    debugError: error => calls.push(['debug', error.message])
  };
  vm.runInNewContext(`
    let _renderFingerprint = 'original';
    ${functionSource(dashboard, 'syncLiveView')}
    globalThis.testApi = {
      syncLiveView,
      readFingerprint: () => _renderFingerprint
    };
  `, context);
  const data = { revision: 2 };
  const result = await context.testApi.syncLiveView(data);
  return { calls, result, fingerprint: context.testApi.readFingerprint() };
}

assert.match(dashboard, /module\.updateSystemLiveState\(root, 'connection', data\)/);
assert.match(dashboard, /currentRoutePath\(\) === 'connection'/);
assert.doesNotMatch(dashboard, /settings\/connection/);
assert.match(system, /updateConnectorLiveState\(container, dashboardState\)/);
assert.match(connector, /export function updateConnectorLiveState/);
assert.match(connector, /replaceRegion\(page, '\.connection-summary-card'/);
assert.match(connector, /replaceRegion\(page, '\.connection-layer-disclosure'/);
assert.match(connector, /replaceRegion\(page, '\.connection-guide-region'/);
assert.match(home, /export function updateHomeLiveState/);
assert.match(home, /syncHomeRegion/);
assert.match(home, /function syncHomeClockText/, 'Home live regions must neutralize clock-only text before structural comparison');
assert.match(functionSource(home, 'syncHomeRegion'), /syncHomeClockText/, 'Home region equality must ignore clock-only text changes');
const sessions = read('src/ui/features/sessions/index.js');
const processes = read('src/ui/features/processes/index.js');
const activity = read('src/ui/features/activity/index.js');

assert.match(dashboard, /async function updateLiveView/);
assert.equal(dashboard.includes('await syncLiveView(hydrated);'), true);
assert.doesNotMatch(
  functionSource(dashboard, 'liveOnEvent'),
  /renderViewIfChanged|rerender/,
  'tool-call snapshots must not remount the active route directly'
);
assert.equal(dashboard.includes('return updateHomeLiveState(root, data);'), true);
assert.equal(dashboard.includes('module.updateTaskSessions(root, data)'), true);
assert.equal(dashboard.includes('module.updateActivityLiveState(data)'), true, 'Activity live updates must receive the full dashboard snapshot for session correlation');
assert.equal(dashboard.includes('module.updateProcessesLiveState(root, data)'), true);
assert.match(dashboard, /function applyGatewayStatusSnapshot/);
assert.doesNotMatch(
  functionSource(dashboard, 'applyGatewayStatusSnapshot'),
  /renderViewIfChanged|rerender|syncLiveView/,
  'gateway status pushes must not structurally remount the active or unrelated route'
);
assert.match(functionSource(dashboard, 'applyGatewayStatusSnapshot'), /updateLiveView/);

{
  const supported = await exerciseSyncLiveView(true);
  assert.deepEqual(supported.calls.map(call => call[0]), ['update']);
  assert.equal(supported.fingerprint, 'fingerprint:2');
  assert.equal(supported.result, true);
}

{
  const unsupported = await exerciseSyncLiveView(false);
  assert.deepEqual(unsupported.calls.map(call => call[0]), ['update'], 'unsupported passive updates must not remount the route');
  assert.equal(unsupported.fingerprint, 'original');
  assert.equal(unsupported.result, false);
}

{
  const failed = await exerciseSyncLiveView(new Error('partial update failed'));
  assert.deepEqual(failed.calls.map(call => call[0]), ['update', 'debug'], 'failed passive updates must leave the mounted route intact');
  assert.equal(failed.fingerprint, 'original');
  assert.equal(failed.result, false);
}

const desktopStatusSource = functionSource(dashboard, 'applyDesktopStatus');
assert.match(desktopStatusSource, /syncLiveView\(data\)/, 'desktop status pushes must use passive route synchronization');
assert.doesNotMatch(desktopStatusSource, /renderViewIfChanged/, 'desktop status pushes must not structurally rerender the route');
assert.match(home, /export function updateHomeLiveState/);
assert.match(sessions, /export function updateTaskSessions/);
assert.match(activity, /export function updateActivityLiveState/, 'Activity must expose session-aware live synchronization');
assert.match(activity, /<th scope="col" class="activity-tool-column">Tool<\/th>/, 'Activity must preserve the original Tool column');
assert.match(activity, /<th scope="col" class="activity-workspace-column">Workspace<\/th>/, 'Activity must preserve the original Workspace column');
assert.match(activity, /<th scope="col" class="activity-message-column">Message<\/th>/, 'Activity must preserve the original Message column');
assert.doesNotMatch(activity, /<th scope="col" class="activity-session-column">Session<\/th>/, 'Activity must not replace the original columns with Session');
assert.match(activity, /routeHref\('tasks'/, 'Activity details must deep-link back to Sessions');
assert.match(sessions, /data-session-fingerprint/, 'session rows must carry semantic fingerprints for keyed reconciliation');
const sessionFactsSource = functionSource(sessions, 'sessionFacts');
assert.match(sessionFactsSource, /toolCallCount/, 'session rows must show their tool-call count');
assert.match(sessionFactsSource, /tool call/, 'session rows must label tool-call counts');
assert.match(sessionFactsSource, /file.*edited/, 'session rows must show their edited-file count');
assert.doesNotMatch(sessionFactsSource, /risk/, 'session row facts must not surface workflow risk labels');
assert.doesNotMatch(functionSource(sessions, 'workflowTechnicalHtml'), /risk/, 'session details must not surface workflow risk labels');
assert.doesNotMatch(functionSource(sessions, 'updateTaskSessions'), /mountTasks\(detached|sessions-history-card[^\n]*replaceWith/, 'session live updates must not rebuild or replace the complete history card');
assert.match(processes, /export function updateProcessesLiveState/);
assert.match(processes, /function syncProcessClockText/, 'Process live updates must neutralize clock-only text before equality checks');
assert.match(functionSource(processes, 'updateProcessesLiveState'), /syncProcessClockText/, 'Process list equality must ignore live elapsed text changes');
assert.match(sessions, /renderSessionRows\(body, \[\.\.\._sessionsById\.values\(\)\], scopeKey\)/, 'Show more must render the latest live session snapshot instead of the mount-time data object');
const reconcileSessionsSource = functionSource(sessions, 'reconcileSessionRows');
assert.match(reconcileSessionsSource, /body\.children\[index\]/, 'keyed reconciliation must compare against the current DOM child after a row replacement');
assert.doesNotMatch(reconcileSessionsSource, /let cursor/, 'keyed reconciliation must not retain a cursor that can become detached by replaceWith');
assert.match(connector, /export function updateConnectorLiveState/);
assert.match(connector, /updateCloudGatewayLiveState/);
assert.match(connector, /connector-technical-details/);
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
assert.doesNotMatch(bootSource, /visibility-resume', render: true/, 'visibility resume must not force a structural rerender');

const refreshSource = functionSource(dashboard, 'performRefresh');
assert.match(refreshSource, /options\.render === true[\s\S]*renderViewIfChanged\(hydrated\)/, 'explicit structural refreshes must retain rerender support');
assert.match(refreshSource, /options\.render !== false[\s\S]*syncLiveView\(hydrated\)/, 'ordinary refreshes must use passive synchronization');

assert.match(api, /export function requestDashboardRefresh\(options = \{\}\)/, 'dashboard refresh helper must accept refresh intent');
assert.match(api, /structural: options\.structural === true/, 'dashboard refresh helper must default structural intent to false');

console.log('Dashboard live rendering contracts passed.');