import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildToolActivityDetails,
  createActivityEvent,
  deriveTaskTitle,
  determinateProgress,
  normalizeTaskProgress,
  sanitizeActivityMetadata
} = require('../src/taskObservability.js');

assert.equal(deriveTaskTitle({ title: 'Audit dashboard activity model' }), 'Audit dashboard activity model');
assert.equal(deriveTaskTitle({ title: 'Inspect token=super-secret dashboard' }), 'Inspect token=[redacted] dashboard');
assert.equal(deriveTaskTitle({ title: 'Task', tool: 'relai_read', paths: ['src/taskHistory.js'] }), 'Read src/taskHistory.js');
assert.equal(deriveTaskTitle({ objective: 'inspect session persistence. Then report findings.' }), 'Inspect session persistence');
assert.equal(deriveTaskTitle({ tool: 'relai_run_checks' }), 'Run repository validation');

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

const readRunning = buildToolActivityDetails('relai_read', { paths: ['src/a.js', 'src/b.js', 'src/c.js'] }, null, null, { phase: 'running' });
assert.equal(readRunning.progress.mode, 'determinate');
assert.equal(readRunning.progress.completedUnits, 0);
assert.equal(readRunning.progress.totalUnits, 3);
assert.equal(readRunning.category, 'tool');

const readCompleted = buildToolActivityDetails('relai_read', { paths: ['src/a.js', 'src/b.js', 'src/c.js'] }, { items: [{}, {}, {}] }, null, { phase: 'complete' });
assert.equal(readCompleted.progress.percentage, 100);
assert.equal(readCompleted.result.affectedItemCount, 3);
assert.match(readCompleted.summary, /Read 3 repository items/);

const failed = buildToolActivityDetails('relai_exec', { command: 'npm test' }, null, { code: 'WORKSPACE_UNAVAILABLE', message: 'Workspace path was unavailable.', retryable: true }, { phase: 'complete' });
assert.equal(failed.status, 'failed');
assert.equal(failed.error.retryable, true);
assert.match(failed.summary, /Workspace path was unavailable/);
const blocked = buildToolActivityDetails('relai_edit', {}, null, { code: 'APPROVAL_REQUIRED', message: 'Authorization: Bearer abc.def is required.' }, { phase: 'complete' });
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

const event = createActivityEvent({
  eventId: 'operation-1',
  taskId: 'task-1',
  sequence: 2,
  category: 'validation',
  action: 'run.checks',
  status: 'succeeded',
  title: 'Run repository validation',
  summary: 'Ran 42 unit tests; 42 passed.',
  tool: { name: 'relai_run_checks', operation: 'Workspace checks' },
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
