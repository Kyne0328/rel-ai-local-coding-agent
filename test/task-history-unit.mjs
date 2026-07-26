import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildTaskHistory } = require('../src/taskHistory.js');

const entries = [
  { taskId: 'task-1', ts: '2026-07-11T06:00:00.000Z', tool: 'relai_edit', operation: 'Editing src/a.js', workspace: 'repo', ok: true, ms: 1000, changedFiles: ['src/a.js'] },
  { taskId: 'task-1', ts: '2026-07-11T06:00:02.000Z', tool: 'relai_run_checks', operation: 'Running validation 1/1: npm test', workspace: 'repo', ok: true, ms: 2000, validationStatus: 'passed' },
  { taskId: 'task-1', ts: '2026-07-11T06:00:05.000Z', tool: 'relai_git_commit', operation: 'Creating a Git commit', workspace: 'repo', ok: true, ms: 500, changedFiles: ['src/a.js', 'test/a.test.js'] },
  { taskId: 'task-2', ts: '2026-07-11T05:00:00.000Z', tool: 'relai_run_checks', operation: 'Running validation 1/1: npm test', workspace: 'other', ok: false, ms: 500, validationStatus: 'failed' },
  { taskId: 'task-3', ts: '2026-07-11T08:00:00.000Z', tool: 'relai_run_checks', operation: 'Running validation 1/1: npm test', workspace: 'completed-repo', ok: true, ms: 2000, validationStatus: 'passed' },
  { taskId: 'task-3', ts: '2026-07-11T08:00:03.000Z', tool: 'relai_complete_task', operation: 'Reporting task completion', workspace: 'completed-repo', ok: true, ms: 20, completionKnown: true, endReason: 'explicit_completion', taskSummary: 'Implemented and validated the requested change.' }
];

const sessions = buildTaskHistory(entries, { state: 'idle' });
assert.equal(sessions.length, 3);
const inactive = sessions.find(session => session.id === 'task-1');
assert.equal(inactive.status, 'inactive');
assert.equal(inactive.completionKnown, false);
assert.equal(inactive.endReason, 'inactivity_window');
assert.equal(inactive.calls, 3);
assert.equal(inactive.changedFileCount, 2);
assert.deepEqual(inactive.changedFiles, ['src/a.js', 'test/a.test.js']);
assert.equal(inactive.validation, 'passed');
assert.equal(inactive.committed, true);
assert.equal(inactive.pushed, false);
assert.equal(inactive.operation, 'Creating a Git commit');
const failed = sessions.find(session => session.id === 'task-2');
assert.equal(failed.status, 'attention');
assert.equal(failed.failures, 1);
assert.equal(failed.validation, 'failed');
const completed = sessions.find(session => session.id === 'task-3');
assert.equal(completed.status, 'completed');
assert.equal(completed.completionKnown, true);
assert.equal(completed.endReason, 'explicit_completion');
assert.equal(completed.summary, 'Implemented and validated the requested change.');

const modernNoise = buildTaskHistory([
  { taskId: 'implicit-status', taskIdentityVersion: 2, taskIdExplicit: false, taskHistoryEligible: false, ts: '2026-07-11T08:10:00.000Z', tool: 'relai_status', ok: true },
  { taskId: 'rejected-start', taskIdentityVersion: 2, taskIdExplicit: false, taskHistoryEligible: false, eventType: 'task.start.rejected', ts: '2026-07-11T08:11:00.000Z', tool: 'relai_start_task', workspace: '.', ok: false }
], { state: 'idle' });
assert.equal(modernNoise.length, 0, 'modern taskless and rejected events must remain activity-only');

const readOnlyCompleted = buildTaskHistory([
  { taskId: 'read-only-task', taskIdentityVersion: 2, taskIdExplicit: true, taskHistoryEligible: true, ts: '2026-07-11T08:20:00.000Z', tool: 'relai_start_task', workspace: 'repo', ok: true },
  { taskId: 'read-only-task', taskIdentityVersion: 2, taskIdExplicit: true, taskHistoryEligible: true, ts: '2026-07-11T08:20:01.000Z', tool: 'relai_read', workspace: 'repo', ok: true },
  { taskId: 'read-only-task', taskIdentityVersion: 2, taskIdExplicit: true, taskHistoryEligible: true, ts: '2026-07-11T08:20:02.000Z', tool: 'relai_complete_task', workspace: 'repo', ok: true, completionKnown: true, validationStatus: 'not_required', taskSummary: 'Read-only review completed.' }
], { state: 'idle' });
assert.equal(readOnlyCompleted.length, 1);
assert.equal(readOnlyCompleted[0].status, 'completed');
assert.equal(readOnlyCompleted[0].validation, 'not_required');

const reconnected = buildTaskHistory([
  { taskId: 'validation-task', ts: '2026-07-11T09:00:00.000Z', tool: 'relai_run_checks', workspace: 'repo', ok: true, validationStatus: 'passed' },
  { taskId: 'completion-task', ts: '2026-07-11T09:00:03.000Z', tool: 'relai_complete_task', workspace: 'repo', ok: true, completionKnown: true, validationTaskId: 'validation-task', relatedTaskIds: ['validation-task', 'completion-task'], taskSummary: 'Completed after reconnect.' }
], { state: 'idle' });
assert.equal(reconnected.length, 1, 'completion metadata must merge a rotated completion task into its validation session');
assert.equal(reconnected[0].id, 'validation-task');
assert.equal(reconnected[0].status, 'completed');
assert.equal(reconnected[0].calls, 2);

