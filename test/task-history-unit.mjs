import assert from 'node:assert/strict';

import {
  canonicalTaskSnapshot,
  lifecycleChangedFields,
  mergeTaskLifecycleSnapshots,
  reduceTaskLifecycleAuditEvent
} from '../src/taskLifecycle.js';

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

let task = canonicalTaskSnapshot({ id: 'task-1', taskId: 'task-1', status: 'planning', workspace: 'repo' });
task = reduceTaskLifecycleAuditEvent(task, event('task-1', {
  operationId: 'edit-1', ts: '2026-07-11T06:00:00.000Z', tool: 'edit', operation: 'Editing src/a.js', ms: 1000, changedFiles: ['src/a.js']
}));
assert.equal(task.calls, 1);
assert.deepEqual(task.changedFiles, ['src/a.js']);

task = reduceTaskLifecycleAuditEvent(task, event('task-1', {
  operationId: 'check-1', ts: '2026-07-11T06:00:02.000Z', tool: 'validate.checks', ok: false, validationStatus: 'failed'
}));
assert.equal(task.status, 'validation_failed', 'failed validation remains recoverable and nonterminal');
assert.equal(task.validation, 'failed');

task = reduceTaskLifecycleAuditEvent(task, event('task-1', {
  operationId: 'check-2', ts: '2026-07-11T06:00:04.000Z', tool: 'validate.checks', validationStatus: 'passed'
}));
assert.equal(task.validation, 'passed', 'later validation replaces the recoverable failed state');
assert.equal(task.status, 'planning');

task = reduceTaskLifecycleAuditEvent(task, event('task-1', {
  operationId: 'commit-1', ts: '2026-07-11T06:00:05.000Z', tool: 'publish.commit', changedFiles: ['src/a.js', 'test/a.test.js'], commitHead: '0123456789abcdef0123456789abcdef01234567'
}));
assert.equal(task.committed, true);
assert.equal(task.commitHead, '0123456789abcdef0123456789abcdef01234567');
assert.deepEqual(task.commitHeads, ['0123456789abcdef0123456789abcdef01234567']);
assert.deepEqual(task.changedFiles, ['src/a.js', 'test/a.test.js']);

task = reduceTaskLifecycleAuditEvent(task, event('task-1', {
  operationId: 'finish-1', ts: '2026-07-11T06:00:06.000Z', tool: 'work.finish', completionKnown: true, taskSummary: 'Implemented and validated.'
}));
assert.equal(task.status, 'completed');
assert.equal(task.completionKnown, true);
assert.equal(task.summary, 'Implemented and validated.');
assert.ok(task.completedAt);
assert.equal(task.cancelledAt, null);

let cancelled = canonicalTaskSnapshot({ id: 'task-2', taskId: 'task-2', status: 'planning', workspace: 'repo' });
cancelled = reduceTaskLifecycleAuditEvent(cancelled, event('task-2', {
  operationId: 'cancel-1', ts: '2026-07-11T07:00:00.000Z', tool: 'work.cancel'
}));
assert.equal(cancelled.status, 'cancelled');
assert.ok(cancelled.cancelledAt);
assert.equal(cancelled.completedAt, null);

const persisted = canonicalTaskSnapshot({
  id: 'merge-task', taskId: 'merge-task', status: 'planning', workspace: 'repo',
  calls: 3, changedFiles: ['src/a.js'], changedFileCount: 1, validation: 'passed', committed: true,
  commitHead: 'fedcba9876543210fedcba9876543210fedcba98', commitHeads: ['fedcba9876543210fedcba9876543210fedcba98'], updatedAt: '2026-07-11T08:00:00.000Z'
});
const live = canonicalTaskSnapshot({
  id: 'merge-task', taskId: 'merge-task', status: 'running', workspace: 'repo', activeCalls: 1,
  calls: 4, operation: 'Reading src/b.js', updatedAt: '2026-07-11T08:01:00.000Z'
});
const merged = mergeTaskLifecycleSnapshots(persisted, live);
assert.equal(merged.calls, 4);
assert.equal(merged.operation, 'Reading src/b.js');
assert.deepEqual(merged.changedFiles, ['src/a.js']);
assert.equal(merged.validation, 'passed');
assert.equal(merged.committed, true);
assert.equal(merged.commitHead, 'fedcba9876543210fedcba9876543210fedcba98');
assert.deepEqual(merged.commitHeads, ['fedcba9876543210fedcba9876543210fedcba98']);

const changed = lifecycleChangedFields(persisted, merged);
assert.ok(changed.includes('calls'));
assert.ok(changed.includes('operation'));
assert.equal(changed.includes('validation'), false);

console.log('Canonical task lifecycle reducer and projection tests passed.');
