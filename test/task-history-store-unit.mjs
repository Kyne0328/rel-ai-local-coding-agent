import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { clearTaskHistory, getTaskHistoryDir, readTaskHistory, recordTaskHistoryEvent } from "../src/taskHistoryStore.js";
import { writeSession } from '../src/taskHistoryStorage.js';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-history-store-'));
const config = { stateDir: sandbox, auditLogPath: path.join(sandbox, 'audit.jsonl') };
fs.writeFileSync(config.auditLogPath, '', 'utf8');

function currentEvent(taskId, values = {}) {
  return {
    taskId,
    taskIdentityVersion: 2,
    taskIdExplicit: true,
    taskHistoryEligible: true,
    workspace: 'repo',
    ok: true,
    ...values
  };
}

try {
  const historyDir = getTaskHistoryDir(config);
  fs.mkdirSync(historyDir, { recursive: true });
  fs.writeFileSync(path.join(historyDir, 'legacy.json'), JSON.stringify({ id: 'legacy-task' }));

  const base = Date.parse('2026-07-25T00:00:00.000Z');
  for (let index = 0; index < 251; index += 1) {
    recordTaskHistoryEvent(config, currentEvent(`task-${String(index).padStart(3, '0')}`, {
      ts: new Date(base + index * 1000).toISOString(),
      tool: 'relai_read',
      operation: `Reading task ${index}`,
      ms: 5
    }));
  }
  assert.equal(fs.existsSync(path.join(historyDir, 'legacy.json')), true, 'schema upgrades must preserve prior session data');
  assert.equal(fs.existsSync(path.join(sandbox, '.task-history-v3')), true, 'current history format marker must be created');

  let sessions = readTaskHistory(config, { state: 'idle' }, { limit: 500 });
  assert.equal(sessions.length, 252);
  assert.equal(sessions[0].id, 'task-250');
  assert.equal(sessions.some(session => session.id === 'legacy-task'), true, 'legacy records must remain readable with fallbacks');
  assert.equal(sessions.find(session => session.id === 'legacy-task').title, 'Historical Rel.AI task');

  recordTaskHistoryEvent(config, currentEvent('exact-task', {
    ts: new Date(base + 300000).toISOString(), tool: 'relai_run_checks', validationStatus: 'passed'
  }));
  recordTaskHistoryEvent(config, currentEvent('exact-task', {
    ts: new Date(base + 301000).toISOString(), tool: 'relai_complete_task', completionKnown: true, taskSummary: 'Completed exactly.'
  }));
  recordTaskHistoryEvent(config, currentEvent('separate-task', {
    ts: new Date(base + 302000).toISOString(), tool: 'relai_complete_task', completionKnown: true,
    relatedTaskIds: ['exact-task'], taskSummary: 'Must remain separate.'
  }));
  recordTaskHistoryEvent(config, currentEvent('atomic-completion', {
    ts: new Date(base + 303000).toISOString(), tool: 'relai_run_checks', validationStatus: 'passed',
    completionKnown: true, completionSource: 'relai_run_checks', taskSummary: 'Validated atomically.', changedFiles: ['src/atomic.js']
  }));
  recordTaskHistoryEvent(config, currentEvent('draft-task', {
    ts: new Date(base + 304000).toISOString(), tool: 'relai_git_draft_pr'
  }));
  recordTaskHistoryEvent(config, currentEvent('abandoned-start', {
    ts: '2020-01-01T00:00:00.000Z', eventType: 'task.started', tool: 'relai_start_task'
  }));
  recordTaskHistoryEvent(config, { taskId: 'legacy-event', tool: 'relai_read', ok: true });
  writeSession(historyDir, {
    id: 'terminal-with-stale-operation',
    taskId: 'terminal-with-stale-operation',
    sessionId: 'terminal-with-stale-operation',
    version: 3,
    title: 'Failed task with stale operation',
    status: 'failed',
    state: 'ended',
    completionKnown: false,
    progress: { mode: 'indeterminate', label: 'Running command' },
    activeCalls: 1,
    currentOperations: [{ operationId: 'stale-op', tool: 'relai_exec', label: 'Running command', startedAt: Date.now() - 1000 }],
    startedAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:01:00.000Z',
    endedAt: '2026-07-25T00:01:00.000Z',
    completedAt: '2026-07-25T00:01:00.000Z'
  });

  sessions = readTaskHistory(config, { state: 'idle' }, { limit: 500 });
  assert.equal(sessions.some(session => session.id === 'legacy-event'), false);
  assert.equal(sessions.some(session => session.id === 'abandoned-start'), false);
  const exact = sessions.find(session => session.id === 'exact-task');
  assert.equal(exact.calls, 2);
  assert.equal(exact.status, 'completed');
  assert.equal(exact.summary, 'Completed exactly.');
  assert.equal(sessions.some(session => session.id === 'separate-task'), true, 'relatedTaskIds must not merge distinct task IDs');
  const atomic = sessions.find(session => session.id === 'atomic-completion');
  assert.equal(atomic.validation, 'passed');
  assert.deepEqual(atomic.changedFiles, ['src/atomic.js']);
  assert.equal(sessions.find(session => session.id === 'draft-task').prDrafted, true);
  const staleTerminal = sessions.find(session => session.id === 'terminal-with-stale-operation');
  assert.equal(staleTerminal.activeCalls, 0, 'terminal history must not expose stale active calls');
  assert.deepEqual(staleTerminal.currentOperations, [], 'terminal history must not expose stale running operations');
  assert.equal(staleTerminal.progress.mode, 'indeterminate', 'historical progress may remain indeterminate because rendering is status-aware');

  clearTaskHistory(config);
  assert.equal(fs.existsSync(historyDir), false);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('Persistent task history preserves legacy data and stores exact current task IDs.');