const drafted = buildTaskHistory([
  { taskId: 'draft-task', ts: '2026-07-11T09:30:00.000Z', tool: 'relai_git_draft_pr', workspace: 'repo', ok: true },
  { taskId: 'legacy-draft-task', ts: '2026-07-11T09:31:00.000Z', tool: 'relai_git_create_pr', workspace: 'other', ok: true }
], { state: 'idle' });
assert.equal(drafted.find(session => session.id === 'draft-task').prDrafted, true, 'new PR draft tool must set task publication metadata');
assert.equal(drafted.find(session => session.id === 'legacy-draft-task').prDrafted, true, 'legacy PR draft tool must preserve task metadata');

const recoveredValidation = buildTaskHistory([
  { taskId: 'retry-task', ts: '2026-07-11T10:00:00.000Z', tool: 'relai_run_checks', workspace: 'repo', ok: false, validationStatus: 'failed' },
  { taskId: 'retry-task', ts: '2026-07-11T10:02:00.000Z', tool: 'relai_run_checks', workspace: 'repo', ok: true, validationStatus: 'passed' }
], { state: 'idle' });
assert.equal(recoveredValidation[0].validation, 'passed', 'the latest validation result must determine session validation state');

const active = buildTaskHistory([], {
  state: 'working',
  activeTaskCount: 2,
  activeCalls: 3,
  tasks: [
    { id: 'task-active-a', state: 'working', workspace: 'repo', tool: 'relai_read', operation: 'Reading src/app.js', startedAt: Date.now() - 1000, activeCalls: 2, calls: 3 },
    { id: 'task-active-b', state: 'waiting', workspace: 'other', tool: 'relai_diff', operation: 'Reviewing repository changes', startedAt: Date.now() - 2000, activeCalls: 0, calls: 2 }
  ]
});
assert.equal(active.length, 2);
assert.equal(active.find(session => session.id === 'task-active-a').status, 'working');
assert.equal(active.find(session => session.id === 'task-active-a').calls, 3);
assert.equal(active.find(session => session.id === 'task-active-a').operation, 'Reading src/app.js');
assert.equal(active.find(session => session.id === 'task-active-b').status, 'waiting');

const legacy = buildTaskHistory([
  { ts: '2026-07-11T07:00:00.000Z', pid: 42, tool: 'relai_read', workspace: 'repo', ok: true },
  { ts: '2026-07-11T07:00:20.000Z', pid: 42, tool: 'relai_edit', workspace: 'repo', ok: true, changedFiles: ['src/b.js'] },
  { ts: '2026-07-11T07:02:00.000Z', pid: 42, tool: 'relai_run_checks', workspace: 'repo', ok: true, validationStatus: 'passed' }
], { state: 'idle' });
assert.equal(legacy.length, 1, 'legacy audit rows within the five-minute grouping window should remain one session');
assert.equal(legacy[0].calls, 3);
assert.equal(legacy[0].changedFileCount, 1);
assert.equal(legacy[0].validation, 'passed');
assert.equal(legacy.every(session => session.status === 'inactive'), true);

const fragmented = buildTaskHistory([
  { taskId: 'fragment-a', scopeId: 'mcp:111111111111111111111111', pid: 77, ts: '2026-07-11T11:00:00.000Z', tool: 'relai_read', workspace: 'repo', ok: true },
  { taskId: 'fragment-b', scopeId: 'mcp:222222222222222222222222', pid: 77, ts: '2026-07-11T11:01:00.000Z', tool: 'relai_search', workspace: 'repo', ok: true },
  { taskId: 'fragment-c', scopeId: 'mcp:333333333333333333333333', pid: 77, ts: '2026-07-11T11:02:00.000Z', tool: 'relai_run_checks', workspace: 'repo', ok: true, validationStatus: 'passed' }
], {
  state: 'waiting',
  tasks: [{ id: 'fragment-c', state: 'waiting', workspace: 'repo', tool: 'relai_run_checks', startedAt: Date.parse('2026-07-11T11:02:00.000Z'), activeCalls: 0, calls: 1 }]
});
assert.equal(fragmented.length, 1, 'opaque transport fragments from the same process and workspace must be stitched within the grouping window');
assert.equal(fragmented[0].calls, 3);
assert.equal(fragmented[0].status, 'waiting', 'an active fragment must keep the stitched session live');
assert.equal(fragmented[0].validation, 'passed');

const separateConversations = buildTaskHistory([
  { taskId: 'conversation-a', scopeId: 'mcp:conversation:aaaaaaaaaaaaaaaaaaaaaaaa', pid: 77, ts: '2026-07-11T12:00:00.000Z', tool: 'relai_read', workspace: 'repo', ok: true },
  { taskId: 'conversation-b', scopeId: 'mcp:conversation:bbbbbbbbbbbbbbbbbbbbbbbb', pid: 77, ts: '2026-07-11T12:01:00.000Z', tool: 'relai_read', workspace: 'repo', ok: true }
], { state: 'idle' });
assert.equal(separateConversations.length, 2, 'different stable ChatGPT conversation identities must not be stitched');

console.log('Persistent and concurrent work-session history tests passed.');
