import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUsageModel, currentUsageMonth } from '../src/ui/features/usage/index.js';
import { analyticsBounds, analyticsRangeScope } from '../src/ui/features/usage/range-model.js';
import { loadAnalyticsData } from '../src/ui/features/usage/data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const navigationCatalog = read('src/ui/navigation-catalog.js');
const dashboard = read('public/dashboard.js');
const preload = read('electron/preload.cjs');
const ipc = read('electron/ipc-handlers-dashboard.js');
const usageSource = read('src/ui/features/usage/index.js');
const usageRender = read('src/ui/features/usage/render.js');
const usageRange = read('src/ui/features/usage/range-model.js');
const usageData = read('src/ui/features/usage/data.js');
const usageCombined = `${usageSource}\n${usageRender}\n${usageRange}\n${usageData}`;

assert.match(navigationCatalog, /route\(['"]usage['"], ['"]Analytics['"]/);
assert.match(navigationCatalog, /local activity, tool usage, and workspace trends/i);
assert.match(dashboard, /usage: element => mountSystemRoute\(element, ['"]usage['"]\)/);
assert.match(preload, /getLocalUsage: month => ipcRenderer\.invoke\(['"]desktop:analytics:local['"], month\)/);
assert.doesNotMatch(preload, /getGatewayUsage|desktop:gateway:usage/);
assert.match(ipc, /desktop:analytics:local/);
assert.match(ipc, /Analytics month must use YYYY-MM/);
assert.doesNotMatch(ipc, /gateway/i);
assert.match(usageData, /desktop\.getLocalUsage/);
assert.doesNotMatch(`${usageSource}\n${usageData}`, /getGatewayUsage|connectionMode|pairing_required|cloudUsageAvailability/i);
assert.doesNotMatch(`${usageSource}\n${usageData}`, /fetch\(|DASHBOARD_DATA_URL|auditTail|taskActivity/);
assert.match(usageSource, /Local activity only\. Prompts, paths, command output, and tool results are not stored/i);
assert.match(usageSource, /import \{ esc as escapeHtml \} from '\.\.\/\.\.\/utils\.js'/);
assert.doesNotMatch(usageSource, /function escapeHtml\(/);
assert.match(usageRender, /import \{ esc \} from '\.\.\/\.\.\/utils\.js'/);
assert.doesNotMatch(usageRender, /function esc\(/);
assert.match(usageSource, /data-usage-status role="status" aria-live="polite" aria-atomic="true"/);
assert.doesNotMatch(usageSource, /data-usage-content aria-live=/);
assert.match(usageSource, /Analytics updated for \$\{bounds\.label\}/);
assert.match(usageRender, /aria-pressed="\$\{i \? 'false' : 'true'\}"/);
assert.match(usageRender, /setAttribute\('aria-pressed', String\(active\)\)/);
assert.match(usageRender, /Overall trend \$\{trend\}/, 'Analytics charts must expose the computed trend to assistive technology');
assert.match(usageRender, /Peak \$\{formatChartValue\(peak, metricLabel\)\}/, 'Analytics charts must expose the peak value to assistive technology');

for (const label of ['Tool calls', 'Successful', 'Failed', 'Execution time', 'Avg tool time', 'Active days']) {
  assert.match(usageCombined, new RegExp(label), `Analytics must render ${label}.`);
}
for (const field of ['requests', 'toolCalls', 'successes', 'failures', 'requestBytes', 'resultBytes', 'executionMs', 'activeDays']) {
  assert.match(usageCombined, new RegExp(`\\b${field}\\b`), `Analytics must consume ${field}.`);
}
assert.match(usageSource, /Analytics unavailable/);
assert.match(usageSource, /Retry/);
assert.match(usageSource, /Refresh/);
assert.match(usageCombined, /Failure categories/);
assert.match(usageCombined, /Raw error messages are not stored/);
assert.doesNotMatch(usageRender, /Trend starts now|Completed outcomes|Workspace position|usage-fact-strip|<h3>Outcomes<\/h3>/);

const snapshot = buildUsageModel({
  ok: true,
  source: 'local',
  month: '2026-08',
  totals: { requests: 8, toolCalls: 5, successes: 4, failures: 1, requestBytes: 1200, resultBytes: 3400, executionMs: 5600, activeDays: 2 },
  tools: [{ tool: 'relai_read', toolCalls: 3, successes: 3, failures: 0, executionMs: 900 }],
  devices: [{ deviceId: 'local', displayName: 'This device', toolCalls: 5, successes: 4, failures: 1, executionMs: 5600 }],
  workspaces: [{ workspace: 'repo', toolCalls: 5, successes: 4, failures: 1, executionMs: 5600 }],
  failureCategories: [{ category: 'SENSITIVE_PATH_RESTRICTED', failures: 1 }]
}, '2026-08');
assert.equal(snapshot.source, 'local');
assert.equal(snapshot.totals.toolCalls, 5);
assert.equal(snapshot.tools[0].tool, 'relai_read');
assert.deepEqual(snapshot.failureCategories, [{ category: 'runtime', failures: 1 }]);
assert.equal(currentUsageMonth(new Date('2026-08-08T00:00:00.000Z')), '2026-08');
assert.throws(() => buildUsageModel({ ok: true, month: '2026-08', totals: { requests: -1 } }), /Analytics unavailable|invalid requests/);

const bounds = analyticsBounds('24h', { now: new Date('2026-08-08T12:00:00.000Z') });
assert.equal(bounds.start.toISOString(), '2026-08-07T12:00:00.000Z');
const ranged = analyticsRangeScope([buildUsageModel({
  ok: true,
  source: 'local',
  month: '2026-08',
  totals: { requests: 2, toolCalls: 2, successes: 1, failures: 1, requestBytes: 10, resultBytes: 20, executionMs: 100, activeDays: 1 },
  tools: [], devices: [], workspaces: [],
  series: [{ hour: '2026-08-08T10', requests: 2, toolCalls: 2, successes: 1, failures: 1, requestBytes: 10, resultBytes: 20, executionMs: 100 }],
  toolSeries: [], workspaceSeries: [], workspaceToolSeries: [],
  failureCategorySeries: [{ hour: '2026-08-08T10', category: 'policy', failures: 1 }]
}, '2026-08')], bounds);
assert.equal(ranged.toolCalls, 2);
assert.equal(ranged.averageDuration, 50);
assert.deepEqual(ranged.failureCategories, [{ category: 'policy', failures: 1 }]);

const loaded = await loadAnalyticsData({
  desktop: { getLocalUsage: async () => ({
    ok: true,
    source: 'local',
    month: '2026-08',
    totals: { requests: 2, toolCalls: 2, successes: 2, failures: 0, requestBytes: 0, resultBytes: 0, executionMs: 120, activeDays: 1 },
    tools: [], devices: [], workspaces: [{ workspace: 'repo', toolCalls: 2, successes: 2, failures: 0, executionMs: 120 }],
    workspaceDimensions: [{ deviceId: 'local', displayName: 'This device', workspace: 'repo', workspaceKey: 'local::repo', toolCalls: 2, successes: 2, failures: 0, executionMs: 120 }],
    workspaceTools: [],
    series: [{ hour: '2026-08-08T10', requests: 2, toolCalls: 2, successes: 2, failures: 0, requestBytes: 0, resultBytes: 0, executionMs: 120 }],
    toolSeries: [], workspaceSeries: [{ hour: '2026-08-08T10', deviceId: 'local', workspace: 'repo', workspaceKey: 'local::repo', toolCalls: 2, successes: 2, failures: 0, executionMs: 120 }], workspaceToolSeries: []
  }) },
  range: '24h',
  now: new Date('2026-08-08T12:00:00.000Z')
});
assert.equal(loaded.current.toolCalls, 2);
assert.equal(loaded.current.workspaces[0].workspace, 'repo');

console.log('Local analytics UI and privacy contracts passed.');
