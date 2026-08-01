import assert from 'node:assert/strict';
import { connectionLayerViews, connectionStateFor, connectionSummary, isMcpAuthenticationReady } from '../src/ui/connection-state.js';

const base = {
  connectionState: {
    localService: { status: 'running' },
    publicEndpoint: { status: 'available' },
    dashboardUpdates: { status: 'live' }
  }
};

const bearerReady = connectionStateFor({
  ...base,
  mcpAuthentication: { status: 'bearer_authorized', oauthApprovalRequired: true },
  mcpConnection: { status: 'ready', activityStatus: 'no_requests' }
});
assert.equal(bearerReady.chatgptReadiness.status, 'bearer_authorized');
assert.equal(bearerReady.mcpClient.status, 'no_requests');
assert.equal(isMcpAuthenticationReady(bearerReady), true);
assert.equal(connectionSummary(bearerReady).label, 'Ready');
const bearerLayers = connectionLayerViews(bearerReady);
assert.equal(bearerLayers.find(layer => layer.key === 'chatgptReadiness')?.label, 'Bearer authorized');
assert.match(bearerLayers.find(layer => layer.key === 'chatgptReadiness')?.description || '', /OAuth clients still require approval/);
assert.equal(bearerLayers.find(layer => layer.key === 'mcpClient')?.label, 'No requests yet');

const active = connectionStateFor({
  ...base,
  mcpAuthentication: { status: 'oauth_authorized' },
  mcpConnection: { status: 'ready', activityStatus: 'active', activeRequestCount: 1, lastRequestMethod: 'tools/call' }
});
assert.equal(connectionSummary(active).label, 'Active now');
assert.equal(connectionSummary(active).tone, 'working');

const recent = connectionStateFor({
  ...base,
  mcpAuthentication: { status: 'oauth_authorized' },
  mcpConnection: { status: 'ready', activityStatus: 'recent', lastRequestMethod: 'tools/list', lastSuccessfulRequestAt: '2026-08-01T04:00:00.000Z' }
});
assert.equal(connectionSummary(recent).label, 'Recently active');
assert.equal(connectionSummary(recent).tone, 'ok');

const failed = connectionStateFor({
  ...base,
  mcpAuthentication: { status: 'bearer_authorized' },
  mcpConnection: { status: 'ready', activityStatus: 'request_failed', lastRequestMethod: 'tools/call' }
});
assert.equal(connectionSummary(failed).label, 'Last request failed');

const mismatch = connectionStateFor({
  ...base,
  mcpAuthentication: { status: 'oauth_authorized' },
  mcpConnection: { status: 'capability_mismatch' }
});
assert.equal(connectionSummary(mismatch).label, 'Tool mismatch');

const degraded = connectionStateFor({
  ...base,
  mcpAuthentication: { status: 'oauth_authorized' },
  mcpConnection: { status: 'degraded' }
});
assert.equal(connectionSummary(degraded).label, 'Host action required');
assert.equal(connectionSummary(degraded).tone, 'bad');

const reauth = connectionStateFor({
  ...base,
  mcpAuthentication: { status: 'authentication_required', oauthApprovalRequired: true },
  mcpConnection: { status: 'ready', activityStatus: 'no_requests' }
});
assert.equal(isMcpAuthenticationReady(reauth), false);
assert.equal(connectionSummary(reauth).label, 'Approval required');

assert.deepEqual(connectionLayerViews(recent).map(layer => layer.title), [
  'Local service',
  'Public endpoint',
  'MCP authentication',
  'MCP activity',
  'Dashboard updates'
]);
assert.equal(connectionLayerViews(recent).find(layer => layer.key === 'publicEndpoint')?.label, 'Published');

const legacyReady = connectionStateFor({
  ...base,
  mcpAuthentication: { status: 'oauth_approved' },
  mcpConnection: { status: 'ready' }
});
assert.equal(legacyReady.mcpClient.status, 'no_requests');

const startingLayers = connectionLayerViews({
  localService: { status: 'starting' },
  publicEndpoint: { status: 'connecting' },
  chatgptReadiness: { status: 'awaiting_authentication' },
  mcpClient: { status: 'reconnecting' },
  dashboardUpdates: { status: 'reconnecting' }
});
for (const key of ['localService', 'publicEndpoint', 'chatgptReadiness', 'mcpClient', 'dashboardUpdates']) {
  assert.equal(startingLayers.find(layer => layer.key === key)?.tone, 'working', `${key} progress must use the information tone`);
}

console.log('Connection state separates MCP authentication from stateless request activity.');
