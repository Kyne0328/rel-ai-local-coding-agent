import assert from 'node:assert/strict';
import { connectionLayerViews, connectionStateFor, connectionSummary } from '../src/ui/connection-state.js';

const base = {
  connectionState: {
    localService: { status: 'running' },
    publicEndpoint: { status: 'available' },
    chatgptReadiness: { status: 'ready' },
    dashboardUpdates: { status: 'live' }
  }
};

const waiting = connectionStateFor({ ...base, mcpConnection: { status: 'ready' } });
assert.equal(waiting.mcpClient.status, 'ready');
assert.equal(connectionSummary(waiting).label, 'Waiting for host');

const connected = connectionStateFor({ ...base, mcpConnection: { status: 'connected' } });
assert.equal(connectionSummary(connected).label, 'Host active');
assert.equal(connectionSummary(connected).tone, 'ok');

const mismatch = connectionStateFor({ ...base, mcpConnection: { status: 'capability_mismatch' } });
assert.equal(connectionSummary(mismatch).label, 'Tool mismatch');

const degraded = connectionStateFor({ ...base, mcpConnection: { status: 'degraded' } });
assert.equal(connectionSummary(degraded).label, 'Host action required');
assert.equal(connectionSummary(degraded).tone, 'bad');

const reauth = connectionStateFor({ ...base, mcpConnection: { status: 'reauthentication_required' } });
assert.equal(connectionSummary(reauth).label, 'Approval required');

const layers = connectionLayerViews(connected);
assert.equal(layers.some(layer => layer.key === 'mcpClient' && layer.label === 'Active'), true);
assert.equal(layers.length, 5);

console.log('Connection state distinguishes endpoint readiness from stateless MCP host activity.');
