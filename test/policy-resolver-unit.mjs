import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolvePolicy, writeSessionPolicy, clearSessionPolicy, readSessionPolicy } = require('../src/policyResolver.js');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-policy-'));
const config = { stateDir };
const alias = 'myapp';
const sessionsDir = path.join(stateDir, 'sessions');
const sessionPath = path.join(sessionsDir, `${alias}-policy.json`);

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

  writeSessionPolicy(config, alias, { taskHint: 'fix auth bug' });
  const session = readSessionPolicy(config, alias);
  assert.equal(session.workspace, alias);
  assert.equal(session.taskHint, 'fix auth bug');
  assert.match(session.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const active = resolvePolicy({ alias, path: stateDir }, config);
  assert.equal(active.trusted, false);
  assert.equal(active.sessionActive, true);
  assert.equal(active.baselineCaptured, false);
  assert.equal(active.taskHint, 'fix auth bug');
  assert.equal(active.source, 'legacy_session_file');
  assert.match(active.sessionCreatedAt, /^\d{4}-\d{2}-\d{2}T/);

  resetSession();
  writeSessionPolicy(config, alias, { workspaceRoot: path.join(stateDir, 'missing-workspace') });
  const failedBaseline = resolvePolicy({ alias }, config);
  assert.equal(failedBaseline.sessionActive, true);
  assert.equal(failedBaseline.baselineCaptured, false);
  assert.equal(failedBaseline.trusted, false);
  assert.ok(failedBaseline.baselineCaptureError);

  assert.equal(clearSessionPolicy(config, alias).cleared, true);
  assert.equal(resolvePolicy({ alias }, config).sessionActive, false);
  assert.equal(clearSessionPolicy(config, alias).cleared, false);

  const invalidPayloads = ['NOT JSON', '[1,2,3]', '{}', '42', '"sneaky"', 'null'];
  fs.mkdirSync(sessionsDir, { recursive: true });
  for (const payload of invalidPayloads) {
    fs.writeFileSync(sessionPath, payload, 'utf8');
    assert.equal(readSessionPolicy(config, alias), null, `invalid session payload must be rejected: ${payload}`);
    const policy = resolvePolicy({ alias }, config);
    assert.equal(policy.sessionActive, false);
    assert.equal(policy.trusted, true);
  }
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Policy resolver tests passed, including malformed persisted-session cases.');
