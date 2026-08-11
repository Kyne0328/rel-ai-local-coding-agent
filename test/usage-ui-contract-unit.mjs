import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const navigationCatalog = read('src/ui/navigation-catalog.js');
const dashboardData = read('src/http/dashboardData.js');
const dashboard = read('public/dashboard.js');
const routePolicy = read('src/ui/route-policy.js');
const preload = read('electron/preload.cjs');
const ipc = read('electron/ipc-handlers.js');
const electronMain = read('electron/main.js');
const systemSource = read('src/ui/features/system/index.js');
const usageSource = read('src/ui/features/usage/index.js');
const usageRenderSource = read('src/ui/features/usage/render.js');
const usageRangeSource = read('src/ui/features/usage/range-model.js');
const usageCombinedSource = `${usageSource}\n${usageRenderSource}\n${usageRangeSource}`;
const css = read('src/ui/features/usage/styles.css');

const { buildUsageModel, currentUsageMonth } = await import('../src/ui/features/usage/index.js');
const { analyticsBounds, analyticsRangeScope } = await import('../src/ui/features/usage/range-model.js');

assert.match(navigationCatalog, /route\(['"]usage['"], ['"]Analytics['"]/);
assert.match(navigationCatalog, /Cloud or this device/, 'Analytics navigation copy must describe both Cloud and local aggregate sources');
assert.match(routePolicy, /['"]usage['"]/);
assert.match(dashboard, /usage: element => mountSystemRoute\(element, ['"]usage['"]\)/, 'Usage must route through the lazy System feature shell');
assert.match(systemSource, /import \{ mountUsage \} from ['"]\.\.\/usage\/index\.js['"]/, 'System must mount the Usage analytics feature');
assert.doesNotMatch(dashboardData, /gatewayUsage|usageSnapshot|usageTotals|usage_tool|usage_device|usage_workspace/, 'aggregate dashboard payload must not include Cloud usage');
assert.match(dashboard, /case ['"]usage['"]:[\s\S]{0,160}payload = route/, 'Usage fingerprint must not depend on aggregate dashboard data');

assert.match(preload, /getGatewayUsage: month => ipcRenderer\.invoke\(['"]desktop:gateway:usage['"], month\)/);
assert.match(preload, /getLocalUsage: month => ipcRenderer\.invoke\(['"]desktop:analytics:local['"], month\)/);
assert.match(ipc, /desktop:gateway:usage/);
assert.match(ipc, /desktop:analytics:local/);
assert.match(ipc, /Usage month must use YYYY-MM/);
assert.match(electronMain, /GATEWAY_NOT_CONNECTED/, 'Electron main must return a structured unavailable result when Cloud disconnects during a usage request');
assert.match(electronMain, /Rel\.AI Cloud is not connected\./, 'Electron main must not leak the raw remote-method gateway exception');
assert.match(usageSource, /desktop\.getLocalUsage/);
assert.match(usageSource, /desktop\.getGatewayUsage/);
assert.match(usageSource, /usageReader=direct\?desktop\.getLocalUsage:desktop\.getGatewayUsage/, 'Analytics must select local aggregates in Direct mode and Cloud aggregates in Cloud mode');
assert.match(usageSource, /pairing_required|pairing required/i, 'Usage must recognize the Cloud pairing-required state before requesting usage');
assert.match(usageSource, /if\(!direct\).*cloudUsageAvailability\(status\)/, 'Analytics must gate Cloud availability only for Cloud mode');
assert.doesNotMatch(usageSource, /fetch\(|DASHBOARD_DATA_URL|auditTail|taskActivity/, 'Usage must not fabricate totals from local dashboard/activity data');

for (const label of ['MCP requests', 'Tool calls', 'Successful', 'Failed', 'Data sent', 'Data returned', 'Execution time', 'Active days']) {
  assert.match(usageCombinedSource, new RegExp(label), `Analytics must render exact metric label: ${label}`);
}
for (const field of ['requests', 'toolCalls', 'successes', 'failures', 'requestBytes', 'resultBytes', 'executionMs', 'activeDays']) {
  assert.match(usageCombinedSource, new RegExp(`\\b${field}\\b`), `Analytics must consume exact gateway total ${field}`);
}
for (const breakdown of ['tools', 'devices', 'workspaces']) {
  assert.match(usageCombinedSource, new RegExp(`snapshot\\.${breakdown}|usage\\.${breakdown}|model\\.${breakdown}|${breakdown}`), `Analytics must render ${breakdown} breakdowns`);
}
assert.match(usageSource, /Usage unavailable|usage-unavailable/i);
assert.doesNotMatch(usageSource, /Cloud transport analytics are unavailable while Direct connection mode is active\./);
assert.match(usageCombinedSource, /Local aggregate|privacy-safe aggregates|source === ['"]local['"]/, 'Direct mode must render local aggregate analytics instead of a Cloud-unavailable state');
assert.match(usageSource, /Retry/);
assert.match(usageSource, /data-usage-range/);
assert.match(usageSource, /Last 24 hours|ANALYTICS_RANGES/);
assert.match(usageCombinedSource, /usage-sparkline/);
assert.match(usageCombinedSource, /Activity over time/);
assert.match(usageCombinedSource, /Failure categories/);
assert.match(usageCombinedSource, /Raw error codes and messages are not stored in analytics/);
assert.match(usageSource, /Refresh/);
assert.doesNotMatch(usageSource, /Estimated Rel\.AI payload tokens|ChatGPT model tokens|billing token|context-window token/i, 'No token card should render because the gateway returns no estimate');
assert.match(css, /\.usage-page\b/);
assert.match(css, /\.usage-metrics\b/);
assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.usage-/);

const model = buildUsageModel({
  ok: true,
  month: '2026-08',
  totals: { requests: 8, toolCalls: 5, successes: 4, failures: 1, requestBytes: 1200, resultBytes: 3400, executionMs: 5600, activeDays: 2 },
  tools: [{ tool: 'relai_read', toolCalls: 3, successes: 3, failures: 0, executionMs: 900 }],
  devices: [{ deviceId: 'device-a', displayName: 'Laptop', toolCalls: 5, successes: 4, failures: 1, executionMs: 5600 }],
  workspaces: [{ workspace: 'repo', toolCalls: 5, successes: 4, failures: 1, executionMs: 5600 }],
  failureCategories: [{ category: 'SENSITIVE_PATH_RESTRICTED', failures: 1 }]
}, '2026-08');
assert.deepEqual(model.totals, { requests: 8, toolCalls: 5, successes: 4, failures: 1, requestBytes: 1200, resultBytes: 3400, executionMs: 5600, activeDays: 2 });
assert.equal(model.tools[0].tool, 'relai_read');
assert.equal(model.devices[0].displayName, 'Laptop');
assert.equal(model.workspaces[0].workspace, 'repo');
assert.deepEqual(model.failureCategories, [{ category: 'runtime', failures: 1 }], 'unknown/raw backend category strings must never become UI labels');
const legacyBreakdowns = buildUsageModel({
  ok: true,
  month: '2026-08',
  totals: { requests: 2, toolCalls: 2, successes: 1, failures: 1, requestBytes: 10, resultBytes: 20, executionMs: 30, activeDays: 1 },
  tools: [{ tool: 'relai_exec', calls: 2, successes: 1, failures: 1, executionMs: 30 }],
  devices: [{ deviceId: 'legacy-device', calls: 2, successes: 1, failures: 1, executionMs: 30 }],
  workspaces: [{ workspace: 'legacy-repo', calls: 2, successes: 1, failures: 1, executionMs: 30 }]
}, '2026-08');
assert.equal(legacyBreakdowns.tools[0].toolCalls, 2, 'legacy calls rows must normalize to toolCalls');
assert.equal(legacyBreakdowns.devices[0].toolCalls, 2);
assert.equal(legacyBreakdowns.workspaces[0].toolCalls, 2);
assert.equal(currentUsageMonth(new Date('2026-08-08T00:00:00.000Z')), '2026-08');
assert.equal(buildUsageModel({ ok: true, source: 'local', month: '2026-08', totals: { requests: 0, toolCalls: 0, successes: 0, failures: 0, requestBytes: 0, resultBytes: 0, executionMs: 0, activeDays: 0 }, tools: [], devices: [], workspaces: [] }, '2026-08').source, 'local');
assert.throws(() => buildUsageModel({ ok: true, month: '2026-08', totals: { requests: -1 } }), /Usage unavailable|invalid requests/);
const bounds = analyticsBounds('24h', { now: new Date('2026-08-08T12:00:00.000Z') });
assert.equal(bounds.start.toISOString(), '2026-08-07T12:00:00.000Z');
const ranged = analyticsRangeScope([buildUsageModel({
  ok: true,
  month: '2026-08',
  totals: { requests: 2, toolCalls: 2, successes: 1, failures: 1, requestBytes: 10, resultBytes: 20, executionMs: 100, activeDays: 1 },
  tools: [], devices: [], workspaces: [],
  series: [{ hour: '2026-08-08T10', requests: 2, toolCalls: 2, successes: 1, failures: 1, requestBytes: 10, resultBytes: 20, executionMs: 100 }],
  toolSeries: [{ hour: '2026-08-08T10', tool: 'relai_read', toolCalls: 2, successes: 1, failures: 1, executionMs: 100 }],
  workspaceSeries: [], workspaceToolSeries: [],
  failureCategorySeries: [{ hour: '2026-08-08T10', category: 'policy', failures: 1 }]
}, '2026-08')], bounds);
assert.equal(ranged.toolCalls, 2);
assert.equal(ranged.completed, 2);
assert.equal(ranged.averageDuration, 50, 'average duration must divide by completed outcomes, not started tool calls');
assert.deepEqual(ranged.failureCategories, [{ category: 'policy', failures: 1 }]);

console.log('Analytics lazy-route, exact-metric, authenticated-fetch, and privacy contracts passed.');
