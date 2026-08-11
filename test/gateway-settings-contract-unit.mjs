import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const cloud = read('src/ui/features/settings/cloud-gateway.js');
const connector = read('src/ui/features/settings/connector.js');
const direct = read('src/ui/features/settings/desktop-connection.js');
const preload = read('electron/preload.cjs');
const dashboard = read('public/dashboard.js');
const main = read('electron/main.js');

assert.match(cloud, /export (async )?function mountCloudGateway/);
assert.match(cloud, /export function updateCloudGatewayLiveState/);
for (const api of ['getGatewayStatus', 'beginGatewayEnrollment', 'openGatewayAccount', 'cancelGatewayPairing', 'getGatewayDevices', 'revokeGatewayDevice', 'setGatewayMode', 'getGatewayRecovery']) {
  assert.equal(cloud.includes('relaiDesktop.' + api) || cloud.includes('desktop.' + api), true, 'cloud gateway UI must use ' + api);
  assert.match(preload, new RegExp(api), 'preload must expose ' + api);
}
for (const state of ['pairing_required', 'pairing', 'connected', 'tool_refresh_required', 'device_update_required']) {
  assert.match(cloud, new RegExp(state), 'cloud gateway UI must render ' + state);
}
assert.doesNotMatch(cloud, /Cloudflare|ngrok account key|approval token/i, 'normal cloud UI must not expose infrastructure or direct credentials');
assert.doesNotMatch(cloud, /data-cloud-mode\s+data-cloud-mode=/, 'connection-mode buttons must carry exactly one valued data-cloud-mode attribute');
assert.match(cloud, /data-cloud-mode="cloud"/, 'Cloud switch must send the cloud mode value');
assert.match(cloud, /data-cloud-mode="direct"/, 'Direct switch must send the direct mode value');
assert.match(cloud, /setGatewayMode\(mode\)[\s\S]{0,400}requestDashboardRefresh\(\{ structural: true \}\)/, 'provider switches must structurally refresh the Connection route');
assert.match(cloud, /data-copy-pairing/, 'pairing codes must expose an accessible copy action');
assert.match(cloud, /refreshDeviceRegion\(root, model\.gateway\)/, 'device refresh must update only the device region');
assert.doesNotMatch(cloud, /data-cloud-refresh-devices[^\n]+loadCloudGateway/, 'device refresh must not remount the surrounding Settings page');
assert.match(cloud, /data-cloud-current/, 'the current device must expose a distinct disconnect action');
assert.doesNotMatch(cloud, /revoked \|\| current \? 'disabled'/, 'the current device must not be unconditionally impossible to revoke');
assert.match(cloud, /confirmAction\(/, 'device revocation must require explicit confirmation');
assert.match(cloud, /storedLabel === 'Rel\.AI MCP'/, 'legacy generic app-name device labels must be replaced with a useful device label');
assert.doesNotMatch(direct, /getGatewayStatus|beginGatewayPairing|desktop:gateway/, 'Direct/ngrok owner must not implement cloud gateway controls');
assert.match(connector, /mountCloudGateway/);
assert.match(connector, /updateCloudGatewayLiveState/);
assert.match(preload, /desktop:gateway-status/);
assert.match(dashboard, /onGatewayStatus/);
assert.match(dashboard, /applyGatewayStatusSnapshot/);
assert.doesNotMatch(dashboard, /desktop:gateway-status[\s\S]{0,500}location\.reload/, 'gateway pushes must not reload the page');
assert.match(main, /function pushStatus\(options = \{\}\)/, 'desktop status publishing must support suppressing structural dashboard status events');
assert.match(main, /function applyGatewayStatus[\s\S]*desktop:gateway-status[\s\S]*dashboard: false/, 'gateway status changes must use the dedicated passive dashboard event and suppress generic server-status remounts');
assert.match(main, /displayName: gatewayDeviceDisplayName\(\)/, 'new cloud pairings must register a machine-specific device label');
console.log('Gateway settings ownership, safe bridge, and passive-update contracts passed.');
