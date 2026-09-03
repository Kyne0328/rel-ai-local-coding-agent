import assert from 'node:assert/strict';

import {
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

const freshInstallStorage = memoryStorage();
assert.equal(prepareConnectorRefreshNotice({
  currentVersion: '0.27.4',
  previousVersion: '',
  firstLaunch: true,
  updated: false,
  connectorRevision: 'surface-61',
  connectorRefreshRequired: false
}, freshInstallStorage), null, 'fresh installs must not be told to refresh a connector that was not previously registered');

const updateStorage = memoryStorage();
const updateNotice = prepareConnectorRefreshNotice({
  currentVersion: '0.27.4',
  previousVersion: '0.27.3',
  firstLaunch: false,
  updated: true,
  connectorRevision: 'surface-61',
  connectorRefreshRequired: true
}, updateStorage);
assert.ok(updateNotice, '0.27.4 must require a connector refresh when its connector revision changed');
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
  currentVersion: '0.27.4',
  previousVersion: '',
  firstLaunch: false,
  updated: false,
  connectorRevision: 'surface-61',
  connectorRefreshRequired: false
}, updateStorage);
assert.ok(nextLaunchNotice, 'an unacknowledged refresh notice must survive a restart after the update launch');

acknowledgeConnectorRefreshNotice(nextLaunchNotice, updateStorage);
assert.equal(prepareConnectorRefreshNotice({ currentVersion: '0.27.4', connectorRevision: 'surface-61' }, updateStorage), null, 'acknowledged notices must not reappear for the same connector revision');

assert.equal(prepareConnectorRefreshNotice({
  currentVersion: '0.27.5',
  previousVersion: '0.27.4',
  updated: true,
  connectorRevision: 'surface-61',
  connectorRefreshRequired: false
}, memoryStorage()), null, 'an app update with unchanged connector definitions must stay silent');

const futureStorage = memoryStorage();
const futureNotice = prepareConnectorRefreshNotice({
  currentVersion: '9.9.9',
  previousVersion: '9.9.8',
  updated: true,
  connectorRevision: 'future-surface',
  connectorRefreshRequired: true
}, futureStorage);
assert.ok(futureNotice, 'future connector changes must not depend on a hand-maintained version allowlist');
assert.match(futureNotice.description, /9\.9\.9 changed the connector details or tool definitions/i);

const sameVersionNotice = prepareConnectorRefreshNotice({
  currentVersion: '9.9.9',
  previousVersion: '',
  updated: false,
  connectorRevision: 'future-surface-2',
  connectorRefreshRequired: true
}, memoryStorage());
assert.ok(sameVersionNotice, 'a changed connector revision can request refresh even when the app version is unchanged');

console.log('Connector refresh modal behavior tests passed.');
