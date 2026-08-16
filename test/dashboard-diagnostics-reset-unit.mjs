import { startHttpServer } from "../src/httpServer.js";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-diagnostics-reset-'));
const stateDir = path.join(temp, 'state');
const configPath = path.join(temp, 'config.json');
const auditPath = path.join(stateDir, 'audit.jsonl');
const token = 'diagnostics-reset-token';
const previousConfig = process.env.REL_AI_MCP_CONFIG;
const previousState = process.env.REL_AI_MCP_STATE_DIR;
let taskActivity = { activeCalls: 0, activeTaskCount: 0, tasks: [] };
let resetCalls = 0;
let server;

try {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ stateDir, auditLogPath: auditPath, workspaces: {} }, null, 2));
  fs.writeFileSync(auditPath, '{"tool":"relai_read"}\n');
  fs.writeFileSync(`${auditPath}.1`, '{"tool":"relai_search"}\n');
  process.env.REL_AI_MCP_CONFIG = configPath;
  process.env.REL_AI_MCP_STATE_DIR = stateDir;


  server = startHttpServer({
    host: '127.0.0.1',
    port: 0,
    token,
    exitOnError: false,
    getTaskActivity: () => taskActivity,
    resetTaskActivity: () => { resetCalls += 1; return { ok: true }; }
  });
  await waitForListening(server);
  const port = server.address().port;
  const dashboardLogin = await fetch(`http://127.0.0.1:${port}/dashboard?token=${encodeURIComponent(token)}`);
  assert.equal(dashboardLogin.status, 200);
  const dashboardCookie = String(dashboardLogin.headers.get('set-cookie') || '').split(';')[0];
  assert.match(dashboardCookie, /^relai_dashboard_session=/);
  await dashboardLogin.arrayBuffer();
  const post = body => fetch(`http://127.0.0.1:${port}/api/diagnostics/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: dashboardCookie },
    body: JSON.stringify(body)
  });

  const missingConfirm = await post({ target: 'history' });
  assert.equal(missingConfirm.status, 400);

  taskActivity = { activeCalls: 1, activeTaskCount: 1, tasks: [{ taskId: 'running-task', status: 'running' }] };
  const active = await post({ target: 'history', confirm: true });
  assert.equal(active.status, 409);
  assert.match((await active.json()).error, /1 Rel\.AI task is still active/);
  assert.equal(fs.existsSync(`${auditPath}.1`), true);

  taskActivity = { activeCalls: 0, activeTaskCount: 1, tasks: [{ taskId: 'waiting-task', status: 'planning' }] };
  const waiting = await post({ target: 'history', confirm: true });
  assert.equal(waiting.status, 409, 'a logical task between tool calls must still protect its history');
  assert.equal(resetCalls, 0);

  taskActivity = { activeCalls: 0, activeTaskCount: 0, tasks: [] };
  const cleared = await post({ target: 'history', confirm: true });
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

console.log('Dashboard diagnostic history reset safeguards passed.');

function waitForListening(target) {
  if (target.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    target.once('listening', resolve);
    target.once('error', reject);
  });
}
