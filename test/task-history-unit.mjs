import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildTaskHistory } = require('../src/taskHistory.js');

const entries = [
  { taskId: 'task-1', ts: '2026-07-11T06:00:00.000Z', tool: 'relai_edit', workspace: 'repo', ok: true, ms: 1000, changedFiles: ['src/a.js'] },
  { taskId: 'task-1', ts: '2026-07-11T06:00:02.000Z', tool: 'relai_run_checks', workspace: 'repo', ok: true, ms: 2000, validationStatus: 'passed' },
  { taskId: 'task-1', ts: '2026-07-11T06:00:05.000Z', tool: 'relai_git_commit', workspace: 'repo', ok: true, ms: 500, changedFiles: ['src/a.js', 'test/a.test.js'] },
  { taskId: 'task-2', ts: '2026-07-11T05:00:00.000Z', tool: 'relai_run_checks', workspace: 'other', ok: false, ms: 500, validationStatus: 'failed' }
];

const tasks = buildTaskHistory(entries, { state: 'idle' });
assert.equal(tasks.length, 2);
const completed = tasks.find(task => task.id === 'task-1');
assert.equal(completed.status, 'completed');
assert.equal(completed.calls, 3);
assert.equal(completed.changedFileCount, 2);
assert.deepEqual(completed.changedFiles, ['src/a.js', 'test/a.test.js']);
assert.equal(completed.validation, 'passed');
assert.equal(completed.committed, true);
assert.equal(completed.pushed, false);
const failed = tasks.find(task => task.id === 'task-2');
assert.equal(failed.status, 'attention');
assert.equal(failed.failures, 1);
assert.equal(failed.validation, 'failed');

const active = buildTaskHistory([], {
  state: 'working',
  activeTaskCount: 2,
  activeCalls: 3,
  tasks: [
    { id: 'task-active-a', state: 'working', workspace: 'repo', tool: 'relai_read', startedAt: Date.now() - 1000, activeCalls: 2, calls: 3 },
    { id: 'task-active-b', state: 'settling', workspace: 'other', tool: 'relai_diff', startedAt: Date.now() - 2000, activeCalls: 0, calls: 2 }
  ]
});
assert.equal(active.length, 2);
assert.equal(active.find(task => task.id === 'task-active-a').status, 'working');
assert.equal(active.find(task => task.id === 'task-active-a').calls, 3);
assert.equal(active.find(task => task.id === 'task-active-b').status, 'settling');

const legacy = buildTaskHistory([
  { ts: '2026-07-11T07:00:00.000Z', pid: 42, tool: 'relai_read', workspace: 'repo', ok: true },
  { ts: '2026-07-11T07:00:20.000Z', pid: 42, tool: 'relai_edit', workspace: 'repo', ok: true, changedFiles: ['src/b.js'] },
  { ts: '2026-07-11T07:02:00.000Z', pid: 42, tool: 'relai_run_checks', workspace: 'repo', ok: true, validationStatus: 'passed' }
], { state: 'idle' });
assert.equal(legacy.length, 2, 'legacy audit rows should be inferred into time-bounded tasks');
assert.equal(legacy.find(task => task.calls === 2)?.changedFileCount, 1);
assert.equal(legacy.find(task => task.calls === 1)?.validation, 'passed');

console.log('Persistent and concurrent task history tests passed.');
