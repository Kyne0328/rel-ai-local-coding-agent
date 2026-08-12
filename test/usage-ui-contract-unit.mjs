import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUsageModel, currentUsageMonth } from '../src/ui/features/usage/index.js';
import { analyticsBounds, analyticsRangeScope } from '../src/ui/features/usage/range-model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const navigationCatalog = read('src/ui/navigation-catalog.js');
const dashboard = read('public/dashboard.js');
const preload = read('electron/preload.cjs');
const ipc = read('electron/ipc-handlers-dashboard.js');
const usageSource = read('src/ui/features/usage/index.js');
const usageRender = read('src/ui/features/usage/render.js');
const usageRange = read('src/ui/features/usage/range-model.js');
const usageCombined = `${usageSource}\n${usageRender}\n${usageRange}`;

assert.match(navigationCatalog, /route\(['"]usage['"], ['"]Analytics['"]/);
assert.match(navigationCatalog, /stored on this device/i);
assert.match(dashboard, /usage: element => mountSystemRoute\(element, ['"]usage['"]\)/);
assert.match(preload, /getLocalUsage: month => ipcRenderer\.invoke\(['"]desktop:analytics:local['"], month\)/);
assert.doesNotMatch(preload, /getGatewayUsage|desktop:gateway:usage/);
assert.match(ipc, /desktop:analytics:local/);
assert.match(ipc, /Analytics month must use YYYY-MM/);
assert.doesNotMatch(ipc, /gateway/i);
assert.match(usageSource, /desktop\.getLocalUsage/);
assert.doesNotMatch(usageSource, /getGatewayUsage|connectionMode|pairing_required|cloudUsageAvailability/i);
assert.doesNotMatch(usageSource, /fetch\(|DASHBOARD_DATA_URL|auditTail|taskActivity/);
assert.match(usageSource, /Privacy-safe aggregate MCP activity recorded only on this device/i);

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
assert.match(usageCombined, /Raw error codes and messages are not stored in analytics/);

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

console.log('Local analytics UI and privacy contracts passed.');
