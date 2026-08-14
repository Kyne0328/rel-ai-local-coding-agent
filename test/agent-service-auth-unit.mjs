import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentService } from '../src/agents/agentService.js';
import { AgentRuntime } from '../src/agents/runtime.js';
class AuthRuntime extends AgentRuntime {
  constructor() { super('auth-test'); this.opened = 0; this.finished = 0; }
  async getCapabilities() { return { runtime: this.name, reasoning: ['medium', 'high'] }; }
  authenticationStatus() { return { runtime: this.name, status: 'authentication_saved', authenticatedAt: '2026-08-14T10:00:00.000Z', reasoning: ['medium', 'high'] }; }
  async beginAuthentication() { this.opened += 1; return { runtime: this.name, status: 'authentication_open' }; }
  async finishAuthentication() { this.finished += 1; return { runtime: this.name, status: 'authenticated', reasoning: ['medium', 'high'] }; }
  async spawn() { throw new Error('not used'); }
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-agent-auth-'));
try {
  const runtime = new AuthRuntime();
  const service = new AgentService({ config: { stateDir: root }, runtime });
  assert.deepEqual(await service.authenticationStatus(), {
    runtime: 'auth-test',
    status: 'authentication_saved',
    authenticatedAt: '2026-08-14T10:00:00.000Z',
    reasoning: ['medium', 'high']
  });
  assert.equal((await service.beginAuthentication()).status, 'authentication_open');
  assert.equal((await service.finishAuthentication()).status, 'authenticated');
  assert.equal(runtime.opened, 1);
  assert.equal(runtime.finished, 1);

  const unsignedRuntime = new AuthRuntime();
  unsignedRuntime.authenticationStatus = () => ({ runtime: 'auth-test', status: 'not_authenticated', authenticatedAt: null });
  const unsignedService = new AgentService({ config: { stateDir: root }, runtime: unsignedRuntime });
  assert.deepEqual((await unsignedService.authenticationStatus()).reasoning, [], 'unverified runtime defaults must not be presented as detected account capabilities');
  await unsignedService.dispose();
  await service.dispose();
  console.log('Agent service exposes safe authentication status and lifecycle methods.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}