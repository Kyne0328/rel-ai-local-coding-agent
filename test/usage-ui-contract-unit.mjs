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
const usageSource = read('src/ui/features/usage/index.js');
const css = read('src/ui/features/usage/styles.css');

const { buildUsageModel, currentUsageMonth } = await import('../src/ui/features/usage/index.js');

assert.match(navigationCatalog, /route\(['"]usage['"], ['"]Usage['"]/);
assert.match(routePolicy, /['"]usage['"]/);
assert.match(dashboard, /usage: element => import\(['"]\.\/ui\/features\/usage\/index\.js['"]\)/, 'Usage must lazy-load only when routed');
assert.doesNotMatch(dashboardData, /gatewayUsage|usageSnapshot|usageTotals|usage_tool|usage_device|usage_workspace/, 'aggregate dashboard payload must not include Cloud usage');
assert.match(dashboard, /case ['"]usage['"]:[\s\S]{0,160}payload = route/, 'Usage fingerprint must not depend on aggregate dashboard data');

assert.match(preload, /getGatewayUsage: month => ipcRenderer\.invoke\(['"]desktop:gateway:usage['"], month\)/);
assert.match(ipc, /desktop:gateway:usage/);
assert.match(ipc, /Usage month must use YYYY-MM/);
assert.match(electronMain, /GATEWAY_NOT_CONNECTED/, 'Electron main must return a structured unavailable result when Cloud disconnects during a usage request');
assert.match(electronMain, /Rel\.AI Cloud is not connected\./, 'Electron main must not leak the raw remote-method gateway exception');
assert.match(usageSource, /getGatewayUsage\(month\)/, 'Usage must request only the selected YYYY-MM through Electron');
assert.match(usageSource, /pairing_required|pairing required/i, 'Usage must recognize the Cloud pairing-required state before requesting usage');
assert.match(usageSource, /const availability = cloudUsageAvailability\(status\);[\s\S]{0,500}if \(availability\)[\s\S]{0,500}const usage = await desktop\.getGatewayUsage\(month\)/, 'Usage must return from the availability gate before invoking the usage IPC');
assert.doesNotMatch(usageSource, /fetch\(|DASHBOARD_DATA_URL|auditTail|taskActivity/, 'Usage must not fabricate totals from local dashboard/activity data');

for (const label of ['MCP requests', 'Tool calls', 'Successful', 'Failed', 'Data sent', 'Data returned', 'Execution time', 'Active days']) {
  assert.match(usageSource, new RegExp(label), `Usage must render exact metric label: ${label}`);
}
for (const field of ['requests', 'toolCalls', 'successes', 'failures', 'requestBytes', 'resultBytes', 'executionMs', 'activeDays']) {
  assert.match(usageSource, new RegExp(`\\b${field}\\b`), `Usage must consume exact gateway total ${field}`);
}
for (const breakdown of ['tools', 'devices', 'workspaces']) {
  assert.match(usageSource, new RegExp(`snapshot\\.${breakdown}|usage\\.${breakdown}|model\\.${breakdown}`), `Usage must render ${breakdown} breakdowns`);
}
assert.match(usageSource, /Usage unavailable|usage-unavailable/i);
assert.match(usageSource, /openModal/, 'Direct-mode Usage unavailability must be presented as a modal');
assert.match(usageSource, /Rel\.AI Cloud usage is unavailable while Direct connection mode is active\./);
assert.doesNotMatch(usageSource, /connectionMode === ['"]direct['"]\) throw new Error/, 'Direct mode must not fall through the generic inline error renderer');
assert.match(usageSource, /Retry/);
assert.match(usageSource, /type = ['"]month['"]|type=['"]month['"]/);
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
  workspaces: [{ workspace: 'repo', toolCalls: 5, successes: 4, failures: 1, executionMs: 5600 }]
}, '2026-08');
assert.deepEqual(model.totals, { requests: 8, toolCalls: 5, successes: 4, failures: 1, requestBytes: 1200, resultBytes: 3400, executionMs: 5600, activeDays: 2 });
assert.equal(model.tools[0].tool, 'relai_read');
assert.equal(model.devices[0].displayName, 'Laptop');
assert.equal(model.workspaces[0].workspace, 'repo');
assert.equal(currentUsageMonth(new Date('2026-08-08T00:00:00.000Z')), '2026-08');
assert.throws(() => buildUsageModel({ ok: true, month: '2026-08', totals: { requests: -1 } }), /Usage unavailable|invalid requests/);

console.log('Usage lazy-route, exact-metric, authenticated-fetch, and privacy contracts passed.');
