import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  clearSessionPolicy,
  ensureSessionStarted,
  readSessionPolicy,
  touchSessionPolicy,
  writeSessionPolicy,
  SESSION_TOUCH_PERSIST_INTERVAL_MS
} from '../src/policyResolver.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-policy-cache-'));
const config = { stateDir: path.join(root, 'state') };
const workspaceRoot = path.join(root, 'workspace');
fs.mkdirSync(workspaceRoot, { recursive: true });

function taskFile(alias, taskId) {
  return path.join(config.stateDir, 'sessions', `${encodeURIComponent(alias)}--${encodeURIComponent(taskId)}-policy.json`);
}

try {
  const alias = 'app';
  const taskId = 'task-1';
  writeSessionPolicy(config, alias, { workspaceRoot, taskId, taskHint: 'cache test' });
  const file = taskFile(alias, taskId);
  const persistedBeforeTouch = fs.readFileSync(file, 'utf8');

  assert.equal(touchSessionPolicy(config, alias, taskId), true);
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    persistedBeforeTouch,
    'hot-path activity touches must update memory without rewriting the policy JSON inside the persistence interval'
  );
  assert.equal(readSessionPolicy(config, alias, taskId)?.taskHint, 'cache test');
  assert.equal(
    ensureSessionStarted(config, alias, workspaceRoot, { taskId, taskHint: 'ignored' }),
    false,
    'an active cached session must not recapture baseline state'
  );
  assert.equal(fs.readFileSync(file, 'utf8'), persistedBeforeTouch);

  assert.equal(clearSessionPolicy(config, alias, taskId).cleared, true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(readSessionPolicy(config, alias, taskId), null, 'clearing a session removes both disk and memory state');

  const oldTaskId = 'task-old';
  const oldFile = taskFile(alias, oldTaskId);
  fs.mkdirSync(path.dirname(oldFile), { recursive: true });
  const oldUpdatedAt = new Date(Date.now() - SESSION_TOUCH_PERSIST_INTERVAL_MS - 5_000).toISOString();
  fs.writeFileSync(oldFile, `${JSON.stringify({
    workspace: alias,
    taskId: oldTaskId,
    createdAt: oldUpdatedAt,
    updatedAt: oldUpdatedAt,
    baselineCaptured: true,
    baselineDirty: []
  }, null, 2)}\n`);

  assert.equal(touchSessionPolicy(config, alias, oldTaskId), true);
  const persistedOldTouch = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
  assert.ok(
    Date.parse(persistedOldTouch.updatedAt) > Date.parse(oldUpdatedAt),
    'a touch after the persistence interval must refresh durable activity time'
  );
  clearSessionPolicy(config, alias, oldTaskId);

  console.log('Session policy memory-cache and persistence-throttle tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
