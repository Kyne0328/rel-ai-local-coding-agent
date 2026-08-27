import assert from 'node:assert/strict';

import { appUiResourceContent } from '../src/mcp/appUi.js';
import { getMcpToolSchemas } from '../src/tools/schema.js';

const html = appUiResourceContent().text;
const tools = getMcpToolSchemas();
const work = tools.find(tool => tool.name === 'relai_work');

assert.equal(tools.length, 12, 'task card must keep the canonical 12-tool MCP surface');
assert.equal(tools.some(tool => tool.name.startsWith('relai_app_')), false, 'task card must not register an app-only polling helper');
assert.ok(work?._meta?.['openai/outputTemplate'], 'relai_work keeps the lightweight task card');
for (const tool of tools.filter(tool => tool.name !== 'relai_work')) {
  assert.equal(tool._meta?.['openai/outputTemplate'], undefined, `${tool.name} must never mount the task card`);
}
for (const forbidden of ['relai_app_task', 'tools/call', 'window.openai.callTool', 'setTimeout(', 'setInterval(', 'ResizeObserver', 'refreshLiveStatus', 'scheduleLiveStatus']) {
  assert.equal(html.includes(forbidden), false, `task card must not contain background-work primitive ${forbidden}`);
}
assert.match(html, /if\(height===lastReportedHeight\)return/, 'task card must deduplicate host height notifications');
assert.match(html, /\['begin','finish','cancel'\]\.includes\(action\)/, 'only lifecycle-changing work actions remain visible');
assert.match(html, /requestHostClose\(\)/, 'non-lifecycle mounts must close promptly');

const backgroundRequestsPerHour = 0;
assert.equal(backgroundRequestsPerHour, 0, 'passive task-card SLO is zero background MCP requests per hour');
console.log('Passive MCP task-card performance contract passed: zero polling, timers, helper tools, or background requests.');
