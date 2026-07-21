import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-onboarding-config-'));
const configPath = path.join(stateDir, 'config.json');
const token = 'onboarding-config-token';
process.env.REL_AI_MCP_CONFIG = configPath;
process.env.REL_AI_MCP_STATE_DIR = stateDir;
process.env.REL_AI_MCP_TOKEN = token;

const require = createRequire(import.meta.url);
const { startHttpServer } = require('../src/httpServer.js');
const server = startHttpServer({ host: '127.0.0.1', port: 0, token, exitOnError: false });
await once(server, 'listening');
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;

try {
  assert.equal(fs.existsSync(configPath), false, 'CLI server should begin this regression test without a config');

  const skip = await fetch(`${base}/api/onboarding/complete`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ completed: false, skipped: true })
  });
  assert.equal(skip.status, 200, `onboarding skip should succeed, got ${skip.status}`);
  assert.equal(fs.existsSync(configPath), true, 'skipping onboarding must create config.json');

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(config.workspaces, {}, 'skipped onboarding must create an empty valid workspace map');

  const dashboard = await fetch(`${base}/api/dashboard/v10?requireHttpToken=0`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(dashboard.status, 200, `dashboard should load after onboarding skip, got ${dashboard.status}`);
  const dashboardBody = await dashboard.json();
  assert.equal(dashboardBody.ok, true);
  assert.deepEqual(dashboardBody.config.workspaces, []);

  const onboarding = JSON.parse(fs.readFileSync(path.join(stateDir, 'onboarding.json'), 'utf8'));
  assert.equal(onboarding.skipped, true);
  assert.equal(onboarding.completed, false);
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Onboarding config smoke passed');
