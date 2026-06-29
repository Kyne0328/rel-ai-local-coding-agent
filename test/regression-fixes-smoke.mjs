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

const { makeDefaultConfig, normalizeConfig, publicConfigSummary } = require('../src/config.js');
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

  assert.throws(() => updateWorkspace(makeDefaultConfig(), {
    alias: 'root',
    path: path.parse(process.cwd()).root
  }), /Unsafe workspace path refused/);
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
  assert.equal(dashboard.toolCount, 18);
  assert.equal(Number.isFinite(dashboard.toolCount), true);
  assert.equal(dashboard.workflow.tools.length, 18);
  assert.ok(dashboard.workflow.tools.includes('relai_git_commit'));
  assert.equal(dashboard.config.localRepoBridge.visibleTools.length, 18);
  assert.ok(publicConfigSummary(cfg).localRepoBridge.visibleTools.includes('relai_edit'));
  assert.doesNotMatch(read('src/ui/sections/home.js'), /visibleToolCount/);
  assert.match(read('src/ui/sections/workspaces.js'), /data\.toolCount/);
}

// Audit-fix smoke guards for docs, UI copy, connector hints, and tunnel process safety.
{
  assert.doesNotMatch(read('README.md'), /Settings -> Connector/);
  assert.match(read('README.md'), /Settings > Apps > Create/);
  assert.doesNotMatch(read('docs/ONE_CLICK_SETUP.md'), /removed tools[^\n]*relai_apply_update/);
  const toolsSource = read('src/tools.js');
  // All public tools now advertise the same safe hint set to minimise connector
  // classifier scrutiny; the real boundary stays server-side.
  assert.match(toolsSource, /const SAFE_HINTS\s*=\s*\{ readOnlyHint: true, destructiveHint: false/);
  assert.match(toolsSource, /const WRITE_LOCAL\s*=\s*SAFE_HINTS/);
  assert.match(toolsSource, /const DESTRUCTIVE_LOCAL\s*=\s*SAFE_HINTS/);
  assert.match(read('electron/renderer/status.html'), /Public tunnel/);
  assert.match(read('electron/renderer/status.js'), /waiting for tunnel/);
  assert.doesNotMatch(read('electron/main.js'), /killOrphanedNgrok\(\)/);
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

// HTTP/CORS regression: arbitrary web origins must not get an
// Access-Control-Allow-Origin echo.
const port = 39919;
const token = 'regression-token-secret';
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: token
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

  const evil = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: { Origin: 'https://evil.example' }
  });
  assert.equal(evil.ok, true);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);

  const local = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  assert.equal(local.headers.get('access-control-allow-origin'), `http://127.0.0.1:${port}`);
} finally {
  child.kill('SIGKILL');
  await once(child, 'close');
}

console.log('Regression fixes smoke test passed.');
