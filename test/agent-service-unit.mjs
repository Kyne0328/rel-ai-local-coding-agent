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

  const recursiveParent = await service.create({
    work_id: 'work_recursive_parent', workspace: 'repo', objective: 'Parent delegated task.'
  }, principal);
  service.attach({ agent_id: recursiveParent.agent_id, work_id: 'work_recursive_child', workspace: 'repo' }, principal);
  const launchesBeforeRecursiveAttempt = runtime.sequence;
  await assert.rejects(
    () => service.create({ work_id: 'work_recursive_child', workspace: 'repo', objective: 'Forbidden grandchild.' }, principal),
    error => error?.code === 'AGENT_RECURSIVE_DELEGATION'
  );
  assert.equal(runtime.sequence, launchesBeforeRecursiveAttempt, 'recursive delegation must fail before opening another browser page');
  await service.cancel({ agent_id: recursiveParent.agent_id, reason: 'Recursive-delegation test cleanup.' }, principal);

  const waitingAgent = await service.create({
    work_id: 'work_parent_4', workspace: 'repo', objective: 'Wait for delegated MCP result.'
  }, principal);
  service.attach({ agent_id: waitingAgent.agent_id, work_id: 'work_child_4', workspace: 'repo' }, principal);
  const immediate = await service.status({ agent_id: waitingAgent.agent_id, waitMs: 0 }, principal);
  assert.equal(immediate.status, 'working', 'waitMs 0 must preserve immediate status behavior');
  const completion = new Promise(resolve => {
    setTimeout(() => {
      void service.complete({
        agent_id: waitingAgent.agent_id,
        child_work_id: 'work_child_4',
        result: { summary: 'Returned while parent waited.' }
      }, principal).then(resolve);
    }, 20);
  });
  const waited = await service.status({ agent_id: waitingAgent.agent_id, waitMs: 1000 }, principal);
  assert.equal(waited.status, 'completed');
  assert.equal(waited.agentResult.summary, 'Returned while parent waited.');
  await completion;
  await assert.rejects(
    () => service.status({ agent_id: waitingAgent.agent_id, waitMs: 60001 }, principal),
    /waitMs must be an integer between 0 and 60000/
  );

  const desktopAgent = await service.create({
    work_id: 'work_parent_5', workspace: 'repo', objective: 'Desktop cancellation.', reasoning: 'medium'
  }, principal);
  service.attach({ agent_id: desktopAgent.agent_id, work_id: 'work_child_5', workspace: 'repo' }, principal);
  assert.equal(service.listForDashboard({ limit: 20 }).some(agent => agent.agent_id === desktopAgent.agent_id && agent.status === 'working'), true);
  const desktopCancelled = await service.cancelForDashboard({ agent_id: desktopAgent.agent_id });
  assert.equal(desktopCancelled.status, 'cancelled');
  assert.equal(desktopCancelled.error, 'Cancelled from Rel.AI desktop.');
  assert.equal(runtime.active.size, 0, 'desktop cancellation must close the hidden runtime session');

  await service.dispose();
  console.log('Agent service launches delegated runtime sessions, enforces non-recursive delegation, supports bounded status waits and desktop visibility, and closes them on complete, fail, and cancel.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
