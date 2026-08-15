import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolvePolicy, writeSessionPolicy, clearSessionPolicy, readSessionPolicy } from "../src/policyResolver.js";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-policy-'));
const config = { stateDir };
const alias = 'myapp';
const taskId = 'task-policy';
const sessionsDir = path.join(stateDir, 'sessions');
const sessionPath = path.join(sessionsDir, `${encodeURIComponent(alias)}--${encodeURIComponent(taskId)}-policy.json`);

function resetSession() {
  fs.rmSync(sessionPath, { force: true });
}

try {
  for (const workspace of [{ alias, path: stateDir }, alias, null, {}]) {
    resetSession();
    const policy = resolvePolicy(workspace, config);
    assert.equal(policy.sessionActive, false);
    assert.equal(policy.source, 'default');
    assert.equal(policy.trusted, true);
  }

  await assert.rejects(
    () => writeSessionPolicy(config, alias, { taskHint: 'missing identity' }),
    /taskId/,
    'new session policies must always be task-scoped'
  );

  await writeSessionPolicy(config, alias, { taskHint: 'fix auth bug', taskId });
  const session = readSessionPolicy(config, alias, taskId);
  assert.equal(session.workspace, alias);
  assert.equal(session.taskId, taskId);
  assert.equal(session.taskHint, 'fix auth bug');
  assert.match(session.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const active = resolvePolicy({ alias, path: stateDir }, config);
  assert.equal(active.trusted, false);
  assert.equal(active.sessionActive, true);
  assert.equal(active.baselineCaptured, false);
  assert.equal(active.taskHint, 'fix auth bug');
  assert.equal(active.source, 'task_session_file');
  assert.match(active.sessionCreatedAt, /^\d{4}-\d{2}-\d{2}T/);

  resetSession();
  await writeSessionPolicy(config, alias, { workspaceRoot: path.join(stateDir, 'missing-workspace'), taskId });
  const failedBaseline = resolvePolicy({ alias }, config);
  assert.equal(failedBaseline.sessionActive, true);
  assert.equal(failedBaseline.baselineCaptured, false);
  assert.equal(failedBaseline.trusted, false);
  assert.ok(failedBaseline.baselineCaptureError);

  assert.equal(clearSessionPolicy(config, alias, taskId).cleared, true);
  assert.equal(resolvePolicy({ alias }, config).sessionActive, false);
  assert.equal(clearSessionPolicy(config, alias, taskId).cleared, false);
  assert.equal(clearSessionPolicy(config, alias).cleared, false, 'unscoped cleanup must not touch another task session');

  const invalidPayloads = ['NOT JSON', '[1,2,3]', '{}', '42', '"sneaky"', 'null'];
  fs.mkdirSync(sessionsDir, { recursive: true });
  for (const payload of invalidPayloads) {
    fs.writeFileSync(sessionPath, payload, 'utf8');
    assert.equal(readSessionPolicy(config, alias, taskId), null, `invalid session payload must be rejected: ${payload}`);
    const policy = resolvePolicy({ alias }, config);
    assert.equal(policy.sessionActive, false);
    assert.equal(policy.trusted, true);
  }
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Policy resolver tests passed with task-scoped sessions and malformed persisted-session rejection.');
