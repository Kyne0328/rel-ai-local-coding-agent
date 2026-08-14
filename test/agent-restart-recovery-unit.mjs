import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { disposeAgentServices, getAgentService } from '../src/agents/agentService.js';
import { attachAgent, cancelAgent, completeAgent, createAgent, failAgent, getAgentStatus, reconcileOrphanedAgents } from '../src/agents/manager.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-agent-recovery-'));
const config = { stateDir: root };
const owner = { principal: { issuer: 'test', clientId: 'client-a', subject: 'owner' }, publicHttpOnly: true };
const other = { principal: { issuer: 'test', clientId: 'client-a', subject: 'other' }, publicHttpOnly: true };
const recoveredAt = '2026-08-14T11:30:00.000Z';
try {
  const pending = createAgent(config, { work_id: 'parent_pending', workspace: 'repo', objective: 'Pending work.' }, owner);
  const working = createAgent(config, { work_id: 'parent_working', workspace: 'repo', objective: 'Working work.' }, owner);
  attachAgent(config, { agent_id: working.agent_id, work_id: 'child_working', workspace: 'repo' }, owner);
  const completed = createAgent(config, { work_id: 'parent_completed', workspace: 'repo', objective: 'Completed work.' }, owner);
  attachAgent(config, { agent_id: completed.agent_id, work_id: 'child_completed', workspace: 'repo' }, owner);
  completeAgent(config, { agent_id: completed.agent_id, child_work_id: 'child_completed', result: { summary: 'Done.' } }, owner);
  const failed = createAgent(config, { work_id: 'parent_failed', workspace: 'repo', objective: 'Failed work.' }, owner);
  attachAgent(config, { agent_id: failed.agent_id, work_id: 'child_failed', workspace: 'repo' }, owner);
  failAgent(config, { agent_id: failed.agent_id, child_work_id: 'child_failed', error: 'Original failure.' }, owner);
  const cancelled = createAgent(config, { work_id: 'parent_cancelled', workspace: 'repo', objective: 'Cancelled work.' }, owner);
  cancelAgent(config, { agent_id: cancelled.agent_id, reason: 'Already cancelled.' }, owner);
  const metadataPath = path.join(root, 'agents', 'chatgpt-web.json');
  const metadata = { schemaVersion: 1, authenticatedAt: recoveredAt, reasoning: ['medium', 'high'] };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  const corruptAgentPath = path.join(root, 'agents', `agent_${'z'.repeat(43)}.json`);
  fs.writeFileSync(corruptAgentPath, '{not valid json');
  assert.deepEqual(reconcileOrphanedAgents({ stateDir: path.join(root, 'empty-state') }, { now: recoveredAt }), { reconciled: 0 });
  const recovery = reconcileOrphanedAgents(config, { now: recoveredAt });
  assert.deepEqual(recovery, { reconciled: 2 });
  for (const agent of [pending, working]) {
    const record = getAgentStatus(config, { agent_id: agent.agent_id }, owner);
    assert.equal(record.status, 'failed');
    assert.equal(record.completedAt, recoveredAt);
    assert.equal(record.errorCode, 'AGENT_RESTARTED');
    assert.match(record.error, /Rel\.AI restarted before this delegated agent returned an MCP result/);
    assert.match(record.error, /create a new delegated agent/i);
    assert.throws(() => getAgentStatus(config, { agent_id: agent.agent_id }, other), error => error?.code === 'AGENT_NOT_FOUND');
  }
  assert.equal(getAgentStatus(config, { agent_id: completed.agent_id }, owner).agentResult.summary, 'Done.');
  assert.equal(getAgentStatus(config, { agent_id: completed.agent_id }, owner).errorCode, null);
  assert.equal(getAgentStatus(config, { agent_id: failed.agent_id }, owner).error, 'Original failure.');
  assert.equal(getAgentStatus(config, { agent_id: cancelled.agent_id }, owner).error, 'Already cancelled.');
  assert.deepEqual(JSON.parse(fs.readFileSync(metadataPath, 'utf8')), metadata, 'ChatGPT authentication metadata must not be treated as an agent record');
  assert.equal(fs.readFileSync(corruptAgentPath, 'utf8'), '{not valid json', 'corrupt matching agent records must be skipped without rewrite');
  assert.deepEqual(reconcileOrphanedAgents(config, { now: recoveredAt }), { reconciled: 0 }, 'recovery must be idempotent');
  const servicePending = createAgent(config, { work_id: 'parent_service', workspace: 'repo', objective: 'Recover on service start.' }, owner);
  const service = await getAgentService(config);
  assert.equal((await service.status({ agent_id: servicePending.agent_id }, owner)).status, 'failed', 'default agent service creation must reconcile orphaned durable agents');
  await disposeAgentServices(config);
  console.log('Orphaned delegated agents fail safely on restart while terminal records, auth metadata, and ownership remain intact.');
} finally {
  await disposeAgentServices(config);
  fs.rmSync(root, { recursive: true, force: true });
}