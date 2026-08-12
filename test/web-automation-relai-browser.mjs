import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHttpServer } from '../src/httpServer.js';
import { runUiAction, stopAllUiSessions } from '../src/webAutomationManager.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-web-automation-'));
const stateDir = path.join(temp, 'state');
const configPath = path.join(temp, 'config.json');
const previous = {
  config: process.env.REL_AI_MCP_CONFIG,
  state: process.env.REL_AI_MCP_STATE_DIR,
  isolated: process.env.REL_AI_MCP_ISOLATED
};
const taskId = 'work_web_automation_acceptance';
const workspace = { alias: 'rel-ai-mcp', path: root };
let server;
let sessionId = '';

fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(configPath, JSON.stringify({
  version: 3,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: {
    'rel-ai-mcp': { path: root, commands: {}, testCommands: {} }
  }
}, null, 2));
process.env.REL_AI_MCP_CONFIG = configPath;
process.env.REL_AI_MCP_STATE_DIR = stateDir;
process.env.REL_AI_MCP_ISOLATED = '1';

try {
  server = startHttpServer({
    host: '127.0.0.1',
    port: 0,
    allowNoAuth: true,
    isolated: true,
    writeProfile: false,
    exitOnError: false
  });
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object' && address.port > 0);

  const context = { taskId };
  const started = await runUiAction(workspace, {}, {
    action: 'start',
    port: address.port,
    route: '/dashboard',
    width: 1280,
    height: 800,
    work_id: taskId
  }, context);
  sessionId = started.sessionId;
  assert.equal(started.ok, true);
  assert.equal(started.statusCode, 200);
  assert.equal(started.browserEngine, 'chromium');
  assert.equal(started.url.includes('/dashboard'), true);
  assert.deepEqual(started.viewport, { width: 1280, height: 800 });

  const snapshot = await runUiAction(workspace, {}, {
    action: 'snapshot', sessionId, work_id: taskId
  }, context);
  assert.equal(snapshot.ok, true);
  assert.match(snapshot.snapshot, /Rel\.AI|Home|Workspace/i);

  const screenshot = await runUiAction(workspace, {}, {
    action: 'screenshot', sessionId, work_id: taskId
  }, context);
  assert.equal(screenshot.image.mimeType, 'image/png');
  assert.ok(screenshot.image.bytes > 1000);
  const imageBytes = Buffer.from(screenshot.image.data, 'base64');
  assert.equal(imageBytes.subarray(1, 4).toString('ascii'), 'PNG');

  const expandedSettings = await runUiAction(workspace, {}, {
    action: 'interact',
    sessionId,
    interaction: 'click',
    target: { by: 'css', value: 'summary[aria-label="Settings"]' },
    work_id: taskId
  }, context);
  assert.equal(expandedSettings.ok, true);
  assert.equal(expandedSettings.interaction, 'click');

  const interacted = await runUiAction(workspace, {}, {
    action: 'interact',
    sessionId,
    interaction: 'click',
    target: { by: 'role', value: 'link', name: 'Preferences', exact: true },
    work_id: taskId
  }, context);
  assert.equal(interacted.ok, true);
  assert.equal(interacted.interaction, 'click');
  assert.match(interacted.url, /#settings$/);

  await runUiAction(workspace, {}, {
    action: 'viewport', sessionId, width: 390, height: 844, work_id: taskId
  }, context);
  const mobileScreenshot = await runUiAction(workspace, {}, {
    action: 'screenshot', sessionId, work_id: taskId
  }, context);
  assert.deepEqual(mobileScreenshot.viewport, { width: 390, height: 844 });

  const consoleResult = await runUiAction(workspace, {}, {
    action: 'console', sessionId, maxEntries: 50, work_id: taskId
  }, context);
  assert.ok(Array.isArray(consoleResult.consoleEntries));

  const networkResult = await runUiAction(workspace, {}, {
    action: 'network', sessionId, maxEntries: 50, work_id: taskId
  }, context);
  assert.ok(Array.isArray(networkResult.networkEntries));
  assert.equal(networkResult.networkEntries.some(entry => /https?:\/\/(?!127\.0\.0\.1|localhost|\[?::1\]?)/i.test(entry.url || '') && entry.type !== 'blocked'), false);

  const stopped = await runUiAction(workspace, {}, {
    action: 'stop', sessionId, work_id: taskId
  }, context);
  sessionId = '';
  assert.equal(stopped.ok, true);
  assert.equal(stopped.status, 'stopped');
  console.log(`Rel.AI dashboard web automation passed with ${started.browserProduct}.`);
} finally {
  if (sessionId) await stopAllUiSessions().catch(() => {});
  if (server?.listening) {
    server.close();
    await once(server, 'close');
    await server.waitForShutdown?.();
  }
  restoreEnv('REL_AI_MCP_CONFIG', previous.config);
  restoreEnv('REL_AI_MCP_STATE_DIR', previous.state);
  restoreEnv('REL_AI_MCP_ISOLATED', previous.isolated);
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function restoreEnv(name, value) {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}
