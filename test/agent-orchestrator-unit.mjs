import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AgentOrchestrator } from '../src/agents/orchestrator.js';
import { attachAgent, completeAgent, getAgentStatus } from '../src/agents/manager.js';
import { buildDelegatedAgentPrompt, MAX_PROMPT_CHARS } from '../src/agents/prompt.js';
import { AgentRuntime, FakeAgentRuntime } from '../src/agents/runtime.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-agent-orchestrator-'));
const config = { stateDir: root };
const principal = { principal: { issuer: 'test', clientId: 'client-a', subject: 'user-1' }, publicHttpOnly: true };
const otherPrincipal = { principal: { issuer: 'test', clientId: 'client-b', subject: 'user-2' }, publicHttpOnly: true };
let runtimeContext;

try {
  const runtime = new FakeAgentRuntime({
    availableReasoning: ['instant', 'medium', 'high'],
    handler: async (_task, context) => {
      runtimeContext = context;
      return { summary: 'A runtime response must not auto-complete the MCP agent.' };
    }
  });
  const orchestrator = new AgentOrchestrator({ config, runtime, connectorName: 'Rel.AI MCP' });
  const spawned = await orchestrator.spawn({
    work_id: 'work_parent',
    workspace: 'repo',
    objective: 'Review the connection lifecycle.',
    role: 'reviewer',
    reasoning: 'pro',
    context: { known: 'Only inspect the relevant connection files.' }
  }, principal);

  assert.equal(spawned.agent.status, 'pending');
  assert.equal(spawned.agent.reasoning, 'high', 'runtime capability negotiation must safely fall back from pro to high');
  assert.equal(spawned.launch.runtime, 'fake');
  assert.match(spawned.launch.runtimeTaskId, /^fake_agent_/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtimeContext.agentId, spawned.agent.agent_id);
  assert.equal(runtimeContext.connectorName, 'Rel.AI MCP');
  assert.match(runtimeContext.prompt, /exposes the Rel\.AI actions relai_work and relai_agent/);
  assert.match(runtimeContext.prompt, /display name may be "Rel\.AI MCP" or any user-chosen name/);
  assert.match(runtimeContext.prompt, /Do not use any other ChatGPT app or connector/);
  assert.equal(runtimeContext.prompt.includes('@Rel.AI MCP'), false);
  assert.match(runtimeContext.prompt, /relai_work/);
  assert.match(runtimeContext.prompt, /action "begin"/);
  assert.match(runtimeContext.prompt, /relai_agent/);
  assert.match(runtimeContext.prompt, /action "attach"/);
  assert.match(runtimeContext.prompt, /child_work_id/);
  assert.match(runtimeContext.prompt, /action "complete"/);
  assert.match(runtimeContext.prompt, /action "fail"/);
  assert.equal(getAgentStatus(config, { agent_id: spawned.agent.agent_id }, principal).status, 'pending', 'runtime output is not the authoritative result channel');

  attachAgent(config, { agent_id: spawned.agent.agent_id, work_id: 'work_child', workspace: 'repo' }, principal);
  completeAgent(config, {
    agent_id: spawned.agent.agent_id,
    child_work_id: 'work_child',
    result: { summary: 'Reviewed through MCP.', findings: ['No blocker'] }
  }, principal);
  assert.equal(orchestrator.status(spawned.agent.agent_id, principal).agentResult.summary, 'Reviewed through MCP.');
  assert.equal(await orchestrator.close(spawned.agent.agent_id), true);
  assert.equal(orchestrator.getLaunch(spawned.agent.agent_id), null);

  class CancelOrderRuntime extends AgentRuntime {
    constructor() { super('cancel-order'); this.agentId = ''; this.cancelCalls = 0; this.statusDuringCancel = ''; }
    async getCapabilities() { return { runtime: this.name, reasoning: ['medium'] }; }
    async spawn(_task, context) { this.agentId = context.agentId; return { runtimeTaskId: 'cancel_order_task', reasoning: 'medium' }; }
    async cancel() {
      this.cancelCalls += 1;
      this.statusDuringCancel = getAgentStatus(config, { agent_id: this.agentId }, principal).status;
      return { cancelled: true, alreadyTerminal: false };
    }
  }
  const cancelRuntime = new CancelOrderRuntime();
  const cancelOrchestrator = new AgentOrchestrator({ config, runtime: cancelRuntime, connectorName: 'Rel.AI MCP' });
  const cancellable = await cancelOrchestrator.spawn({
    work_id: 'work_parent_2', workspace: 'repo', objective: 'Inspect cancellation.'
  }, principal);
  await assert.rejects(
    () => cancelOrchestrator.cancel(cancellable.agent.agent_id, otherPrincipal),
    error => error?.code === 'AGENT_NOT_FOUND'
  );
  assert.equal(cancelRuntime.cancelCalls, 0, 'ownership must be checked before runtime cleanup');
  assert.equal(cancelOrchestrator.getLaunch(cancellable.agent.agent_id)?.runtimeTaskId, 'cancel_order_task');
  assert.equal((await cancelOrchestrator.cancel(cancellable.agent.agent_id, principal)).status, 'cancelled');
  assert.equal(cancelRuntime.statusDuringCancel, 'cancelled', 'durable cancellation must be visible before runtime cleanup');
  assert.equal(cancelOrchestrator.getLaunch(cancellable.agent.agent_id), null);

  class KnownFailingRuntime extends AgentRuntime {
    constructor() { super('known-failing'); }
    async getCapabilities() { return { runtime: this.name, reasoning: ['medium'] }; }
    async spawn() { const error = new Error('spoofed secret path C:/Users/test/.chatgpt/session-token'); error.code = 'CHATGPT_LOGIN_REQUIRED'; throw error; }
    async cancel() { return { cancelled: false }; }
  }
  const knownFailing = new AgentOrchestrator({ config, runtime: new KnownFailingRuntime() });
  let knownFailedAgentId = '';
  await assert.rejects(async () => knownFailing.spawn({ work_id: 'work_parent_3', workspace: 'repo', objective: 'Fail known launch.' }, principal), error => {
    knownFailedAgentId = error?.agentId || '';
    assert.equal(error?.code, 'CHATGPT_LOGIN_REQUIRED');
    assert.equal(error?.message, 'ChatGPT session is not authenticated. Open Settings > ChatGPT Subagents and sign in.');
    assert.equal(error?.operation, 'agent_launch');
    assert.match(error?.allowedAlternatives?.[0] || '', /Settings > ChatGPT Subagents/);
    assert.doesNotMatch(error?.message || '', /session-token|C:\/Users/);
    return true;
  });
  const knownFailureRecord = getAgentStatus(config, { agent_id: knownFailedAgentId }, principal);
  assert.equal(knownFailureRecord.status, 'failed');
  assert.equal(knownFailureRecord.errorCode, 'CHATGPT_LOGIN_REQUIRED');
  assert.equal(knownFailureRecord.error, 'ChatGPT session is not authenticated. Open Settings > ChatGPT Subagents and sign in.');

  class UnknownFailingRuntime extends AgentRuntime {
    constructor() { super('unknown-failing'); }
    async getCapabilities() { return { runtime: this.name, reasoning: ['medium'] }; }
    async spawn() { throw new Error('Playwright failed at C:/Users/test/private-profile with token=abc123'); }
    async cancel() { return { cancelled: false }; }
  }
  const unknownFailing = new AgentOrchestrator({ config, runtime: new UnknownFailingRuntime() });
  let unknownFailedAgentId = '';
  await assert.rejects(async () => unknownFailing.spawn({ work_id: 'work_parent_4', workspace: 'repo', objective: 'Fail unknown launch.' }, principal), error => {
    unknownFailedAgentId = error?.agentId || '';
    assert.equal(error?.code, 'AGENT_RUNTIME_START_FAILED');
    assert.equal(error?.message, 'Agent runtime failed to start delegated agent.');
    assert.doesNotMatch(error?.message || '', /private-profile|abc123/);
    return true;
  });
  const unknownFailureRecord = getAgentStatus(config, { agent_id: unknownFailedAgentId }, principal);
  assert.equal(unknownFailureRecord.status, 'failed');
  assert.equal(unknownFailureRecord.errorCode, 'AGENT_RUNTIME_START_FAILED');
  assert.equal(unknownFailureRecord.error, 'Agent runtime failed to start delegated agent.');
  assert.doesNotMatch(unknownFailureRecord.error, /private-profile|abc123/);

  const boundedPrompt = buildDelegatedAgentPrompt({
    agentId: `agent_${'x'.repeat(43)}`,
    connectorName: 'Rel.AI MCP',
    workspace: 'repo',
    objective: 'Inspect bounded context.',
    context: { huge: 'x'.repeat(100_000) }
  });
  assert.equal(boundedPrompt.length < MAX_PROMPT_CHARS, true);
  assert.match(boundedPrompt, /"truncated": true/);

  await orchestrator.dispose();
  await cancelOrchestrator.dispose();
  await knownFailing.dispose();
  await unknownFailing.dispose();
  console.log('Subagent prompt protocol, runtime negotiation, MCP-authoritative completion, cancellation, and launch-failure tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
