import assert from 'node:assert/strict';

globalThis.location = { hash: '#home' };
const { homeAnalyticsHtml, hydrateHomeAnalytics, overviewWorkspaceStatus } = await import('../src/ui/features/home/index.js');

const scope = {
  kind: 'all',
  toolCalls: 18,
  completed: 18,
  reliabilityCalls: 18,
  reliableCalls: 17,
  reliabilityRate: 94.444,
  infrastructureFailures: 1,
  averageDuration: 240,
  workspaces: [
    { workspace: 'rel-ai-mcp', toolCalls: 12 },
    { workspace: 'other', toolCalls: 6 }
  ],
  points: [{ toolCalls: 1 }, { toolCalls: 5 }, { toolCalls: 2 }, { toolCalls: 10 }]
};

assert.equal(overviewWorkspaceStatus({ alias: 'app', operational: { exists: true } }), 'ready');
assert.equal(overviewWorkspaceStatus({ alias: 'app', operational: { exists: false } }), 'unavailable');
assert.equal(overviewWorkspaceStatus({ alias: 'app', operational: { exists: true } }, [{ workspace: 'app', severity: 'error' }]), 'needs attention');
assert.equal(overviewWorkspaceStatus({ alias: 'app', operational: { currentActivity: 'Editing' } }), 'active');

const html = homeAnalyticsHtml(scope);
assert.match(html, /Last 24 hours/);
assert.match(html, /Actions/);
assert.match(html, />18</);
assert.match(html, /Reliable actions/);
assert.match(html, /94\.4%/);
assert.match(html, /240 ms/);
assert.match(html, /Active projects/);
assert.match(html, />2</);
assert.match(html, /Most active project: rel-ai-mcp/);
assert.match(html, /Hourly activity/);
assert.match(html, /home-analytics-area/);
assert.match(html, /Latest hour 10 actions/);
assert.match(html, /Overall trend increasing/);
assert.match(html, /1 system error/);
assert.match(html, /View analytics/);

const target = {
  innerHTML: '',
  dataset: { taskBoundary: '' },
  isConnected: true,
  setAttribute() {}
};
const root = { querySelector: selector => selector === '[data-home-analytics]' ? target : null };
const snapshot = {
  ok: true,
  source: 'local',
  month: '2026-08',
  totals: { requests: 1, toolCalls: 1, successes: 1, failures: 0, requestBytes: 0, resultBytes: 0, executionMs: 50, activeDays: 1, reliabilityCalls: 1, reliableCalls: 1, infrastructureFailures: 0 },
  tools: [{ tool: 'relai_read', toolCalls: 1, successes: 1, failures: 0, executionMs: 50, reliabilityCalls: 1, reliableCalls: 1, infrastructureFailures: 0 }],
  devices: [],
  workspaces: [{ workspace: 'repo', toolCalls: 1, successes: 1, failures: 0, executionMs: 50, reliabilityCalls: 1, reliableCalls: 1, infrastructureFailures: 0 }],
  workspaceDimensions: [{ deviceId: 'local', displayName: 'This device', workspace: 'repo', workspaceKey: 'local::repo', toolCalls: 1, successes: 1, failures: 0, executionMs: 50, reliabilityCalls: 1, reliableCalls: 1, infrastructureFailures: 0 }],
  workspaceTools: [],
  series: [{ hour: '2026-08-08T10', requests: 1, toolCalls: 1, successes: 1, failures: 0, requestBytes: 0, resultBytes: 0, executionMs: 50, reliabilityCalls: 1, reliableCalls: 1, infrastructureFailures: 0 }],
  toolSeries: [{ hour: '2026-08-08T10', tool: 'relai_read', toolCalls: 1, successes: 1, failures: 0, executionMs: 50, reliabilityCalls: 1, reliableCalls: 1, infrastructureFailures: 0 }],
  workspaceSeries: [{ hour: '2026-08-08T10', deviceId: 'local', workspace: 'repo', workspaceKey: 'local::repo', toolCalls: 1, successes: 1, failures: 0, executionMs: 50, reliabilityCalls: 1, reliableCalls: 1, infrastructureFailures: 0 }],
  workspaceToolSeries: []
};
assert.equal(await hydrateHomeAnalytics(root, {
  desktop: { getLocalUsage: async () => snapshot },
  now: new Date('2026-08-08T12:00:00.000Z')
}), true);
assert.match(target.innerHTML, /Hourly activity/);
assert.match(target.innerHTML, /100\.0%/);
assert.match(target.innerHTML, /No system errors/);

console.log('Overview analytics preview passed.');
