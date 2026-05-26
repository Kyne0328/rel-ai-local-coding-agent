import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolvePolicy, writeSessionPolicy, clearSessionPolicy, readSessionPolicy } = require('../src/policyResolver.js');

function makeTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relai-pr-'));
}

// 1. No session file → sessionActive: false, trusted: true, source: "default"
{
  const stateDir = makeTempStateDir();
  const config = { stateDir };
  const workspace = { alias: 'myapp', path: stateDir };
  const policy = resolvePolicy(workspace, config);
  assert.equal(policy.trusted, true, 'trusted must be true');
  assert.equal(policy.sessionActive, false, 'no session: sessionActive must be false');
  assert.equal(policy.sessionCreatedAt, null, 'no session: sessionCreatedAt must be null');
  assert.equal(policy.taskHint, null, 'no session: taskHint must be null');
  assert.equal(policy.source, 'default', 'no session: source must be default');
  fs.rmSync(stateDir, { recursive: true, force: true });
}

// 2. writeSessionPolicy + readSessionPolicy round-trip
{
  const stateDir = makeTempStateDir();
  const config = { stateDir };
  writeSessionPolicy(config, 'myapp', { taskHint: 'fix auth bug' });
  const session = readSessionPolicy(config, 'myapp');
  assert.ok(session, 'session must be non-null after write');
  assert.equal(session.workspace, 'myapp', 'workspace must match');
  assert.equal(session.taskHint, 'fix auth bug', 'taskHint must match');
  assert.ok(typeof session.createdAt === 'string', 'createdAt must be a string');
  fs.rmSync(stateDir, { recursive: true, force: true });
}

// 3. resolvePolicy with session file → sessionActive: true, source: "session_file"
{
  const stateDir = makeTempStateDir();
  const config = { stateDir };
  const workspace = { alias: 'myapp', path: stateDir };
  writeSessionPolicy(config, 'myapp', { taskHint: 'implement feature X' });
  const policy = resolvePolicy(workspace, config);
  assert.equal(policy.trusted, true);
  assert.equal(policy.sessionActive, true, 'with session: sessionActive must be true');
  assert.equal(policy.taskHint, 'implement feature X', 'taskHint must be populated');
  assert.equal(policy.source, 'session_file', 'source must be session_file');
  assert.ok(typeof policy.sessionCreatedAt === 'string', 'sessionCreatedAt must be a string');
  fs.rmSync(stateDir, { recursive: true, force: true });
}

// 4. clearSessionPolicy removes file → resolvePolicy returns sessionActive: false
{
  const stateDir = makeTempStateDir();
  const config = { stateDir };
  const workspace = { alias: 'myapp', path: stateDir };
  writeSessionPolicy(config, 'myapp', {});
  const { cleared } = clearSessionPolicy(config, 'myapp');
  assert.equal(cleared, true, 'cleared must be true');
  const policy = resolvePolicy(workspace, config);
  assert.equal(policy.sessionActive, false, 'after clear: sessionActive must be false');
  fs.rmSync(stateDir, { recursive: true, force: true });
}

// 5. clearSessionPolicy when file missing → no error, cleared: false
{
  const stateDir = makeTempStateDir();
  const config = { stateDir };
  const { cleared } = clearSessionPolicy(config, 'nofile');
  assert.equal(cleared, false, 'missing file: cleared must be false');
  fs.rmSync(stateDir, { recursive: true, force: true });
}

// 6. Corrupt session file → resolvePolicy returns sessionActive: false, no throw
{
  const stateDir = makeTempStateDir();
  const config = { stateDir };
  const workspace = { alias: 'myapp', path: stateDir };
  fs.mkdirSync(path.join(stateDir, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'sessions', 'myapp-policy.json'), 'NOT JSON', 'utf8');
  const policy = resolvePolicy(workspace, config);
  assert.equal(policy.sessionActive, false, 'corrupt file: sessionActive must be false');
  assert.equal(policy.trusted, true, 'corrupt file: trusted must still be true');
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('policyResolver unit tests passed.');
