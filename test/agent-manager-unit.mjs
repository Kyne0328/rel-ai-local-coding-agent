import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { attachAgent, cancelAgent, completeAgent, createAgent, failAgent, failAgentLaunch, getAgentStatus } from '../src/agents/manager.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-agent-manager-'));
const config = { stateDir: root };
const parent = { principal: { issuer: 'test', clientId: 'client-a', subject: 'user-1' }, publicHttpOnly: true };
const sameUser = { principal: { issuer: 'test', clientId: 'client-a', subject: 'user-1' }, publicHttpOnly: true };
const otherUser = { principal: { issuer: 'test', clientId: 'client-b', subject: 'user-2' }, publicHttpOnly: true };

try {
  const created = createAgent(config, {
    work_id: 'work_parent',
    workspace: 'repo',
    role: 'reviewer',
    reasoning: 'high',
    objective: 'Review the change.',
    connectorName: 'Rel.AI MCP'
  }, parent);
  assert.match(created.agent_id, /^agent_/);
  assert.equal(created.status, 'pending');
  assert.equal(created.errorCode, null);
  assert.equal(created.parent_work_id, 'work_parent');
  assert.equal(created.connectorName, 'Rel.AI MCP');

  assert.throws(() => getAgentStatus(config, { agent_id: created.agent_id }, otherUser), error => error?.code === 'AGENT_NOT_FOUND');
  assert.throws(
    () => attachAgent(config, { agent_id: created.agent_id, work_id: 'work_parent', workspace: 'repo' }, sameUser),
    error => error?.code === 'AGENT_PARENT_TASK_REUSE'
  );
  assert.throws(
    () => attachAgent(config, { agent_id: created.agent_id, work_id: 'work_child', workspace: 'other-repo' }, sameUser),
    error => error?.code === 'AGENT_WORKSPACE_MISMATCH'
  );

  const attached = attachAgent(config, { agent_id: created.agent_id, work_id: 'work_child', workspace: 'repo' }, sameUser);
  assert.equal(attached.status, 'working');
  assert.equal(attached.child_work_id, 'work_child');
  assert.ok(attached.attachedAt);
  assert.equal(attachAgent(config, { agent_id: created.agent_id, work_id: 'work_child', workspace: 'repo' }, sameUser).child_work_id, 'work_child');
  assert.throws(
    () => attachAgent(config, { agent_id: created.agent_id, work_id: 'work_other_child', workspace: 'repo' }, sameUser),
    error => error?.code === 'AGENT_ALREADY_ATTACHED'
  );
  assert.throws(
    () => completeAgent(config, { agent_id: created.agent_id, child_work_id: 'work_other_child', result: { summary: 'wrong task' } }, sameUser),
    error => error?.code === 'AGENT_CHILD_TASK_MISMATCH'
  );

  const completed = completeAgent(config, {
    agent_id: created.agent_id,
    child_work_id: 'work_child',
    result: { summary: 'Reviewed.', findings: ['No blocker'], files: ['src/a.js'] }
  }, sameUser);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.errorCode, null);
  assert.equal(completed.agentResult.summary, 'Reviewed.');
  assert.deepEqual(completed.agentResult.findings, ['No blocker']);
  assert.equal(completeAgent(config, { agent_id: created.agent_id, child_work_id: 'work_child', result: { summary: 'ignored' } }, sameUser).agentResult.summary, 'Reviewed.');
  assert.throws(() => cancelAgent(config, { agent_id: created.agent_id }, sameUser), error => error?.code === 'INVALID_AGENT_STATE');

  const failing = createAgent(config, { work_id: 'work_parent', workspace: 'repo', objective: 'Fail.' }, parent);
  attachAgent(config, { agent_id: failing.agent_id, work_id: 'work_child_fail', workspace: 'repo' }, sameUser);
  const childFailure = failAgent(config, { agent_id: failing.agent_id, child_work_id: 'work_child_fail', error: 'runtime failed' }, sameUser);
  assert.equal(childFailure.status, 'failed');
  assert.equal(childFailure.errorCode, null);

  const launchFailing = createAgent(config, { work_id: 'work_parent', workspace: 'repo', objective: 'Fail before attach.' }, parent);
  const launchFailure = failAgentLaunch(config, { agent_id: launchFailing.agent_id, error: 'safe launch failure' }, sameUser);
  assert.equal(launchFailure.status, 'failed');
  assert.equal(launchFailure.child_work_id, null);
  assert.equal(launchFailure.error, 'safe launch failure');
  assert.equal(launchFailure.errorCode, 'AGENT_RUNTIME_START_FAILED');
  assert.throws(() => failAgentLaunch(config, { agent_id: launchFailing.agent_id, error: 'ignored' }, otherUser), error => error?.code === 'AGENT_NOT_FOUND');

  const cancelling = createAgent(config, { work_id: 'work_parent', workspace: 'repo', objective: 'Cancel.' }, parent);
  const cancelled = cancelAgent(config, { agent_id: cancelling.agent_id, reason: 'parent cancelled' }, sameUser);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.errorCode, null);

  console.log('Delegated agent ownership, attachment, completion, failure, cancellation, and persistence tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
