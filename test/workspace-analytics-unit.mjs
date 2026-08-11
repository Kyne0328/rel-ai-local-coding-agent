import assert from 'node:assert/strict';
import { hydrateWorkspaceAnalytics, workspaceAnalyticsHtml } from '../src/ui/features/workspaces/analytics.js';

const scope = {
  toolCalls: 9,
  completed: 8,
  successRate: 87.5,
  averageDuration: 125,
  points: [{ toolCalls: 1 }, { toolCalls: 4 }, { toolCalls: 2 }, { toolCalls: 2 }]
};
const html = workspaceAnalyticsHtml(scope);
assert.match(html, /Last 24 hours/);
assert.match(html, /Tool calls/);
assert.match(html, />9</);
assert.match(html, /87\.5%/);
assert.match(html, /125 ms/);
assert.match(html, /workspace-analytics-sparkline/);

const target = { innerHTML: '', hidden: true };
const root = {
  isConnected: true,
  querySelector(selector) {
    return selector === '[data-workspace-analytics="repo"]' ? target : null;
  }
};
const snapshot = {
  ok: true,
  month: '2026-08',
  totals: { requests: 1, toolCalls: 1, successes: 1, failures: 0, requestBytes: 1, resultBytes: 1, executionMs: 50, activeDays: 1 },
  tools: [], devices: [], workspaces: [{ workspace: 'repo', toolCalls: 1, successes: 1, failures: 0, executionMs: 50 }],
  workspaceDimensions: [{ deviceId: 'device-a', displayName: 'Laptop', workspace: 'repo', workspaceKey: 'device-a::repo', toolCalls: 1, successes: 1, failures: 0, executionMs: 50 }],
  workspaceTools: [],
  series: [{ hour: '2026-08-08T10', requests: 1, toolCalls: 1, successes: 1, failures: 0, requestBytes: 1, resultBytes: 1, executionMs: 50 }],
  toolSeries: [],
  workspaceSeries: [{ hour: '2026-08-08T10', deviceId: 'device-a', workspace: 'repo', workspaceKey: 'device-a::repo', toolCalls: 1, successes: 1, failures: 0, executionMs: 50 }],
  workspaceToolSeries: []
};
const desktop = {
  getGatewayStatus: async () => ({ connectionMode: 'cloud', gateway: { state: 'connected', principalPaired: true } }),
  getGatewayUsage: async () => snapshot
};
assert.equal(await hydrateWorkspaceAnalytics(root, ['repo'], { desktop, now: new Date('2026-08-08T12:00:00.000Z') }), true);
assert.equal(target.hidden, false);
assert.match(target.innerHTML, />1</);
assert.match(target.innerHTML, /100\.0%/);
assert.match(target.innerHTML, /50 ms/);

const unavailableTarget = { innerHTML: '', hidden: true };
const unavailableRoot = { isConnected: true, querySelector: () => unavailableTarget };
assert.equal(await hydrateWorkspaceAnalytics(unavailableRoot, ['repo'], {
  desktop: { getGatewayStatus: async () => ({ connectionMode: 'direct' }), getGatewayUsage: async () => { throw new Error('must not run'); } },
  now: new Date('2026-08-08T12:00:00.000Z')
}), false);
assert.equal(unavailableTarget.hidden, true);

console.log('Workspace mini analytics hydration passed.');
