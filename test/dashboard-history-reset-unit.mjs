import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-history-reset-'));
const stateDir = path.join(temp, 'state');
const configPath = path.join(temp, 'config.json');
const auditPath = path.join(stateDir, 'audit.jsonl');
const token = 'history-reset-token';
const previousConfig = process.env.REL_AI_MCP_CONFIG;
const previousState = process.env.REL_AI_MCP_STATE_DIR;
let activeCalls = 0;
let resetCalls = 0;
let server;

try {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ stateDir, auditLogPath: auditPath, workspaces: {} }, null, 2));
  fs.writeFileSync(auditPath, '{"tool":"relai_read"}\n');
  fs.writeFileSync(`${auditPath}.1`, '{"tool":"relai_search"}\n');
  process.env.REL_AI_MCP_CONFIG = configPath;
  process.env.REL_AI_MCP_STATE_DIR = stateDir;

  const { startHttpServer } = require('../src/httpServer.js');
  server = startHttpServer({
    host: '127.0.0.1',
    port: 0,
    token,
    exitOnError: false,
    getTaskActivity: () => ({ activeCalls }),
    resetTaskActivity: () => { resetCalls += 1; return { ok: true }; }
  });
  await waitForListening(server);
  const port = server.address().port;
  const post = body => fetch(`http://127.0.0.1:${port}/api/history/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });

  const missingConfirm = await post({});
  assert.equal(missingConfirm.status, 400);

  activeCalls = 1;
  const active = await post({ confirm: true });
  assert.equal(active.status, 409);
  assert.match((await active.json()).error, /tool call is running/);
  assert.equal(fs.existsSync(`${auditPath}.1`), true);

  activeCalls = 0;
  const cleared = await post({ confirm: true });
  const payload = await cleared.json();
  assert.equal(cleared.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(resetCalls, 1);
  assert.equal(fs.readFileSync(auditPath, 'utf8'), '');
  assert.equal(fs.existsSync(`${auditPath}.1`), false);
} finally {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  if (previousState == null) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousState;
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Dashboard history reset safeguards passed.');

function waitForListening(target) {
  if (target.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    target.once('listening', resolve);
    target.once('error', reject);
  });
}
