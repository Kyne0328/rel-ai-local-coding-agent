import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
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

// Dashboard tool metadata stays internally consistent; workspace cards do not
// repeat the global tool count as an unrelated workspace metric.
{
  const cfg = normalizeConfig(makeDefaultConfig());
  const dashboard = productUx.dashboardData(cfg, { limit: 5 });
  assert.equal(dashboard.toolCount, dashboard.tools.length);
  assert.deepEqual(dashboard.config.localRepoBridge.visibleTools, dashboard.tools);
  assert.ok(publicConfigSummary(cfg).localRepoBridge.visibleTools.includes('relai_edit'));
  assert.doesNotMatch(read('src/ui/sections/home.js'), /visibleToolCount/);
  assert.doesNotMatch(read('src/ui/sections/workspace-cards.js'), /data\.toolCount|ChatGPT tools/);
}

// Audit-fix smoke guards for docs, UI copy, and tunnel process safety.
{
  assert.doesNotMatch(read('README.md'), /Settings -> Connector/);
  assert.match(read('README.md'), /Settings > Apps > Create/);
  assert.doesNotMatch(read('docs/ONE_CLICK_SETUP.md'), /removed tools[^\n]*relai_apply_update/);
  assert.match(read('electron/renderer/status.html'), /Public endpoint/);
  assert.match(read('electron/renderer/status.js'), /Publishing tunnel/);
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

// Manual refresh must bypass the shared GET cache, collapse overlapping requests,
// and always restore the control state. The workspace scope uses the styled,
// accessible header control instead of an unadorned native select.
{
  const dashboard = read('public/dashboard.js');
  const dashboardHtml = read('src/http/dashboard.js');
  const dashboardCss = read('public/dashboard.css');
  assert.match(dashboard, /invalidateCache\(DASHBOARD_DATA_URL\)/);
  assert.match(dashboard, /let _refreshPromise = null/);
  assert.match(dashboard, /finally \{\s*setRefreshState\(refreshState\);\s*\}/);
  assert.match(dashboardHtml, /id="workspaceScopeControl" class="workspace-scope-control"/);
  assert.match(dashboardCss, /\.workspace-scope-control:focus-within/);
  assert.match(dashboardCss, /appearance: none/);
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
const port = await availablePort();
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
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] regression health wait:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`HTTP server did not become healthy. stderr:\n${stderr}`);
}

try {
  const health = await waitForHealth();
  assert.equal(health.version, getVersion());

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

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address !== 'string' ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
