import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLICATION_NAV_ITEMS, MOBILE_NAV_ITEMS, SETTINGS_NAV_ITEMS, SYSTEM_NAV_ITEMS, WORK_NAV_ITEMS } from '../src/ui/navigation-catalog.js';
import { connectionLayerViews, connectionSummary } from '../src/ui/connection-state.js';
import { ERROR_CODES, TERMINOLOGY, deriveConnectionState, errorGuidance, errorPayload } from '../src/desktopUxContracts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

assert.deepEqual(TERMINOLOGY, {
  connection: 'Connection',
  approvalToken: 'Approval token',
  sessions: 'Sessions',
  activity: 'Activity',
  tools: 'Tools',
  workspace: 'Workspace'
});
assert.deepEqual(WORK_NAV_ITEMS.map(item => item.label), ['Overview', 'Sessions', 'Workspaces', 'Activity']);
assert.deepEqual(SYSTEM_NAV_ITEMS.map(item => item.label), ['Connection', 'Processes', 'Diagnostics', 'Tools', 'Usage']);
assert.deepEqual(APPLICATION_NAV_ITEMS.map(item => item.label), ['System', 'Settings']);
assert.deepEqual(MOBILE_NAV_ITEMS.map(item => item.label), ['Overview', 'Sessions', 'Workspaces', 'Activity', 'Settings']);
assert.deepEqual(SETTINGS_NAV_ITEMS.map(item => item.label), ['Preferences', 'Skills', 'Application', 'Advanced', 'About']);

for (const code of [
  ERROR_CODES.CONFIGURATION_INVALID,
  ERROR_CODES.LOCAL_PORT_IN_USE,
  ERROR_CODES.PUBLIC_ENDPOINT_FAILED,
  ERROR_CODES.APPROVAL_TOKEN_REQUIRED,
  ERROR_CODES.APPROVAL_TOKEN_REJECTED
]) assert.equal(errorGuidance(code).href, '#connection');
assert.equal(errorGuidance(ERROR_CODES.DIAGNOSTICS_UNAVAILABLE).href, '#connection');
assert.equal(errorGuidance(ERROR_CODES.UPDATE_FAILED).href, '#diagnostics');
assert.equal(errorPayload(ERROR_CODES.WORKSPACE_UNAVAILABLE, 'missing').recovery.href, '#workspaces');

const running = deriveConnectionState({
  serverRunning: true,
  tunnelStatus: 'running',
  mcpUrl: 'https://example.ngrok-free.dev/mcp',
  dashboardUpdateStatus: 'live'
});
assert.equal(running.localService.status, 'running');
assert.equal(running.publicEndpoint.status, 'available');
assert.equal(running.chatgptReadiness.status, 'ready');

const ready = {
  ...running,
  chatgptReadiness: { status: 'oauth_authorized' },
  mcpClient: { status: 'idle' }
};
assert.deepEqual(connectionLayerViews(ready).map(layer => layer.title), ['Connection service', 'Secure endpoint', 'Authorization', 'Client and tools', 'Dashboard updates']);
assert.equal(connectionSummary(ready).tone, 'ok');

const wizard = read('electron/renderer/wizard.html');
assert.equal((wizard.match(/data-step="\d+"/g) || []).length, 3);
assert.match(wizard, /Connect ChatGPT/);
assert.match(wizard, /Secure this device/);
assert.match(wizard, /Ready/);
assert.match(read('electron/window-security.js'), /contextIsolation: true/);
assert.match(read('electron/window-security.js'), /sandbox: true/);
assert.doesNotMatch(read('src/ui/features/settings/index.js'), /connection|diagnostics|tools-validation/i);

console.log('Desktop UX contracts passed.');

