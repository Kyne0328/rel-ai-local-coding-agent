import assert from 'node:assert/strict';

import {
  CONNECTOR_REFRESH_VERSIONS,
  DISMISS_DELAY_MS,
  REFRESH_STEPS,
  acknowledgeConnectorRefreshNotice,
  prepareConnectorRefreshNotice
} from '../src/ui/connector-refresh-modal.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values
  };
}

assert.deepEqual([...CONNECTOR_REFRESH_VERSIONS], ['0.26.0', '0.27.0', '0.27.1']);

const freshInstallStorage = memoryStorage();
assert.equal(prepareConnectorRefreshNotice({
  currentVersion: '0.26.0',
  previousVersion: '',
  firstLaunch: true,
  updated: false
}, freshInstallStorage), null, 'fresh installs must not be told to refresh a connector that was not previously registered');

const updateStorage = memoryStorage();
const updateNotice = prepareConnectorRefreshNotice({
  currentVersion: '0.26.0',
  previousVersion: '0.25.1',
  firstLaunch: false,
  updated: true
}, updateStorage);
assert.ok(updateNotice, 'updating into 0.26.0 must require the one-time connector refresh notice');
assert.equal(updateNotice.dismissDelayMs, DISMISS_DELAY_MS);
assert.deepEqual(updateNotice.steps, REFRESH_STEPS);
assert.deepEqual(REFRESH_STEPS, [
  'Open Settings.',
  'Open Plugins.',
  'Select the Rel.AI MCP connector.',
  'Scroll to the bottom and open Information.',
  'Click Refresh.'
]);

const nextLaunchNotice = prepareConnectorRefreshNotice({
  currentVersion: '0.26.0',
  previousVersion: '',
  firstLaunch: false,
  updated: false
}, updateStorage);
assert.ok(nextLaunchNotice, 'an unacknowledged refresh notice must survive a restart after the update launch');

acknowledgeConnectorRefreshNotice(nextLaunchNotice, updateStorage);
assert.equal(prepareConnectorRefreshNotice({ currentVersion: '0.26.0' }, updateStorage), null, 'acknowledged notices must not reappear for the same release');
const v027Storage = memoryStorage();
const v027Notice = prepareConnectorRefreshNotice({
  currentVersion: '0.27.0',
  previousVersion: '0.26.6',
  firstLaunch: false,
  updated: true
}, v027Storage);
assert.ok(v027Notice, 'updating into 0.27.0 must require the one-time connector refresh notice');
assert.equal(v027Notice.dismissDelayMs, 5000, 'v0.27.0 refresh notice must retain the five-second reading delay');

const v0271Storage = memoryStorage();
const v0271Notice = prepareConnectorRefreshNotice({
  currentVersion: '0.27.1',
  previousVersion: '0.27.0',
  firstLaunch: false,
  updated: true
}, v0271Storage);
assert.ok(v0271Notice, 'updating into 0.27.1 must require the one-time connector refresh notice');
assert.match(v0271Notice.description, /presentation or tool metadata/i);

assert.equal(prepareConnectorRefreshNotice({ currentVersion: '0.25.1', previousVersion: '0.25.0', updated: true }, memoryStorage()), null, 'releases without a public schema refresh must stay silent');

console.log('Connector refresh modal behavior tests passed.');
