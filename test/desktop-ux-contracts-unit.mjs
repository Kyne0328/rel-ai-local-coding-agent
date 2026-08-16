import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLICATION_NAV_ITEMS, MOBILE_NAV_ITEMS, SETTINGS_NAV_ITEMS, SYSTEM_NAV_ITEMS, WORK_NAV_ITEMS } from '../src/ui/navigation-catalog.js';
import { connectionLayerViews, connectionSummary } from '../src/ui/connection-state.js';
import { ERROR_CODES, TERMINOLOGY, deriveConnectionState, errorGuidance, errorPayload } from '../src/desktopUxContracts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

assert.deepEqual(TERMINOLOGY, { connection: 'Connection', sessions: 'Tasks', activity: 'Activity', tools: 'ChatGPT tools', workspace: 'Project' });
assert.deepEqual(WORK_NAV_ITEMS.map(item => item.label), ['Overview', 'Tasks', 'Projects', 'Activity']);
assert.deepEqual(SYSTEM_NAV_ITEMS.map(item => item.label), ['Connection', 'Running commands', 'Troubleshooting', 'ChatGPT tools', 'Analytics']);
assert.deepEqual(APPLICATION_NAV_ITEMS.map(item => item.label), ['Advanced', 'Settings']);
assert.deepEqual(MOBILE_NAV_ITEMS.map(item => item.label), ['Overview', 'Tasks', 'Projects', 'Activity', 'Advanced', 'Settings']);
assert.deepEqual(SETTINGS_NAV_ITEMS.map(item => item.label), ['General', 'App', 'About']);

for (const code of [ERROR_CODES.CONFIGURATION_INVALID, ERROR_CODES.LOCAL_PORT_IN_USE, ERROR_CODES.SECURE_TUNNEL_FAILED, ERROR_CODES.TUNNEL_AUTHENTICATION_FAILED, ERROR_CODES.TUNNEL_ACCESS_DENIED, ERROR_CODES.TUNNEL_NOT_FOUND, ERROR_CODES.PUBLIC_ENDPOINT_FAILED]) assert.equal(errorGuidance(code).href, '#connection');
assert.equal(errorGuidance(ERROR_CODES.DIAGNOSTICS_UNAVAILABLE).href, '#connection');
assert.equal(errorGuidance(ERROR_CODES.UPDATE_FAILED).href, '#diagnostics');
assert.equal(errorPayload(ERROR_CODES.WORKSPACE_UNAVAILABLE, 'missing').recovery.href, '#workspaces');

const running = deriveConnectionState({ serverRunning: true, tunnelStatus: 'running', tunnelId: 'tunnel_12345678', dashboardUpdateStatus: 'live' });
assert.equal(running.localService.status, 'running');
assert.equal(running.publicEndpoint.status, 'available');
assert.equal(running.chatgptReadiness.status, 'ready');
const degraded = deriveConnectionState({ serverRunning: true, tunnelStatus: 'degraded', errorCode: ERROR_CODES.TUNNEL_CONNECTION_INTERRUPTED, error: 'retrying' });
assert.equal(degraded.publicEndpoint.status, 'degraded');
assert.equal(degraded.chatgptReadiness.status, 'unavailable');
assert.equal(connectionSummary({ ...degraded, mcpClient: { status: 'idle' } }).tone, 'warn');
const ready = { ...running, mcpClient: { status: 'idle' } };
assert.deepEqual(connectionLayerViews(ready).map(layer => layer.title), ['Local MCP service', 'OpenAI Secure MCP Tunnel', 'Ready for ChatGPT', 'MCP activity', 'Dashboard updates']);
assert.equal(connectionSummary(ready).tone, 'ok');

const wizard = read('electron/renderer/wizard.html');
assert.match(wizard, /Connect Rel\.AI to ChatGPT/);
assert.match(wizard, /id="tunnelIdInput"/);
assert.match(wizard, /id="tunnelApiKeyInput"/);
assert.match(wizard, /id="runtimeKeyToggle"[^>]*aria-controls="tunnelApiKeyInput"/);
assert.match(wizard, /id="connectBtn"/);
assert.doesNotMatch(wizard, /ngrok|Cloud gateway|approval token|pairing code/i);
assert.match(read('electron/window-security.js'), /contextIsolation: true/);
assert.match(read('electron/window-security.js'), /sandbox: true/);
assert.doesNotMatch(read('src/ui/features/settings/index.js'), /settings\/connection|settings\/diagnostics|tools-validation/i);

console.log('Tunnel-only desktop UX contracts passed.');
