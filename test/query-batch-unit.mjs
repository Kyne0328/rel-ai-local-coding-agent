import assert from 'node:assert/strict';

import { runQueryBatch } from '../src/bridge/queryBatch.js';

const alreadyCancelled = new AbortController();
alreadyCancelled.abort(new Error('cancel before batch'));
await assert.rejects(
  () => runQueryBatch(['a', 'b', 'c'], async term => ({ term }), { signal: alreadyCancelled.signal }),
  /cancel before batch/,
  'an already-cancelled query batch must reject instead of returning an empty successful result'
);

const cancelledDuringBatch = new AbortController();
let calls = 0;
await assert.rejects(
  () => runQueryBatch(['first', 'second', 'third'], async term => {
    calls += 1;
    if (term === 'first') cancelledDuringBatch.abort(new Error('cancel during batch'));
    return { term };
  }, { signal: cancelledDuringBatch.signal, maxConcurrency: 1 }),
  /cancel during batch/
);
assert.equal(calls, 1, 'cancellation must stop scheduling unsatisfied queries');

console.log('Query batches reject cancellation instead of reporting partial work as success.');
