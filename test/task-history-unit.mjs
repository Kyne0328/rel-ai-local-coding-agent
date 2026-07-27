import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildTaskHistory } = require('../src/taskHistory.js');

function event(taskId, values = {}) {
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

const entries = [
  event('task-1', { ts: '2026-07-11T06:00:00.000Z', tool: 'relai_edit', operation: 'Editing src/a.js', ms: 1000, changedFiles: ['src/a.js'] }),
  event('task-1', { ts: '2026-07-11T06:00:02.000Z', tool: 'relai_run_checks', operation: 'Running validation', ms: 2000, validationStatus: 'passed' }),
  event('task-1', { ts: '2026-07-11T06:00:05.000Z', tool: 'relai_git_commit', operation: 'Creating a Git commit', ms: 500, changedFiles: ['src/a.js', 'test/a.test.js'] }),
  event('task-2', { ts: '2026-07-11T05:00:00.000Z', tool: 'relai_run_checks', ok: false, validationStatus: 'failed' }),
  event('task-3', { ts: '2026-07-11T08:00:00.000Z', tool: 'relai_run_checks', validationStatus: 'passed' }),
  event('task-3', { ts: '2026-07-11T08:00:03.000Z', tool: 'relai_complete_task', completionKnown: true, taskSummary: 'Implemented and validated.' })
];

const sessions = buildTaskHistory(entries, { state: 'idle' });
assert.equal(sessions.length, 3);
const inactive = sessions.find(session => session.id === 'task-1');
assert.equal(inactive.status, 'inactive');
assert.equal(inactive.calls, 3);
assert.deepEqual(inactive.changedFiles, ['src/a.js', 'test/a.test.js']);
assert.equal(inactive.validation, 'passed');
assert.equal(inactive.committed, true);
const failed = sessions.find(session => session.id === 'task-2');
assert.equal(failed.status, 'attention');
assert.equal(failed.validation, 'failed');
const completed = sessions.find(session => session.id === 'task-3');
assert.equal(completed.status, 'completed');
assert.equal(completed.completionKnown, true);
assert.equal(completed.summary, 'Implemented and validated.');

const strictIdentity = buildTaskHistory([
  event('validation-task', { ts: '2026-07-11T09:00:00.000Z', tool: 'relai_run_checks', validationStatus: 'passed', scopeId: 'old-transport-a' }),
  event('completion-task', { ts: '2026-07-11T09:00:03.000Z', tool: 'relai_complete_task', completionKnown: true, relatedTaskIds: ['validation-task'], scopeId: 'old-transport-b' })
], { state: 'idle' });
assert.equal(strictIdentity.length, 2, 'different explicit task IDs must never be reconciled');
assert.equal(strictIdentity.find(item => item.id === 'validation-task').status, 'inactive');
assert.equal(strictIdentity.find(item => item.id === 'completion-task').status, 'completed');

const ignoredLegacy = buildTaskHistory([
  { taskId: 'old-task', ts: '2026-07-11T07:00:00.000Z', tool: 'relai_read', workspace: 'repo', ok: true },
  { ts: '2026-07-11T07:01:00.000Z', pid: 42, tool: 'relai_edit', workspace: 'repo', ok: true },
  event('implicit-task', { taskIdExplicit: false, tool: 'relai_status' }),
  event('rejected-task', { taskIdExplicit: false, taskHistoryEligible: false, eventType: 'task.start.rejected', tool: 'relai_start_task' })
], { state: 'idle' });
assert.equal(ignoredLegacy.length, 0, 'legacy, implicit, and rejected rows must be discarded');

const drafted = buildTaskHistory([
  event('draft-task', { ts: '2026-07-11T09:30:00.000Z', tool: 'relai_git_draft_pr' })
], { state: 'idle' });
assert.equal(drafted[0].prDrafted, true);

const recoveredValidation = buildTaskHistory([
  event('retry-task', { ts: '2026-07-11T10:00:00.000Z', tool: 'relai_run_checks', ok: false, validationStatus: 'failed' }),
  event('retry-task', { ts: '2026-07-11T10:02:00.000Z', tool: 'relai_run_checks', validationStatus: 'passed' })
], { state: 'idle' });
assert.equal(recoveredValidation[0].validation, 'passed');

const active = buildTaskHistory([], {
  state: 'working',
  tasks: [
    { id: 'task-active-a', state: 'working', workspace: 'repo', tool: 'relai_read', operation: 'Reading src/app.js', startedAt: Date.now() - 1000, activeCalls: 2, calls: 3 },
    { id: 'task-active-b', state: 'waiting', workspace: 'other', tool: 'relai_diff', operation: 'Reviewing changes', startedAt: Date.now() - 2000, activeCalls: 0, calls: 2 }
  ]
});
assert.equal(active.length, 2);
assert.equal(active.find(session => session.id === 'task-active-a').status, 'working');
assert.equal(active.find(session => session.id === 'task-active-b').status, 'waiting');

console.log('Current task history uses exact explicit task IDs and ignores legacy data.');
