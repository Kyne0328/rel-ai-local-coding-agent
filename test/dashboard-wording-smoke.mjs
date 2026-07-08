import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = 39881;
const token = process.env.TEST_TOKEN ?? 'dashboard-wording-smoke-token';

const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: token,
  }
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

async function waitForHealth() {
  const url = `http://127.0.0.1:${port}/health`;
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`HTTP server did not become healthy within 8s. stderr:\n${stderr}`);
}

const health = await waitForHealth();
if (!health.ok) {
  child.kill('SIGKILL');
  throw new Error('Health endpoint returned not-ok');
}

// --- 1. Fetch dashboard JSON and check for forbidden terms ---
const dashboardUrl = `http://127.0.0.1:${port}/api/dashboard/v10?token=${encodeURIComponent(token)}`;
const dashboardResponse = await fetch(dashboardUrl);
if (!dashboardResponse.ok) {
  child.kill('SIGKILL');
  throw new Error(`Dashboard API returned ${dashboardResponse.status}`);
}
const dashboardData = await dashboardResponse.json();
const dashboardJson = JSON.stringify(dashboardData);

const forbiddenInDashboard = [
  { label: 'aggressive', pattern: /\baggressive\b/i },
  { label: 'fast mode', pattern: /\bfast mode\b/i },
  { label: 'fast path', pattern: /\bfast path\b/i },
];

const dashboardFindings = [];
for (const item of forbiddenInDashboard) {
  if (item.pattern.test(dashboardJson)) {
    dashboardFindings.push(`Dashboard JSON contains forbidden term: "${item.label}"`);
  }
}

if (dashboardFindings.length) {
  child.kill('SIGKILL');
  console.error('Dashboard wording smoke test FAILED — forbidden terms in dashboard response:');
  for (const msg of dashboardFindings) console.error(`  ${msg}`);
  process.exit(1);
}

// --- 2. Check required terms are present in dashboard JSON ---
const hasStandardOrPrepared = /\b(standard|prepared)\b/.test(dashboardJson);
if (!hasStandardOrPrepared) {
  child.kill('SIGKILL');
  console.error('Dashboard wording smoke test FAILED — dashboard JSON must contain "standard" or "prepared" as workflow mode');
  process.exit(1);
}

// Verify specific shape of new fields
if (!dashboardData?.workflow?.mode) {
  child.kill('SIGKILL');
  console.error('Dashboard wording smoke test FAILED — dashboard JSON must contain workflow.mode');
  process.exit(1);
}

// --- 3. Fetch tool schemas and check for forbidden terms in descriptions ---
const toolsUrl = `http://127.0.0.1:${port}/api/tools?token=${encodeURIComponent(token)}`;
const toolsResponse = await fetch(toolsUrl);
if (!toolsResponse.ok) {
  child.kill('SIGKILL');
  throw new Error(`Tools API returned ${toolsResponse.status}`);
}
const tools = await toolsResponse.json();
let toolsArray;
if (Array.isArray(tools)) {
  toolsArray = tools;
} else if (Array.isArray(tools?.tools)) {
  toolsArray = tools.tools;
} else {
  toolsArray = [];
}

const forbiddenInToolDescriptions = ['shell', 'execute', 'arbitrary', 'command runner'];
const toolDescriptionFindings = [];

for (const tool of toolsArray) {
  const desc = String(tool.description || '').toLowerCase();
  for (const forbidden of forbiddenInToolDescriptions) {
    if (desc.includes(forbidden)) {
      toolDescriptionFindings.push(`Tool "${tool.name}" description contains forbidden word: "${forbidden}" — found in: "${tool.description}"`);
    }
  }
}

// Check relai_run_checks specifically
const runChecksTool = toolsArray.find((t) => t.name === 'relai_run_checks');
if (!runChecksTool) {
  toolDescriptionFindings.push('relai_run_checks tool was not found in /api/tools response');
} else if (!String(runChecksTool.description || '').toLowerCase().includes('validation checks')) {
  toolDescriptionFindings.push(`relai_run_checks description must contain "validation checks" — got: "${runChecksTool.description}"`);
}

if (toolDescriptionFindings.length) {
  child.kill('SIGKILL');
  console.error('Dashboard wording smoke test FAILED — tool description wording issues:');
  for (const msg of toolDescriptionFindings) console.error(`  ${msg}`);
  process.exit(1);
}

child.kill('SIGKILL');
await once(child, 'close');
console.log(`Dashboard wording smoke test passed. Dashboard fields OK. Tools checked: ${toolsArray.length}. relai_run_checks description: "${runChecksTool ? runChecksTool.description : 'n/a'}"`);
