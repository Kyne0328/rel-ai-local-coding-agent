import assert from 'node:assert/strict';

globalThis.location = { hash: '#home' };
const { homeAnalyticsHtml, hydrateHomeAnalytics } = await import('../src/ui/features/home/index.js');

const scope = {
  kind: 'all',
  toolCalls: 18,
  successes: 16,
  failures: 2,
  completed: 18,
  successRate: 88.888,
  averageDuration: 240,
  workspaces: [
    { workspace: 'rel-ai-mcp', toolCalls: 12 },
    { workspace: 'other', toolCalls: 6 }
  ],
  tools: [{ tool: 'relai_read', toolCalls: 9 }],
  points: [{ toolCalls: 1 }, { toolCalls: 5 }, { toolCalls: 2 }, { toolCalls: 10 }]
};

const html = homeAnalyticsHtml(scope);
assert.match(html, /Last 24 hours/);
assert.match(html, /Tool calls/);
assert.match(html, />18</);
assert.match(html, /88\.9%/);
assert.match(html, /240 ms/);
assert.match(html, /Active workspaces/);
assert.match(html, />2</);
assert.match(html, /Hourly activity/);
assert.match(html, /home-analytics-area/);
assert.match(html, /Latest hour 10 calls/);
assert.match(html, /Overall trend increasing/);
assert.match(html, /may include recovered work/);
assert.doesNotMatch(html, /Privacy/);

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
  totals: { requests: 1, toolCalls: 1, successes: 1, failures: 0, requestBytes: 0, resultBytes: 0, executionMs: 50, activeDays: 1 },
  tools: [{ tool: 'relai_read', toolCalls: 1, successes: 1, failures: 0, executionMs: 50 }],
  devices: [],
  workspaces: [{ workspace: 'repo', toolCalls: 1, successes: 1, failures: 0, executionMs: 50 }],
  workspaceDimensions: [{ deviceId: 'local', displayName: 'This device', workspace: 'repo', workspaceKey: 'local::repo', toolCalls: 1, successes: 1, failures: 0, executionMs: 50 }],
  workspaceTools: [],
  series: [{ hour: '2026-08-08T10', requests: 1, toolCalls: 1, successes: 1, failures: 0, requestBytes: 0, resultBytes: 0, executionMs: 50 }],
  toolSeries: [{ hour: '2026-08-08T10', tool: 'relai_read', toolCalls: 1, successes: 1, failures: 0, executionMs: 50 }],
  workspaceSeries: [{ hour: '2026-08-08T10', deviceId: 'local', workspace: 'repo', workspaceKey: 'local::repo', toolCalls: 1, successes: 1, failures: 0, executionMs: 50 }],
  workspaceToolSeries: []
};
assert.equal(await hydrateHomeAnalytics(root, {
  desktop: { getLocalUsage: async () => snapshot },
  now: new Date('2026-08-08T12:00:00.000Z')
}), true);
assert.match(target.innerHTML, /Hourly activity/);
assert.match(target.innerHTML, /100\.0%/);

console.log('Dashboard analytics summary passed.');
