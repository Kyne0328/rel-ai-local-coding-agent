import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { getTaskHistoryDir, writeSession } from '../src/taskHistoryStorage.js';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-browser-acceptance-'));
const stateDir = path.join(temp, 'state');
const workspace = path.join(temp, 'workspace');
const configPath = path.join(temp, 'config.json');
const outputPath = path.join(temp, 'probe.json');
const evidenceDir = path.join(root, 'dist', 'observability-evidence');
const screenshotPath = path.join(evidenceDir, 'dashboard-browser-acceptance.png');
const token = 'browser-acceptance-token';
const port = 39883;
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'browser-fixture', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } }));
const config = {
  version: 3,
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
let child = null;
let closePromise = Promise.resolve([]);

try {
  await waitForHealth(`http://127.0.0.1:${port}/health`);
  const electronBinary = process.env.RELAI_ELECTRON_BINARY || path.resolve(root, 'electron', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  assert.equal(fs.existsSync(electronBinary), true, `Electron binary not found at ${electronBinary}`);
  const probe = path.join(root, 'test', 'fixtures', 'electron-dashboard-probe');
  const target = `http://127.0.0.1:${port}/dashboard?token=${encodeURIComponent(token)}#tasks`;
  child = spawn(electronBinary, [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    `--user-data-dir=${path.join(temp, 'electron-profile')}`,
    probe
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: electronEnvironment({
      RELAI_PROBE_TARGET_URL: target,
      RELAI_PROBE_OUTPUT_PATH: outputPath,
      RELAI_PROBE_SCREENSHOT_PATH: screenshotPath
    })
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  closePromise = once(child, 'close').catch(() => []);
  const result = await waitForProbeResult(outputPath, 30_000).catch(async error => {
    const [code] = await closePromise;
    throw new Error(`Electron probe did not complete (launcher code ${code ?? 'unknown'}). stdout=${stdout} stderr=${stderr}\n${error.message}`);
  });
  assert.equal(result.error, undefined, result.error);
  assert.ok(result.initial.rowCount >= 10);
  for (const label of ['queued', 'planning', 'running', 'waiting for approval', 'blocked', 'validating', 'completed', 'failed', 'cancelled']) {
    assert.ok(result.initial.rowText.some(text => text.toLowerCase().includes(label)), `Missing rendered state: ${label}`);
  }
  assert.equal(result.initial.determinateValid, true);
  assert.equal(result.initial.indeterminateValid, true);
  assert.equal(result.initial.unknownStatusCount, 0);
  assert.equal(result.initial.longTitleAccessible, true);
  assert.equal(result.initial.reducedMotion, true);
  assert.equal(result.taskInteraction.dialog, true);
  assert.ok(result.taskInteraction.detailText.length > 100);
  assert.ok(result.taskInteraction.eventLinks > 0);
  assert.notEqual(result.keyboard.afterFocus.tag, 'BODY');
  assert.equal(result.activityInteraction.expanded, true);
  assert.equal(result.activityInteraction.copyButton, true);
  assert.equal(result.activityInteraction.errorWrapped, true);
  assert.equal(result.responsive.viewport <= 640, true);
  assert.equal(result.responsive.horizontalOverflow, false);
  assert.equal(result.failures.length, 0, JSON.stringify(result.failures));
  assert.equal(fs.existsSync(screenshotPath), true);
  await closePromise;
  console.log(`Real Electron Chromium dashboard acceptance passed. Evidence: ${path.relative(root, screenshotPath)}`);
} finally {
  if (child && child.exitCode == null) child.kill('SIGKILL');
  await closePromise.catch(() => {});
  server.kill('SIGKILL');
  await once(server, 'close').catch(() => {});
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function electronEnvironment(extra = {}) {
  const env = { ...process.env, ...extra, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return env;
}
function seedSessions(directory) {
  const now = Date.now();
  const states = [
    ['queued', { mode: 'indeterminate', label: 'Queued' }],
    ['planning', { mode: 'indeterminate', label: 'Planning' }],
    ['running', { mode: 'indeterminate', label: 'Running' }],
    ['waiting_for_approval', { mode: 'indeterminate', label: 'Approval required' }],
    ['blocked', { mode: 'indeterminate', label: 'Blocked' }],
    ['validating', { mode: 'determinate', completedUnits: 1, totalUnits: 2, percentage: 50, label: '1 of 2 checks' }],
    ['completed', { mode: 'determinate', completedUnits: 2, totalUnits: 2, percentage: 100, label: 'Complete' }],
    ['completed_with_warnings', { mode: 'determinate', completedUnits: 2, totalUnits: 2, percentage: 100, label: 'Complete with warnings' }],
    ['failed', { mode: 'determinate', completedUnits: 1, totalUnits: 2, percentage: 50, label: '1 of 2 checks' }],
    ['cancelled', { mode: 'determinate', completedUnits: 1, totalUnits: 3, percentage: 33, label: '1 of 3 checks' }]
  ];
  states.forEach(([status, progress], index) => {
    const terminal = ['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(status);
    const id = `acceptance-${status}`;
    writeSession(directory, {
      id,
      taskId: id,
      version: 3,
      title: status === 'running' ? `Extremely long task title ${'x'.repeat(120)} accessible in full` : `${status.replaceAll('_', ' ')} task`,
      objective: 'Renderer acceptance state.',
      workspace: 'app',
      status,
      state: terminal ? 'ended' : 'active',
      completionKnown: ['completed', 'completed_with_warnings'].includes(status),
      summary: status === 'completed_with_warnings' ? 'Completed with warnings.' : '',
      startedAt: now - (index + 1) * 60_000,
      startedAtIso: new Date(now - (index + 1) * 60_000).toISOString(),
      updatedAt: new Date(now - index * 1000).toISOString(),
      lastActivityAt: now - index * 1000,
      endedAt: terminal ? new Date(now - index * 1000).toISOString() : null,
      completedAt: ['completed', 'completed_with_warnings'].includes(status) ? new Date(now - index * 1000).toISOString() : null,
      durationMs: terminal ? 60_000 : 0,
      calls: 2,
      toolCallCount: 2,
      failures: status === 'failed' ? 1 : 0,
      currentStage: status.replaceAll('_', ' '),
      currentActivity: `Current ${status.replaceAll('_', ' ')} activity`,
      progress,
      events: [
        {
          eventId: `${id}-event-1`,
          taskId: id,
          timestamp: new Date(now - index * 1000).toISOString(),
          category: 'validation',
          action: 'check',
          status: status === 'failed' ? 'failed' : status === 'cancelled' ? 'cancelled' : 'succeeded',
          title: 'Acceptance check',
          summary: status === 'failed' ? `Wrapped error ${'failure '.repeat(30)}` : 'Safe renderer activity.',
          metadata: { currentIndex: 1, checkCount: 2 }
        }
      ]
    });
  });
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`HTTP server did not become healthy. ${serverError}`);
}

async function waitForProbeResult(file, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(file) && fs.statSync(file).size > 0) {
      try {
        const result = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (result?.initial || result?.error) return result;
      } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for completed probe result at ${file}`);
}
