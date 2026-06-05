import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-regressions-'));
process.env.REL_AI_MCP_CONFIG = path.join(tmpRoot, 'config.json');

const { makeDefaultConfig, normalizeConfig } = require('../src/config.js');
const { updateWorkspace } = require('../src/configEditor.js');
const productUx = require('../src/productUx.js');
const { getVersion } = require('../src/version.js');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function latestChangelogVersion() {
  const match = read('CHANGELOG.md').match(/^##\s*\[([^\]]+)\]/m);
  assert.ok(match, 'CHANGELOG.md should have a version heading');
  return match[1].trim();
}

// Version is sourced from CHANGELOG.md directly, not package.json-first.
assert.equal(getVersion(), latestChangelogVersion());

// Workspace upsert accepts a not-yet-existing absolute path, matching the UI's
// warn-but-allow promise for repos that are about to be cloned.
{
  const cfg = makeDefaultConfig();
  const missingPath = path.join(tmpRoot, 'future-repo-does-not-exist');
  const result = updateWorkspace(cfg, {
    alias: 'future-repo',
    path: missingPath,
    protectedBranches: ['main'],
    defaultBaseBranch: 'main',
    allowedRemotes: ['origin']
  });
  assert.equal(result.ok, true);
  assert.equal(result.config.workspaces.find((item) => item.alias === 'future-repo')?.path, missingPath);
}

// Dashboard settings must not keep writing the inert server-side autoApproveAppRequests
// store. The Chrome extension popup/chrome.storage.local is authoritative.
{
  const general = read('src/ui/sections/settings/general.js');
  assert.doesNotMatch(general, /autoApproveAppRequests:\s*_draft\.autoApproveAppRequests/);
  assert.doesNotMatch(general, /const keys = \[[^\]]*autoApproveAppRequests/s);
}

// Connector next steps should not duplicate the hardcoded setup steps when payload.nextSteps
// is absent; it should render only extra steps from the payload.
{
  const connector = read('src/ui/sections/settings/connector.js');
  assert.match(connector, /const extraSteps = Array\.isArray\(payload\.nextSteps\) \? payload\.nextSteps : \[\]/);
  assert.doesNotMatch(connector, /Open ChatGPT settings and add an MCP server[\s\S]*steps\.slice\(0, 3\)/);
}

// Tool count is derived from backend dashboard data; the Home fallback dead var is gone.
{
  const cfg = normalizeConfig(makeDefaultConfig());
  const dashboard = productUx.dashboardData(cfg, { limit: 5 });
  assert.equal(dashboard.toolCount, 24);
  assert.equal(Number.isFinite(dashboard.toolCount), true);
  assert.doesNotMatch(read('src/ui/sections/home.js'), /visibleToolCount/);
  assert.match(read('src/ui/sections/workspaces.js'), /data\.toolCount/);
}

// initEvents must be idempotent: dashboard.js calls it once at boot now, and the
// module itself protects against accidental future duplicate visibility listeners.
{
  const dashboard = read('public/dashboard.js');
  const toggleLiveBody = dashboard.match(/function _toggleLive\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.doesNotMatch(toggleLiveBody, /initEvents\(/);
  const events = read('src/ui/events.js');
  assert.match(events, /let _visibilityWired = false/);
  assert.match(events, /if \(_visibilityWired\) return/);
  assert.match(events, /document\.addEventListener\('visibilitychange', _handleVisibilityChange\)/);
}

// Stale-command diagnostics cover commands AND testCommands, matching relai_status.
{
  const workspaceRoot = fs.mkdtempSync(path.join(tmpRoot, 'workspace-'));
  fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({ scripts: { test: 'node ok.js' } }), 'utf8');
  const cfg = normalizeConfig({
    ...makeDefaultConfig(),
    workspaces: {
      demo: {
        path: workspaceRoot,
        commands: { 'npm:gone-command': 'npm run gone-command' },
        testCommands: { 'npm:gone-test': 'npm run gone-test' }
      }
    }
  });
  const result = productUx.aliasConsistencyCheck(cfg);
  const demo = result.workspaces.find((item) => item.alias === 'demo');
  assert.deepEqual(new Set(demo.staleKeys), new Set(['npm:gone-command', 'npm:gone-test']));
  assert.equal(demo.ok, false);
}

// State export respects the enableStateExport flag.
{
  const disabled = normalizeConfig({ ...makeDefaultConfig(), productUx: { enableStateExport: false } });
  assert.throws(() => productUx.stateExport(disabled), /State export is disabled/);
}

// HTTP/CORS regression: /api/local-connect still serves local extension discovery,
// but arbitrary web origins must not get an Access-Control-Allow-Origin echo that
// would let browser JS read the token response cross-origin.
const port = 39919;
const token = 'regression-token-secret';
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: token,
    REL_AI_MCP_CHATGPT_SECRET: 'regression-secret'
  }
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return res.json();
    } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`HTTP server did not become healthy. stderr:\n${stderr}`);
}

try {
  const health = await waitForHealth();
  assert.equal(health.version, latestChangelogVersion());

  const evil = await fetch(`http://127.0.0.1:${port}/api/local-connect`, {
    headers: { Origin: 'https://evil.example' }
  });
  assert.equal(evil.ok, true);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const evilBody = await evil.json();
  assert.equal(evilBody.token, token, 'endpoint may still return token to non-browser/server fetches');

  const extension = await fetch(`http://127.0.0.1:${port}/api/local-connect`, {
    headers: { Origin: 'chrome-extension://abcdefghijklmnop' }
  });
  assert.equal(extension.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnop');

  const local = await fetch(`http://127.0.0.1:${port}/api/local-connect`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  assert.equal(local.headers.get('access-control-allow-origin'), `http://127.0.0.1:${port}`);
} finally {
  child.kill('SIGKILL');
  await once(child, 'close');
}

console.log('Regression fixes smoke test passed.');
