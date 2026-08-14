import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AgentService, ATTACH_TIMEOUT_CODE, DEFAULT_AGENT_ATTACH_TIMEOUT_MS } from '../src/agents/agentService.js';
import { AgentRuntime } from '../src/agents/runtime.js';

class TrackingRuntime extends AgentRuntime {
  constructor() {
    super('attach-timeout-test');
    this.sequence = 0;
    this.active = new Set();
    this.cancelled = [];
  }

  async getCapabilities() {
    return { runtime: this.name, reasoning: ['medium'] };
  }

  async spawn() {
    const runtimeTaskId = `timeout_${++this.sequence}`;
    this.active.add(runtimeTaskId);
    return { runtimeTaskId, reasoning: 'medium' };
  }

  async cancel(runtimeTaskId) {
    this.cancelled.push(runtimeTaskId);
    return { cancelled: this.active.delete(runtimeTaskId) };
  }

  async dispose() {
    this.active.clear();
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-agent-attach-timeout-'));
const config = { stateDir: root };
const owner = { principal: { issuer: 'test', clientId: 'client-a', subject: 'owner' }, publicHttpOnly: true };
const other = { principal: { issuer: 'test', clientId: 'client-a', subject: 'other' }, publicHttpOnly: true };
const runtime = new TrackingRuntime();
const service = new AgentService({ config, runtime, attachTimeoutMs: 25 });

try {
  assert.equal(DEFAULT_AGENT_ATTACH_TIMEOUT_MS, 120_000);
  assert.equal(ATTACH_TIMEOUT_CODE, 'AGENT_ATTACH_TIMEOUT');

  const timedOut = await service.create({
    work_id: 'parent_timeout', workspace: 'repo', objective: 'Attach through MCP.'
  }, owner);
  assert.equal(service.pendingAttachTimers.size, 1);
  await delay(80);

  const timedOutStatus = await service.status({ agent_id: timedOut.agent_id }, owner);
  assert.equal(timedOutStatus.status, 'failed');
  assert.equal(timedOutStatus.errorCode, ATTACH_TIMEOUT_CODE);
  assert.match(timedOutStatus.error, /did not attach to Rel\.AI MCP/i);
  assert.match(timedOutStatus.error, /confirm Rel\.AI MCP is enabled in ChatGPT/i);
  assert.equal(service.pendingAttachTimers.size, 0);
  assert.equal(runtime.active.size, 0, 'attach timeout must close the hidden ChatGPT runtime session');
  assert.deepEqual(runtime.cancelled, ['timeout_1']);
  await assert.rejects(
    () => service.status({ agent_id: timedOut.agent_id }, other),
    error => error?.code === 'AGENT_NOT_FOUND'
  );

  const attached = await service.create({
    work_id: 'parent_attached', workspace: 'repo', objective: 'Attach in time.'
  }, owner);
  assert.equal(service.pendingAttachTimers.size, 1);
  const attachedStatus = service.attach({
    agent_id: attached.agent_id, work_id: 'child_attached', workspace: 'repo'
  }, owner);
  assert.equal(attachedStatus.status, 'working');
  assert.equal(attachedStatus.errorCode, null);
  assert.equal(service.pendingAttachTimers.size, 0);
  await delay(60);
  assert.equal((await service.status({ agent_id: attached.agent_id }, owner)).status, 'working');
  assert.equal(runtime.active.size, 1, 'timely attach must keep the delegated browser session alive');
  await service.cancel({ agent_id: attached.agent_id, reason: 'Test cleanup.' }, owner);
  assert.equal(runtime.active.size, 0);

  const raceWinner = await service.create({
    work_id: 'parent_race', workspace: 'repo', objective: 'Attach before late timeout callback.'
  }, owner);
  service.attach({ agent_id: raceWinner.agent_id, work_id: 'child_race', workspace: 'repo' }, owner);
  const activeBeforeLateTimeout = runtime.active.size;
  await service.expireUnattachedAgent(raceWinner.agent_id, owner);
  const raceStatus = await service.status({ agent_id: raceWinner.agent_id }, owner);
  assert.equal(raceStatus.status, 'working');
  assert.equal(raceStatus.errorCode, null);
  assert.equal(runtime.active.size, activeBeforeLateTimeout, 'a late timeout callback must not close a child that already attached');
  await service.cancel({ agent_id: raceWinner.agent_id, reason: 'Race test cleanup.' }, owner);

  const disposed = await service.create({
    work_id: 'parent_disposed', workspace: 'repo', objective: 'Dispose before attach timeout.'
  }, owner);
  assert.equal(service.pendingAttachTimers.size, 1);
  await service.dispose();
  assert.equal(service.pendingAttachTimers.size, 0);
  await delay(60);
  assert.equal((await service.status({ agent_id: disposed.agent_id }, owner)).status, 'pending', 'dispose must clear attach timers instead of firing after shutdown');

  console.log('Subagent MCP attach timeout closes orphaned browser launches, preserves timely attaches, clears timers, and keeps ownership isolated.');
} finally {
  await service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
