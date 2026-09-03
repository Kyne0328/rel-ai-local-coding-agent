import assert from 'node:assert/strict';

import { buildToolActivityDetails, createActivityEvent, deriveTaskTitle, determinateProgress, incompleteProgress, normalizeTaskProgress, sanitizeActivityMetadata } from '../src/taskObservability.js';

assert.equal(deriveTaskTitle({ title: 'Audit dashboard activity model' }), 'Audit dashboard activity model');
assert.equal(deriveTaskTitle({ title: 'Inspect token=super-secret dashboard' }), 'Inspect token=[redacted] dashboard');
assert.equal(deriveTaskTitle({ title: 'Task', tool: 'read', paths: ['src/taskHistory.js'] }), 'Read src/taskHistory.js');
assert.equal(deriveTaskTitle({ objective: 'inspect session persistence. Then report findings.' }), 'Inspect session persistence');
assert.equal(deriveTaskTitle({ tool: 'validate.checks' }), 'Run repository validation');

const metadata = sanitizeActivityMetadata({
  waitMs: 1800,
  changedFiles: ['src/app.js'],
  token: 'secret',
  approvalSecret: 'secret',
  environment: { API_KEY: 'secret' },
  stdout: 'private output',
  resourceUri: 'https://user:pass@example.com/private?token=secret',
  retryable: true
});
assert.deepEqual(metadata, {
  waitMs: 1800,
  changedFiles: ['src/app.js'],
  retryable: true
});

const readRunning = buildToolActivityDetails('read', { paths: ['src/a.js', 'src/b.js', 'src/c.js'] }, null, null, { phase: 'running' });
assert.equal(readRunning.progress.mode, 'determinate');
assert.equal(readRunning.progress.completedUnits, 0);
assert.equal(readRunning.progress.totalUnits, 3);
assert.equal(readRunning.category, 'tool');

const readCompleted = buildToolActivityDetails('read', { paths: ['src/a.js', 'src/b.js', 'src/c.js'] }, { items: [{}, {}, {}] }, null, { phase: 'complete' });
assert.equal(readCompleted.progress.percentage, 100);
assert.equal(readCompleted.result.affectedItemCount, 3);
assert.match(readCompleted.summary, /Read 3 repository items/);

const exactCommand = 'Write-Host "one  two"\nGet-ChildItem';
const execCompleted = buildToolActivityDetails('exec', { command: exactCommand }, { exitCode: 0 }, null, { phase: 'complete' });
assert.equal(execCompleted.command, exactCommand, 'exec activity must retain the command text shown to the user');
const execEvent = createActivityEvent({
  eventId: 'exec-command-1',
  taskId: 'task-command-1',
  status: 'succeeded',
  ...execCompleted
});
assert.equal(execEvent.command, exactCommand, 'activity events must retain the visible exec command');

const secretCommand = buildToolActivityDetails('exec', { command: 'npm test --token super-secret OPENAI_API_KEY=also-secret' }, { exitCode: 0 }, null, { phase: 'complete' });
assert.doesNotMatch(secretCommand.command, /super-secret|also-secret/);
assert.match(secretCommand.command, /\[REDACTED\]/);

const directCommand = buildToolActivityDetails('exec', { executable: 'pwsh', argv: ['-Command', 'Write-Host "a b"'] }, { exitCode: 0 }, null, { phase: 'complete' });
assert.equal(directCommand.command, '"pwsh" "-Command" "Write-Host \\"a b\\""');

const failed = buildToolActivityDetails('exec', { command: 'npm test' }, null, { code: 'WORKSPACE_UNAVAILABLE', message: 'Workspace path was unavailable.', retryable: true }, { phase: 'complete' });
assert.equal(failed.status, 'failed');
assert.equal(failed.error.retryable, true);
assert.match(failed.summary, /Workspace path was unavailable/);
const blocked = buildToolActivityDetails('edit', {}, null, { code: 'APPROVAL_REQUIRED', message: 'Authorization: Bearer abc.def is required.' }, { phase: 'complete' });
assert.equal(blocked.status, 'blocked');
assert.equal(blocked.currentStage, 'Waiting for approval');
assert.doesNotMatch(blocked.error.message, /abc\.def/);

assert.deepEqual(determinateProgress(4, 7, 'plan', '4 of 7 planned steps'), {
  mode: 'determinate',
  completedUnits: 4,
  totalUnits: 7,
  percentage: 57,
  source: 'plan',
  label: '4 of 7 planned steps'
});
assert.equal(normalizeTaskProgress({ mode: 'determinate', completedUnits: 2, totalUnits: 5 }, 'failed').percentage, 40);
assert.deepEqual(normalizeTaskProgress({ mode: 'determinate', completedUnits: 2, totalUnits: 5 }, 'completed'), {
  mode: 'complete', percentage: 100, label: 'Complete'
});
assert.deepEqual(incompleteProgress({
  mode: 'determinate',
  completedUnits: 5,
  totalUnits: 5,
  percentage: 100
}, 'validation_failed', 'Fix issues and revalidate'), {
  mode: 'determinate',
  completedUnits: 5,
  totalUnits: 5,
  percentage: 99,
  source: 'tool',
  label: 'Fix issues and revalidate'
});
assert.deepEqual(incompleteProgress({ mode: 'indeterminate', label: 'Checking' }, 'blocked', 'Action required'), {
  mode: 'indeterminate',
  label: 'Action required'
});

const event = createActivityEvent({
  eventId: 'operation-1',
  taskId: 'task-1',
  sequence: 2,
  category: 'validation',
  action: 'run.checks',
  status: 'succeeded',
  title: 'Run repository validation',
  summary: 'Ran 42 unit tests; 42 passed.',
  tool: { name: 'validate.checks', operation: 'Workspace checks' },
  target: { workspaceRelativePath: 'test' },
  result: { affectedItemCount: 42 },
  metadata: { passedCount: 42, token: 'secret' }
});
assert.equal(event.eventId, 'operation-1');
assert.equal(event.sessionId, 'task-1');
assert.equal(event.sequence, 2);
assert.deepEqual(event.metadata, { passedCount: 42 });
assert.equal(event.tool.invocationId, 'operation-1');

console.log('Task observability title, progress, summary, and redaction tests passed.');
