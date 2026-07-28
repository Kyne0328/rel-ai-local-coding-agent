import assert from 'node:assert/strict';
import { createSnapshotGate } from '../src/ui/snapshot-order.js';

const gate = createSnapshotGate();
assert.equal(gate.accept({}), true, 'legacy snapshots without ordering metadata remain compatible');
assert.equal(gate.accept({ snapshot: { streamId: 'stream-a', sequence: 1 } }), true);
assert.deepEqual(gate.state(), { streamId: 'stream-a', sequence: 1 });
assert.equal(gate.accept({ snapshot: { streamId: 'stream-a', sequence: 1 } }), false, 'duplicate delivery must be idempotent');
assert.equal(gate.accept({ snapshot: { streamId: 'stream-a', sequence: 0 } }), false, 'stale delivery must not regress state');
assert.equal(gate.accept({ snapshot: { streamId: 'stream-a', sequence: 2 } }), true);
assert.equal(gate.accept({ snapshot: { streamId: 'stream-b', sequence: 1 } }), true, 'a restarted server stream establishes a new ordering domain');
assert.deepEqual(gate.state(), { streamId: 'stream-b', sequence: 1 });
gate.reset();
assert.deepEqual(gate.state(), { streamId: '', sequence: 0 });

console.log('Dashboard snapshot ordering rejects duplicate and stale deliveries.');
