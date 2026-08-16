import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { availablePort } from './helpers/available-port.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-regressions-'));
process.env.REL_AI_MCP_CONFIG = path.join(tmpRoot, 'config.json');

import { makeDefaultConfig, normalizeConfig, publicConfigSummary } from "../src/config.js";
import { updateWorkspace } from "../src/configEditor.js";
import * as productUx from "../src/productUx.js";
import { getVersion } from "../src/version.js";

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
    path: missingPath
  });
  assert.equal(result.ok, true);
  assert.equal(result.config.workspaces.find((item) => item.alias === 'future-repo')?.path, missingPath);

  assert.throws(() => updateWorkspace(makeDefaultConfig(), {
    alias: 'root',
    path: path.parse(process.cwd()).root
  }), /Unsafe workspace path refused/);
}

// Shared ChatGPT guidance owns create and reconnect instructions.
{
  const connector = read('src/ui/features/settings/connector.js');
  const guidance = read('src/ui/features/settings/connection-guidance.js');
  assert.match(connector, /createChatGptSetupGuide/);
  assert.match(connector, /connectionGuideMode/);
  assert.match(guidance, /Connection set to Tunnel/i);
  assert.match(guidance, /Authentication to No authentication/i);
  assert.match(guidance, /existing Rel\.AI MCP plugin\/app instead of creating a duplicate/i);
}

// Dashboard tool metadata stays internally consistent; workspace cards do not
// repeat the global tool count as an unrelated workspace metric.
{
  const cfg = normalizeConfig(makeDefaultConfig());
  const dashboard = productUx.dashboardData(cfg, { limit: 5 });
  assert.equal(dashboard.toolCount, dashboard.tools.length);
  assert.deepEqual(dashboard.config.localRepoBridge.visibleTools, dashboard.tools);
  assert.ok(publicConfigSummary(cfg).localRepoBridge.visibleTools.includes('relai_edit'));
  assert.doesNotMatch(read('src/ui/features/home/index.js'), /visibleToolCount/);
  assert.doesNotMatch(read('src/ui/features/workspaces/cards.js'), /data\.toolCount|ChatGPT tools/);
}

// Audit-fix smoke guards for docs, UI copy, and tunnel process safety.
{
  assert.doesNotMatch(read('README.md'), /Settings -> Connector/);
  assert.match(read('README.md'), /Tunnel[\s\S]*No authentication/i);
  assert.match(read('README.md'), /Add or reconnect Rel\.AI MCP/i);
  assert.doesNotMatch(read('docs/ONE_CLICK_SETUP.md'), /removed tools[^\n]*relai_apply_update/);
  assert.match(read('electron/renderer/status.html'), /Secure MCP Tunnel|Secure tunnel/);
  assert.match(read('electron/renderer/status.js'), /Starting Secure MCP Tunnel/);
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

// Targeted state reads bypass the shared GET cache and collapse overlapping requests.
// Routine dashboard updates use typed domain deltas, while workspace filters are
// page-owned Tailwind listboxes instead of native topbar controls.
{
  const dashboard = read('public/dashboard.js');
  const dashboardHtml = read('src/http/dashboard.js');
  const dashboardCss = read('public/dashboard.css');
  const workspaceMenu = read('src/ui/components/workspace-menu.js');
  assert.match(dashboard, /invalidateCache\(DASHBOARD_DATA_URL\)/);
  assert.match(dashboard, /fetchJson\(DASHBOARD_DATA_URL, \{ cache: 'no-store' \}\)/);
  assert.match(dashboard, /let _refreshPromise = null/);
  assert.match(dashboard, /finally \{[\s\S]{0,400}_refreshPromise = null;/);
  assert.match(dashboardHtml, /onToolActivity\(activity =>/);
  assert.match(dashboardHtml, /sendDomain\('task\.updated', 'task'/);
  assert.match(dashboardHtml, /mcpConnectionManager\.onChange\(snapshot => sendConnection\(snapshot\)\)/);
  assert.match(dashboardHtml, /sendDomain\('workspace\.updated', 'workspace'/);
  assert.match(dashboardHtml, /sendDomain\('process\.updated', 'process'/);
  assert.doesNotMatch(dashboardHtml, /sendSse\(res, ['"]dashboard['"]|scheduleSnapshot|DASHBOARD_SNAPSHOT_COALESCE_MS|DASHBOARD_SNAPSHOT_MAX_WAIT_MS/);
  assert.doesNotMatch(dashboardHtml, /workspaceScope|refreshBtn|topbar-refresh/);
  assert.match(dashboardCss, /\.workspace-menu-popover/);
  assert.doesNotMatch(dashboardCss, /workspace-scope-control/);
  assert.match(workspaceMenu, /aria-haspopup="listbox"/);
  const router = read('src/ui/router.js');
  assert.match(router, /pageScroller\(\)\.scrollTo\(view\.scrollX, view\.scrollY\)/);
  assert.match(router, /_container\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(router, /Promise\.resolve\(result\)\.finally\(\(\) => finishMount/);
  assert.doesNotMatch(router, /_container\.innerHTML = ''/);
}

// Workspace command aliases are legacy state: current manifests are the source of truth.
{
  const workspaceRoot = fs.mkdtempSync(path.join(tmpRoot, 'workspace-'));
  fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({ scripts: { test: 'node ok.js' } }), 'utf8');
  const cfg = normalizeConfig({
    ...makeDefaultConfig(),
    workspaces: {
      demo: {
        path: workspaceRoot,
        commands: { legacy: 'npm run gone-command' },
        testCommands: { legacy: 'npm run gone-test' }
      }
    }
  });
  assert.equal(Object.hasOwn(cfg.workspaces.demo, 'commands'), false);
  assert.equal(Object.hasOwn(cfg.workspaces.demo, 'testCommands'), false);
  const summary = publicConfigSummary(cfg).workspaces.find(item => item.alias === 'demo');
  assert.ok(summary.discoveredTestCommandKeys.includes('npm:test'));
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
const httpStateDir = path.join(tmpRoot, 'http-state');
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: token,
    REL_AI_MCP_STATE_DIR: httpStateDir
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
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('Regression fixes smoke test passed.');

