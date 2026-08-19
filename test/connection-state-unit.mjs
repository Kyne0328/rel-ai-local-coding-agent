import assert from 'node:assert/strict';
import { connectionLayerViews, connectionStateFor, connectionSummary, isMcpAuthenticationReady } from '../src/ui/connection-state.js';

const base = {
  connectionState: {
    localService: { status: 'running' },
    publicEndpoint: { status: 'available' },
    dashboardUpdates: { status: 'live' }
  }
};

const ready = connectionStateFor({
  ...base,
  mcpAuthentication: { status: 'bearer_authorized' },
  mcpConnection: { status: 'ready', activityStatus: 'no_requests' }
});
assert.equal(ready.chatgptReadiness.status, 'ready');
assert.equal(ready.mcpClient.status, 'no_requests');
assert.equal(isMcpAuthenticationReady(ready), true);
assert.equal(connectionSummary(ready).label, 'Ready');
assert.equal(connectionSummary(ready).message, 'This computer is connected and ready for ChatGPT.');
const readyLayers = connectionLayerViews(ready);
assert.equal(readyLayers.find(layer => layer.key === 'chatgptReadiness')?.label, 'Ready');
assert.equal(readyLayers.find(layer => layer.key === 'mcpClient')?.label, 'Ready');

const active = connectionStateFor({
  ...base,
  mcpConnection: { status: 'ready', activityStatus: 'active', activeRequestCount: 1, lastRequestMethod: 'tools/call' }
});
assert.equal(connectionSummary(active).label, 'Active now');
assert.equal(connectionSummary(active).title, 'ChatGPT is using Rel.AI');
assert.equal(connectionSummary(active).tone, 'working');

const recent = connectionStateFor({
  ...base,
  mcpConnection: { status: 'ready', activityStatus: 'recent', lastRequestMethod: 'tools/list', lastSuccessfulRequestAt: '2026-08-01T04:00:00.000Z' }
});
assert.equal(connectionSummary(recent).label, 'Recently active');
assert.equal(connectionSummary(recent).tone, 'ok');

const failed = connectionStateFor({
  ...base,
  mcpConnection: { status: 'ready', activityStatus: 'request_failed', lastRequestMethod: 'tools/call' }
});
assert.equal(connectionSummary(failed).label, 'Last request failed');
assert.equal(connectionSummary(failed).title, 'The last ChatGPT request failed');
assert.doesNotMatch(connectionSummary(failed).message, /tools\//i);
assert.match(connectionSummary(failed).message, /local MCP service and Secure MCP Tunnel remain ready for another request/i);

const legacyClientState = connectionStateFor({
  ...base,
  mcpConnection: { status: 'capability_mismatch' }
});
assert.equal(legacyClientState.mcpClient.status, 'no_requests');
assert.equal(connectionSummary(legacyClientState).label, 'Ready');

const unavailable = connectionStateFor({
  connectionState: {
    localService: { status: 'running' },
    publicEndpoint: { status: 'unavailable' },
    dashboardUpdates: { status: 'live' }
  },
  mcpConnection: { status: 'ready', activityStatus: 'no_requests' }
});
assert.equal(unavailable.chatgptReadiness.status, 'unavailable');
assert.equal(isMcpAuthenticationReady(unavailable), false);
assert.equal(connectionSummary(unavailable).label, 'Needs attention');
assert.equal(connectionSummary(unavailable).title, 'ChatGPT connection unavailable');
assert.doesNotMatch(connectionSummary(unavailable).message, /Tunnel ID|API key|MCP/i);

assert.deepEqual(connectionLayerViews(recent).map(layer => layer.title), [
  'Local MCP service',
  'OpenAI Secure MCP Tunnel',
  'Ready for ChatGPT',
  'MCP activity',
  'Dashboard updates'
]);
assert.equal(connectionLayerViews(recent).find(layer => layer.key === 'publicEndpoint')?.label, 'Connected');

const startingLayers = connectionLayerViews({
  localService: { status: 'starting' },
  publicEndpoint: { status: 'connecting' },
  chatgptReadiness: { status: 'unavailable' },
  mcpClient: { status: 'starting' },
  dashboardUpdates: { status: 'reconnecting' }
});
for (const key of ['localService', 'publicEndpoint', 'mcpClient']) {
  assert.equal(startingLayers.find(layer => layer.key === key)?.tone, 'working', `${key} progress must use the information tone`);
}

console.log('Connection state reflects Secure MCP Tunnel readiness and stateless request activity.');
