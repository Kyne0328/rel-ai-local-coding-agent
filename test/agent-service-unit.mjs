import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AgentService } from '../src/agents/agentService.js';
import { AgentRuntime } from '../src/agents/runtime.js';

class TrackingRuntime extends AgentRuntime {
  constructor() {
    super('tracking');
    this.sequence = 0;
    this.active = new Set();
    this.cancelled = [];
    this.prompts = [];
  }

  async getCapabilities() {
    return { runtime: this.name, reasoning: ['medium', 'high'] };
  }

  async spawn(_input, context) {
    const runtimeTaskId = `tracking_${++this.sequence}`;
    this.active.add(runtimeTaskId);
    this.prompts.push(context.prompt);
    return { runtimeTaskId, reasoning: 'high' };
  }

  async cancel(runtimeTaskId) {
    this.cancelled.push(runtimeTaskId);
    const cancelled = this.active.delete(runtimeTaskId);
    return { cancelled, alreadyTerminal: !cancelled };
  }

  async dispose() {
    this.active.clear();
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-agent-service-'));
const config = { stateDir: root };
const principal = { principal: { issuer: 'test', clientId: 'client-a', subject: 'user-1' }, publicHttpOnly: true };
const runtime = new TrackingRuntime();
const service = new AgentService({ config, runtime, connectorName: 'Rel.AI MCP' });

try {
  const completedAgent = await service.create({
    work_id: 'work_parent_1', workspace: 'repo', objective: 'Review lifecycle.', reasoning: 'high'
  }, principal);
  assert.equal(completedAgent.status, 'pending');
  assert.equal(service.pendingAttachTimers.size, 1);
  assert.equal(runtime.active.size, 1);
  assert.match(runtime.prompts[0], /connector named "Rel\.AI MCP"/);
  service.attach({ agent_id: completedAgent.agent_id, work_id: 'work_child_1', workspace: 'repo' }, principal);
  assert.equal(service.pendingAttachTimers.size, 0);
  const completed = await service.complete({
    agent_id: completedAgent.agent_id,
    child_work_id: 'work_child_1',
    result: { summary: 'Completed through MCP.' }
  }, principal);
  assert.equal(completed.status, 'completed');
  assert.equal(runtime.active.size, 0, 'completion must close the hidden runtime session');

  const failedAgent = await service.create({
    work_id: 'work_parent_2', workspace: 'repo', objective: 'Fail lifecycle.'
  }, principal);
  assert.equal(service.pendingAttachTimers.size, 1);
  service.attach({ agent_id: failedAgent.agent_id, work_id: 'work_child_2', workspace: 'repo' }, principal);
  assert.equal(service.pendingAttachTimers.size, 0);
  const failed = await service.fail({
    agent_id: failedAgent.agent_id, child_work_id: 'work_child_2', error: 'Child reported failure.'
  }, principal);
  assert.equal(failed.status, 'failed');
  assert.equal(runtime.active.size, 0, 'failure must close the hidden runtime session');

  const cancelledAgent = await service.create({
    work_id: 'work_parent_3', workspace: 'repo', objective: 'Cancel lifecycle.'
  }, principal);
  assert.equal(service.pendingAttachTimers.size, 1);
  const cancelled = await service.cancel({ agent_id: cancelledAgent.agent_id, reason: 'Parent stopped.' }, principal);
  assert.equal(service.pendingAttachTimers.size, 0);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(runtime.active.size, 0, 'parent cancellation must close the hidden runtime session');
  assert.equal(runtime.cancelled.length, 3);

  await service.dispose();
  console.log('Agent service launches delegated runtime sessions and closes them on complete, fail, and cancel.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
