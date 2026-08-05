import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function functionSource(source, name) {
  const asyncStart = source.indexOf(`async function ${name}`);
  const syncStart = source.indexOf(`function ${name}`);
  const start = asyncStart >= 0 ? asyncStart : syncStart;
  assert.notEqual(start, -1, `missing function ${name}`);
  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

async function exerciseSyncLiveView(source, updateBehavior) {
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
    ${functionSource(source, 'syncLiveView')}
    globalThis.testApi = {
      syncLiveView,
      readFingerprint: () => _renderFingerprint
    };
  `, context);
  const data = { revision: 2 };
  const result = await context.testApi.syncLiveView(data);
  return { calls, data, result, fingerprint: context.testApi.readFingerprint() };
}

const dashboard = read('public/dashboard.js');
const home = read('src/ui/features/home/index.js');
const sessions = read('src/ui/features/sessions/index.js');
const processes = read('src/ui/features/processes/index.js');
const connector = read('src/ui/features/settings/connector.js');

assert.match(dashboard, /async function updateLiveView/);
assert.equal(dashboard.includes('await syncLiveView(hydrated);'), true);
assert.doesNotMatch(
  functionSource(dashboard, 'liveOnEvent'),
  /renderViewIfChanged|rerender/,
  'tool-call snapshots must not remount the active route directly'
);
assert.equal(dashboard.includes('return updateHomeLiveState(root, data);'), true);
assert.equal(dashboard.includes('module.updateTaskSessions(root, data)'), true);
assert.equal(dashboard.includes('module.updateProcessesLiveState(root, data)'), true);
assert.equal(dashboard.includes('module.updateConnectorLiveState(root, data)'), true);

{
  const supported = await exerciseSyncLiveView(dashboard, true);
  assert.deepEqual(supported.calls.map(call => call[0]), ['update']);
  assert.equal(supported.fingerprint, 'fingerprint:2');
  assert.equal(supported.result, true);
}

{
  const unsupported = await exerciseSyncLiveView(dashboard, false);
  assert.deepEqual(unsupported.calls.map(call => call[0]), ['update', 'render']);
  assert.equal(unsupported.fingerprint, 'original');
  assert.equal(unsupported.result, 'rendered');
}

{
  const failed = await exerciseSyncLiveView(dashboard, new Error('partial update failed'));
  assert.deepEqual(failed.calls.map(call => call[0]), ['update', 'debug', 'render']);
  assert.equal(failed.fingerprint, 'original');
  assert.equal(failed.result, 'rendered');
}

assert.match(home, /export function updateHomeLiveState/);
assert.match(sessions, /export function updateTaskSessions/);
assert.match(processes, /export function updateProcessesLiveState/);
assert.match(connector, /export function updateConnectorLiveState/);
assert.match(connector, /connector-technical-details/);
for (const moduleSource of [home, sessions, processes, connector]) {
  assert.match(moduleSource, /isEqualNode/, 'live region updaters must preserve unchanged DOM nodes');
}
assert.equal(
  functionSource(connector, 'updateConnectorLiveState').includes("replaceConnectorRegion(page, '.connector-details'"),
  false,
  'live connection updates must preserve the setup guide'
);

console.log('Dashboard live rendering unit test passed.');
