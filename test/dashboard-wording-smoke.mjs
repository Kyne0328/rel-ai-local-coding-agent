import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeToolCount } from './helpers/tool-surface.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = 39881;
const token = process.env.TEST_TOKEN ?? 'dashboard-wording-smoke-token';
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-dashboard-wording-'));

const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: token,
    REL_AI_MCP_STATE_DIR: stateDir,
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
    dashboardFindings.push('Dashboard JSON contains a forbidden workflow term.');
  }
}

if (dashboardFindings.length) {
  child.kill('SIGKILL');
  console.error('Dashboard wording smoke test FAILED — forbidden terms in dashboard response:');
  for (const msg of dashboardFindings) console.error(`  ${msg}`);
  process.exit(1);
}

// --- 2. Check required terms are present in dashboard JSON ---
if (!Array.isArray(dashboardData?.tools) || dashboardData.tools.length !== activeToolCount) {
  child.kill('SIGKILL');
  console.error(`Dashboard wording smoke test FAILED — dashboard JSON must expose ${activeToolCount} active tools`);
  process.exit(1);
}
if (!Array.isArray(dashboardData?.taskActivity?.tasks) || typeof dashboardData?.taskActivity?.activeTaskCount !== 'number') {
  child.kill('SIGKILL');
  console.error('Dashboard wording smoke test FAILED — task activity must expose concurrent task records');
  process.exit(1);
}
if (!dashboardData?.connectionState?.localService || !dashboardData?.connectionState?.publicEndpoint || !dashboardData?.connectionState?.chatgptReadiness || !dashboardData?.connectionState?.dashboardUpdates) {
  child.kill('SIGKILL');
  console.error('Dashboard wording smoke test FAILED — normalized connection layers are missing');
  process.exit(1);
}
if (!dashboardData?.mcpAuthentication || typeof dashboardData?.mcpAuthentication?.status !== 'string') {
  child.kill('SIGKILL');
  console.error('Dashboard wording smoke test FAILED — authoritative MCP authentication status is missing');
  process.exit(1);
}
if (!dashboardData?.mcpConnection || dashboardData?.mcpConnection?.activityStatus !== 'no_requests') {
  child.kill('SIGKILL');
  console.error('Dashboard wording smoke test FAILED — stateless MCP request activity is missing or incorrect');
  process.exit(1);
}
if (dashboardJson.includes('prepared') || dashboardJson.includes('apply_bundle')) {
  child.kill('SIGKILL');
  console.error('Dashboard wording smoke test FAILED — obsolete prepared/bundle workflow wording remains');
  process.exit(1);
}

child.kill('SIGKILL');
await once(child, 'close');
fs.rmSync(stateDir, { recursive: true, force: true });
console.log('Dashboard wording smoke test passed.');
