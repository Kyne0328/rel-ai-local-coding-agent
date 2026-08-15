import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parallel, runPlan, sequence, step } from '../src/executionPlan.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let active = 0;
let observedMax = 0;
const started = performance.now();
const parallelResult = await runPlan(parallel(
  [0, 1, 2, 3].map(index => step(`parallel-${index}`, async () => {
    active += 1;
    observedMax = Math.max(observedMax, active);
    await sleep(70);
    active -= 1;
    return index;
  })),
  { maxConcurrency: 2 }
));
const parallelWallMs = performance.now() - started;
assert.equal(parallelResult.ok, true);
assert.deepEqual(parallelResult.results.map(item => item.value), [0, 1, 2, 3]);
assert.equal(observedMax, 2, 'bounded execution should never exceed configured concurrency');
assert.equal(parallelResult.metrics.maxParallelism, 2);
assert.equal(parallelResult.metrics.parallelGroupCount, 1);
assert.ok(parallelResult.metrics.parallelTimeSavedMs > 50, `expected useful overlap, got ${parallelResult.metrics.parallelTimeSavedMs}ms saved`);
assert.ok(parallelWallMs < 260, `four 70ms steps at concurrency 2 should overlap, got ${parallelWallMs}ms`);

const sequenceStarted = performance.now();
const sequenceResult = await runPlan(sequence([
  step('a', () => sleep(55).then(() => 'a')),
  step('b', () => sleep(55).then(() => 'b')),
  step('c', () => sleep(55).then(() => 'c'))
]));
const sequenceWallMs = performance.now() - sequenceStarted;
assert.equal(sequenceResult.ok, true);
assert.deepEqual(sequenceResult.results.map(item => item.value), ['a', 'b', 'c']);
assert.ok(sequenceWallMs >= 140, `sequence should preserve ordering, got ${sequenceWallMs}ms`);

let shouldNotRun = false;
const failed = await runPlan(sequence([
  step('fails-by-value', async () => ({ ok: false }), { isSuccess: value => value.ok }),
  step('blocked', async () => { shouldNotRun = true; })
]));
assert.equal(failed.ok, false);
assert.equal(failed.results.length, 1);
assert.equal(shouldNotRun, false, 'sequence should stop scheduling after a failed step by default');

const controller = new AbortController();
controller.abort(new Error('cancelled for test'));
const cancelled = await runPlan(parallel([
  step('cancelled-a', async () => 'a'),
  step('cancelled-b', async () => 'b')
]), { signal: controller.signal });
assert.equal(cancelled.ok, false);
assert.equal(cancelled.results.length, 0, 'already-aborted parallel groups should not start work');

console.log('Execution plan unit tests passed.');
