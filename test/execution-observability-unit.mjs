import assert from 'node:assert/strict';

import { createExecutionPlanObserver, executionMetricAttributes } from '../src/executionObservability.js';

const updates = [];
const observe = createExecutionPlanObserver({
  source: 'validation',
  title: 'Running validation',
  noun: 'checks',
  category: 'validation',
  update: patch => updates.push(patch)
});

observe({ type: 'step_started', name: 'a', metadata: { displayName: 'Lint' }, active: 1, completed: 0, total: 3 });
observe({ type: 'step_started', name: 'b', metadata: { displayName: 'Typecheck' }, active: 2, completed: 0, total: 3 });
let latest = updates.at(-1);
assert.equal(latest.currentStage, '2 checks running in parallel');
assert.equal(latest.activity.metadata.parallelActiveCount, 2);
assert.equal(latest.activity.metadata.pendingCount, 1);
assert.deepEqual(latest.activity.metadata.running, ['Lint', 'Typecheck']);
assert.equal(latest.progress.completedUnits, 0);
assert.equal(latest.progress.totalUnits, 3);

observe({ type: 'step_completed', name: 'a', metadata: { displayName: 'Lint' }, active: 1, completed: 1, total: 3 });
latest = updates.at(-1);
assert.equal(latest.activity.metadata.parallelActiveCount, 1);
assert.equal(latest.activity.metadata.completedCount, 1);
assert.equal(latest.activity.metadata.pendingCount, 1);
assert.deepEqual(latest.activity.metadata.running, ['Typecheck']);

const attributes = executionMetricAttributes('validation', {
  stepCount: 4,
  parallelGroupCount: 1,
  maxConcurrentSteps: 3,
  wallTimeMs: 120,
  accumulatedStepTimeMs: 290,
  overlapTimeMs: 170
});
assert.deepEqual(attributes, {
  'relai.plan.kind': 'validation',
  'relai.plan.total_steps': 4,
  'relai.plan.parallel_groups': 1,
  'relai.plan.max_concurrent_steps': 3,
  'relai.plan.wall_time_ms': 120,
  'relai.plan.accumulated_step_time_ms': 290,
  'relai.plan.overlap_time_ms': 170
});

console.log('Execution observability tests passed.');
