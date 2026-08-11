import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MCP_PROTOCOL_VERSION } from '../src/mcp/protocol.js';
import { GATEWAY_PROTOCOL_VERSION, MINIMUM_GATEWAY_PROTOCOL_VERSION, schemaSynchronizationStatus } from '../src/gateway/protocol.js';
import { createGatewayState } from '../electron/gateway-state.js';
import { assessUpdateSynchronization } from '../electron/app-updater-state.js';

const compatibleDevice = {
  protocolVersion: GATEWAY_PROTOCOL_VERSION,
  mcpProtocolVersion: MCP_PROTOCOL_VERSION
};
const currentManifest = { manifestHash: 'hash-current', schemaVersion: 3 };
const currentObservation = { manifestHash: 'hash-current', schemaVersion: 3, observedAt: 1234 };

assert.deepEqual(
  schemaSynchronizationStatus({ authenticated: true, ...currentManifest, observation: currentObservation, device: compatibleDevice }),
  {
    status: 'current',
    schemaVersion: 3,
    manifestHash: 'hash-current',
    observedAt: 1234,
    minimumProtocolVersion: MINIMUM_GATEWAY_PROTOCOL_VERSION,
    currentProtocolVersion: GATEWAY_PROTOCOL_VERSION
  }
);

for (const observation of [
  null,
  { manifestHash: 'hash-old', schemaVersion: 2, observedAt: 1000 },
  { manifestHash: 'hash-current', schemaVersion: 2, observedAt: 1000 }
]) {
  const stale = schemaSynchronizationStatus({ authenticated: true, ...currentManifest, observation, device: compatibleDevice });
  assert.equal(stale.status, 'tool_refresh_required');
  assert.equal(stale.schemaVersion, 3);
  assert.equal(stale.manifestHash, 'hash-current');
}

const reauth = schemaSynchronizationStatus({
  authenticated: false,
  ...currentManifest,
  observation: null,
  device: { protocolVersion: 0, mcpProtocolVersion: MCP_PROTOCOL_VERSION }
});
assert.equal(reauth.status, 'reauthentication_required', 'credential state must take precedence over schema/device warnings');

const deviceUpdate = schemaSynchronizationStatus({
  authenticated: true,
  ...currentManifest,
  observation: currentObservation,
  device: { protocolVersion: 0, mcpProtocolVersion: MCP_PROTOCOL_VERSION }
});
assert.equal(deviceUpdate.status, 'device_update_required');
assert.equal(deviceUpdate.minimumProtocolVersion, MINIMUM_GATEWAY_PROTOCOL_VERSION);
assert.equal(deviceUpdate.currentProtocolVersion, GATEWAY_PROTOCOL_VERSION);
assert.equal(deviceUpdate.manifestHash, 'hash-current');

const state = createGatewayState();
state.update({
  schemaVersion: 3,
  manifestHash: 'hash-current',
  schemaStatus: 'tool_refresh_required',
  minimumProtocolVersion: 1,
  currentProtocolVersion: 1
});
assert.equal(state.snapshot().schemaStatus, 'tool_refresh_required');
assert.equal(state.snapshot().schemaVersion, 3);
assert.equal(state.snapshot().manifestHash, 'hash-current');

const currentRelease = {
  applicationVersion: '0.24.1',
  schemaVersion: 3,
  manifestHash: 'hash-current',
  deviceProtocolVersion: 1,
  minimumCompatibleDeviceProtocol: 1
};
assert.deepEqual(
  assessUpdateSynchronization(currentRelease, { ...currentRelease, applicationVersion: '0.25.0' }),
  { status: 'current', toolRefreshRequired: false, deviceUpdateRequired: false }
);
assert.deepEqual(
  assessUpdateSynchronization(currentRelease, { ...currentRelease, applicationVersion: '0.25.0', manifestHash: 'hash-next', schemaVersion: 4 }),
  { status: 'tool_refresh_required', toolRefreshRequired: true, deviceUpdateRequired: false }
);
assert.deepEqual(
  assessUpdateSynchronization(currentRelease, { ...currentRelease, applicationVersion: '0.25.0', deviceProtocolVersion: 2, minimumCompatibleDeviceProtocol: 2 }),
  { status: 'device_update_required', toolRefreshRequired: false, deviceUpdateRequired: true }
);

const cloudSource = fs.readFileSync(new URL('../src/ui/features/settings/cloud-gateway.js', import.meta.url), 'utf8');
assert.match(cloudSource, /reauthentication_required/);
assert.match(cloudSource, /updateSynchronization/);
assert.match(cloudSource, /refresh the existing Rel\.AI tools in ChatGPT/i);
assert.match(cloudSource, /does not mean ChatGPT authentication has expired/i);

console.log('Gateway per-grant schema observation, device compatibility, and updater synchronization contracts passed.');
