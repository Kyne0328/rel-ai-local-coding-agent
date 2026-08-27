import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTaskHistoryDir, writeSession } from '../src/taskHistoryStorage.js';
import { availablePort } from './helpers/available-port.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-filter-browser-'));
const stateDir = path.join(temp, 'state');
const workspace = path.join(temp, 'workspace');
const configPath = path.join(temp, 'config.json');
const outputPath = path.join(temp, 'probe.json');
const token = 'filter-browser-token';
const port = await availablePort();
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'filter-fixture', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } }));
const config = {
  version: 4,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: { app: { path: workspace, commands: {}, testCommands: { test: 'npm test' } } }
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
seedSessions(getTaskHistoryDir(config));
const server = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, REL_AI_MCP_CONFIG: configPath, REL_AI_MCP_TOKEN: token, REL_AI_MCP_STATE_DIR: stateDir }
});
let serverError = '';
server.stderr.on('data', chunk => { serverError += chunk.toString('utf8'); });
let child;
try {
  await waitForHealth(`http://127.0.0.1:${port}/health`);
  const electronBinary = process.env.RELAI_ELECTRON_BINARY || path.resolve(root, 'electron', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  assert.equal(fs.existsSync(electronBinary), true, `Electron binary not found at ${electronBinary}`);
  child = spawn(electronBinary, ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', `--user-data-dir=${path.join(temp, 'profile')}`, path.join(root, 'test', 'fixtures', 'electron-filter-probe')], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, RELAI_PROBE_TARGET_URL: `http://127.0.0.1:${port}/dashboard?token=${encodeURIComponent(token)}#activity`, RELAI_PROBE_OUTPUT_PATH: outputPath, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  const [code] = await Promise.race([once(child, 'close'), new Promise(resolve => setTimeout(() => resolve(['timeout']), 60_000))]);
  if (code === 'timeout') child.kill('SIGKILL');
  assert.equal(code, 0, `Filter browser probe failed. stdout=${stdout} stderr=${stderr}`);
  const result = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.shared, {
    searchVisible: true,
    searchLabel: 'Search activity',
    filterButtonLabel: 'Open filters',
    summaryRole: 'status',
    dialogLabel: true,
    focusedInside: true,
    cancelPreserved: true,
    fixedChoicesVisible: true
  });
  assert.deepEqual(result.activityApplied.chipText.sort(), ['Status: failed ×', 'Time: 24h ×']);
  assert.deepEqual(result.activityApplied.chipLabels.sort(), ['Remove Status filter: failed', 'Remove Time filter: 24h']);
  assert.equal(result.activityApplied.badge, 'Filters (2)');
  assert.match(result.activityApplied.route, /time=24h/);
  assert.match(result.activityApplied.route, /status=failed/);
  assert.match(result.activityApplied.summary, /events shown/);
  assert.equal(result.activityApplied.freezeExcluded, true);
  assert.equal(result.activityApplied.freezeLabel, 'Freeze live activity');
  assert.equal(result.activityApplied.freezeIconOnly, true);
  assert.match(result.taskChip, /Remove Task filter/);
  assert.deepEqual(result.escapeFocus, { closed: true, focusReturned: true });
  assert.equal(result.mobileDrawer.viewport <= 420, true);
  assert.equal(result.mobileDrawer.horizontalOverflow, false);
  assert.equal(result.mobileDrawer.bottomSheet, true);
  assert.equal(result.mobileDrawer.scrollable, true);
  assert.equal(result.mobileDrawer.actionsReachable, true);
  assert.equal(result.diagnostics.cancelPreserved, true);
  assert.equal(result.diagnostics.fixedChoicesVisible, true);
  assert.equal(result.diagnostics.sourceDisabledForFindings, true);
  assert.equal(result.diagnostics.initialLiveTailLabel, 'Start live updates');
  assert.equal(result.diagnostics.liveTailActiveLabel, 'Pause live updates');
  assert.equal(result.diagnostics.liveTailStarted, true);
  assert.equal(result.diagnostics.liveTailStopped, true);
  assert.equal(result.diagnostics.searchEmpty, true);
  assert.equal(result.diagnostics.technicalFindingCodesGated, true);
  assert.equal(result.diagnostics.findingSeveritiesReadable, true);
  assert.deepEqual(result.diagnostics.applied.chips.sort(), ['Scope: Failed activity ×', 'Severity: Blocking ×']);
  assert.equal(result.diagnostics.applied.badge, 'Filters (2)');
  assert.match(result.diagnostics.applied.summary, /findings.*log entries shown/);
  assert.equal(result.diagnostics.applied.liveTailPressed, 'false');
  assert.deepEqual(result.diagnostics.applied.reportActions, ['Copy report', 'Export support info', 'Open support folder']);
  assert.match(result.tools.applied.chip, /Validate/);
  assert.equal(result.tools.applied.badge, 'Filters (1)');
  assert.match(result.tools.applied.summary, /tools shown/);
  assert.ok(result.tools.applied.visibleCards > 0);
  assert.equal(result.tools.capabilityRemoved, true);
  assert.equal(result.tools.searchCleared, true);
  assert.equal(result.tools.emptyState, true);
  assert.deepEqual(result.settings.themes.map(item => item.preference), ['dark', 'light', 'system']);
  assert.deepEqual(result.settings.themeSwitchLabels, ['Follow system appearance', 'Dark theme', 'Light theme']);
  assert.equal(result.settings.themeSwitchPressedCount, 1);
  assert.equal(result.settings.densityControlRemoved, true);
  assert.equal(result.settings.appearancePreviewRemoved, true);
  assert.equal(result.settings.legacyDensityIgnored, true);
  assert.equal(result.settings.secondaryNavigationRemoved, true);
  assert.equal(result.settings.labelsAssociated, true);
  assert.deepEqual(result.workspaces, { validationPreferenceRemoved: true, validationMetricRemoved: true, editDetailsConsolidated: true, redundantProjectActionsRemoved: true, focusChipLabel: 'Clear selected project filter: app', scopeName: 'Project filter: All projects' });
  assert.equal(result.connection.primaryCount, 1);
  assert.ok(result.connection.primaryLabel.length > 0);
  assert.equal(result.connection.detailsDisclosure, true);
  assert.equal(result.connection.technicalDetailsRemoved, true);
  assert.equal(result.connection.secondaryNavigationRemoved, true);
  assert.ok(['A', 'BUTTON'].includes(result.connection.primaryTag));
  assert.ok(result.connection.navigationLabels.includes('Work navigation'));
  assert.equal(result.usage.overviewVisible, true);
  assert.equal(result.usage.localAggregate, true);
  assert.equal(result.usage.modalVisible, false);
  assert.equal(result.usage.inlineUnavailable, false);
  assert.deepEqual(result.usage.rangeLabels, ['1h', '24h', '7d', '30d', 'Month', 'Custom']);
  assert.equal(result.usage.rangePressedCount, 1);
  assert.equal(result.usage.rangeSelectHidden, true);
  assert.equal(result.usage.rangeRouteUpdated, true);
  assert.deepEqual(result.responsive.map(item => item.requestedWidth), [980, 760, 520, 420]);
  for (const viewport of result.responsive) {
    assert.ok(Math.abs(viewport.width - viewport.requestedWidth) <= 2, `requested ${viewport.requestedWidth}px but rendered ${viewport.width}px`);
    assert.equal(viewport.breakpointActive, true, `${viewport.requestedWidth}px breakpoint did not activate`);
    assert.equal(viewport.horizontalOverflow, false, `${viewport.requestedWidth}px has page overflow`);
    assert.equal(viewport.controlsInViewport, true, `${viewport.requestedWidth}px clips a filter control: ${JSON.stringify(viewport.clippedControls)}`);
    assert.equal(viewport.searchVisible, true, `${viewport.requestedWidth}px hides search`);
    assert.equal(viewport.touchTargets, true, `${viewport.requestedWidth}px has an undersized filter control`);
  }
  assert.ok(Math.abs(result.zoom200At420.width - 420) <= 2, JSON.stringify(result.zoom200At420));
  assert.equal(result.zoom200At420.zoomFactor, 2);
  assert.equal(result.zoom200At420.horizontalOverflow, false);
  assert.equal(result.zoom200At420.controlsInViewport, true);
  assert.equal(result.zoom200At420.searchVisible, true);
  assert.equal(result.forcedColors.active, true);
  assert.equal(result.forcedColors.supported, true);
  assert.equal(result.forcedColors.visibleBoundary, true);
  assert.deepEqual(result.failures, []);
  console.log('Rendered filter, settings, workspace, connection, and responsive experience passed.');
} finally {
  if (child && child.exitCode == null) child.kill('SIGKILL');
  if (server.exitCode == null) server.kill('SIGKILL');
  server.unref();
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
process.exit(0);

function seedSessions(directory) {
  const now = Date.now();
  for (const [status, index] of [['completed', 0], ['failed', 1], ['running', 2]]) {
    const id = `acceptance-${status}`;
    writeSession(directory, {
      id, taskId: id, work_id: id, version: 3, title: `${status} task`, objective: 'Filter acceptance.', workspace: 'app',
      status, state: status === 'running' ? 'active' : 'ended', completionKnown: status === 'completed', summary: status === 'completed' ? 'Completed.' : '',
      startedAt: now - (index + 1) * 60000, startedAtIso: new Date(now - (index + 1) * 60000).toISOString(), updatedAt: new Date(now - index * 1000).toISOString(), lastActivityAt: now - index * 1000,
      endedAt: status === 'running' ? null : new Date(now - index * 1000).toISOString(), calls: 1, toolCallCount: 1, failures: status === 'failed' ? 1 : 0,
      events: [{ eventId: `${id}-event`, taskId: id, timestamp: new Date(now - index * 1000).toISOString(), category: 'validation', action: 'check', status: status === 'failed' ? 'failed' : status === 'running' ? 'running' : 'succeeded', title: 'Acceptance check', summary: status === 'failed' ? 'Acceptance validation failure' : 'Acceptance validation result', tool: 'relai_validate', workspace: 'app' }]
    });
  }
}
async function waitForHealth(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await healthRequest(url)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('HTTP server did not become healthy. ' + serverError);
}
function healthRequest(url) {
  return new Promise(resolve => {
    const request = http.get(url, { agent: false, headers: { connection: 'close' } }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode >= 200 && response.statusCode < 300));
    });
    request.once('error', () => resolve(false));
    request.setTimeout(1000, () => { request.destroy(); resolve(false); });
  });
}
