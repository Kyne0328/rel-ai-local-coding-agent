import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  clearTaskHistory,
  getTaskHistoryDir,
  readTaskHistory,
  recordTaskHistoryEvent
} = require('../src/taskHistoryStore.js');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-history-store-'));
const config = {
  stateDir: sandbox,
  auditLogPath: path.join(sandbox, 'audit.jsonl')
};
fs.writeFileSync(config.auditLogPath, '', 'utf8');

try {
  const base = Date.parse('2026-07-25T00:00:00.000Z');
  for (let index = 0; index < 251; index += 1) {
    recordTaskHistoryEvent(config, {
      taskId: `task-${String(index).padStart(3, '0')}`,
      ts: new Date(base + index * 1000).toISOString(),
      tool: 'relai_read',
      operation: `Reading task ${index}`,
      workspace: 'repo',
      ok: true,
      ms: 5
    });
  }

  const sessions = readTaskHistory(config, { state: 'idle' }, { limit: 500 });
  assert.equal(sessions.length, 251, 'persistent session history must not be capped by the 200-row audit tail');
  assert.ok(sessions.some(session => session.id === 'task-000'), 'the oldest session must survive after more than 200 later tool calls');
  assert.ok(sessions.some(session => session.id === 'task-250'), 'the newest session must be present');
  assert.equal(sessions[0].id, 'task-250', 'persistent sessions must be returned newest first');
  assert.equal(sessions.at(-1).id, 'task-000', 'the oldest retained session must be last');

  recordTaskHistoryEvent(config, {
    taskId: 'validation-fragment',
    ts: new Date(base + 300000).toISOString(),
    tool: 'relai_run_checks',
    operation: 'Running validation',
    workspace: 'repo',
    ok: true,
    validationStatus: 'passed'
  });
  recordTaskHistoryEvent(config, {
    taskId: 'completion-fragment',
    validationTaskId: 'validation-fragment',
    relatedTaskIds: ['validation-fragment', 'completion-fragment'],
    ts: new Date(base + 301000).toISOString(),
    tool: 'relai_complete_task',
    operation: 'Reporting completion',
    workspace: 'repo',
    ok: true,
    completionKnown: true,
    taskSummary: 'Completed after reconnect.'
  });

  const merged = readTaskHistory(config, { state: 'idle' }, { limit: 500 })
    .find(session => session.id === 'validation-fragment');
  assert.ok(merged, 'completion must merge into the validation session');
  assert.equal(merged.calls, 2);
  assert.equal(merged.status, 'completed');
  assert.equal(merged.summary, 'Completed after reconnect.');

  assert.equal(fs.existsSync(getTaskHistoryDir(config)), true);
  clearTaskHistory(config);
  assert.equal(fs.existsSync(getTaskHistoryDir(config)), false, 'history reset must clear persistent sessions');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('Persistent task history store tests passed.');
