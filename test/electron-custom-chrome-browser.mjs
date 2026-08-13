import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeToolNames } from './helpers/tool-surface.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-custom-chrome-'));
const stateDir = path.join(temp, 'state');
const workspace = path.join(temp, 'workspace');
const configPath = path.join(temp, 'config.json');
const outputPath = path.join(temp, 'probe.json');
const token = 'custom-chrome-token';
const port = await availablePort();
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'custom-chrome-fixture', version: '1.0.0' }));
fs.writeFileSync(configPath, JSON.stringify({ version: 3, stateDir, auditLogPath: path.join(stateDir, 'audit.jsonl'), workspaces: { app: { path: workspace, commands: {}, testCommands: {} } } }, null, 2));
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
  child = spawn(electronBinary, ['--no-sandbox', `--user-data-dir=${path.join(temp, 'profile')}`, path.join(root, 'test', 'fixtures', 'electron-custom-chrome-probe')], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, RELAI_PROBE_TARGET_URL: `http://127.0.0.1:${port}/dashboard?token=${encodeURIComponent(token)}&surface=desktop&chrome=custom&platform=win32#usage`, RELAI_PROBE_OUTPUT_PATH: outputPath, RELAI_EXPECTED_TOOL_COUNT: String(activeToolNames.length), ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  const [code] = await waitForProcessClose(child, 30_000);
  if (code === 'timeout') child.kill('SIGKILL');
  assert.equal(code, 0, `Custom chrome Electron probe failed. stdout=${stdout} stderr=${stderr}`);
  const result = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(result.measurements.length, 3);
  for (const measurement of result.measurements) {
    assert.equal(measurement.chrome, 'custom');
    assert.equal(measurement.density, 'compact');
    assert.equal(measurement.shellClear, true, `${measurement.route} shell overlaps the custom title bar: ${JSON.stringify(measurement)}`);
    assert.equal(measurement.mainClear, true, `${measurement.route} main scroller overlaps the custom title bar: ${JSON.stringify(measurement)}`);
    assert.equal(measurement.topbarClear, true, `${measurement.route} topbar overlaps the custom title bar: ${JSON.stringify(measurement)}`);
    assert.equal(measurement.titleVisible, true, `${measurement.route} title is clipped under the custom title bar: ${JSON.stringify(measurement)}`);
    if (measurement.route === '#usage') {
      assert.equal(measurement.localAnalyticsLoaded, true, 'Analytics must render from the local desktop bridge.');
      assert.equal(measurement.inlineUsageError, false, 'Local Analytics must not show an unavailable error in the browser probe.');
    }
    if (measurement.route === '#tools') {
      assert.equal(measurement.toolCategories.relai_exec, 'Execute');
      assert.equal(measurement.toolCategories.relai_process, 'Execute');
      assert.equal(measurement.toolCategories.relai_work, 'Workflow');
      assert.equal(measurement.toolCategories.relai_changes, 'Review · Recover');
    }
  }
  console.log('Electron custom-titlebar geometry is clear across Analytics, Tools, and Sessions.');
} finally {
  if (child && child.exitCode == null) child.kill('SIGKILL');
  if (server.exitCode == null) server.kill('SIGKILL');
  server.unref();
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function waitForProcessClose(childProcess, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => finish(['timeout']), timeoutMs);
    const onClose = (...args) => finish(args);
    childProcess.once('close', onClose);
    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      childProcess.removeListener('close', onClose);
      resolve(value);
    }
  });
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
      response.resume(); response.once('end', () => resolve(response.statusCode >= 200 && response.statusCode < 300));
    });
    request.once('error', () => resolve(false));
    request.setTimeout(1000, () => { request.destroy(); resolve(false); });
  });
}
async function availablePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  const selected = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return selected;
}
