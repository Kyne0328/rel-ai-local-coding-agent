import assert from 'node:assert/strict';

import { runWorkspaceOperation, pendingWorkspaceOperations } from "../src/workspaceOperationQueue.js";

const order = [];
const first = runWorkspaceOperation('repo', async () => {
  order.push('first:start');
  await new Promise(resolve => setTimeout(resolve, 40));
  order.push('first:end');
});
const second = runWorkspaceOperation('repo', async () => {
  order.push('second:start');
  order.push('second:end');
});
const other = runWorkspaceOperation('other', async () => {
  order.push('other:start');
  order.push('other:end');
});

await Promise.all([first, second, other]);
assert.ok(order.indexOf('other:start') < order.indexOf('first:end'), 'different workspaces may run concurrently');
assert.ok(order.indexOf('second:start') > order.indexOf('first:end'), 'same-workspace operations must serialize');
assert.equal(pendingWorkspaceOperations(), 0);

// Read-only tool calls share the lock: a batch of reads on one workspace must overlap
// instead of serializing the way writes do.
const reads = [];
const readers = [0, 1, 2].map(index => runWorkspaceOperation('repo', async () => {
  reads.push(`read${index}:start`);
  await new Promise(resolve => setTimeout(resolve, 30));
  reads.push(`read${index}:end`);
}, { mode: 'read' }));
await Promise.all(readers);
assert.deepEqual(
  reads.slice(0, 3).sort(),
  ['read0:start', 'read1:start', 'read2:start'],
  'concurrent reads must all start before any of them finishes'
);
assert.equal(pendingWorkspaceOperations(), 0);

// A write must not overlap a read in either direction.
const mixed = [];
const runningRead = runWorkspaceOperation('repo', async () => {
  mixed.push('read:start');
  await new Promise(resolve => setTimeout(resolve, 40));
  mixed.push('read:end');
}, { mode: 'read' });
const blockedWrite = runWorkspaceOperation('repo', async () => {
  mixed.push('write:start');
  mixed.push('write:end');
}, { mode: 'write' });
await Promise.all([runningRead, blockedWrite]);
assert.deepEqual(mixed, ['read:start', 'read:end', 'write:start', 'write:end'], 'a write waits for in-flight reads');

// FIFO fairness: a queued write blocks reads that arrive after it, so a steady stream
// of reads cannot starve an edit.
const fairness = [];
const holdingRead = runWorkspaceOperation('fair', async () => {
  fairness.push('read1:start');
  await new Promise(resolve => setTimeout(resolve, 40));
  fairness.push('read1:end');
}, { mode: 'read' });
const queuedWrite = runWorkspaceOperation('fair', async () => {
  fairness.push('write:start');
  await new Promise(resolve => setTimeout(resolve, 10));
  fairness.push('write:end');
}, { mode: 'write' });
const lateRead = runWorkspaceOperation('fair', async () => {
  fairness.push('read2:start');
  fairness.push('read2:end');
}, { mode: 'read' });
await Promise.all([holdingRead, queuedWrite, lateRead]);
assert.deepEqual(
  fairness,
  ['read1:start', 'read1:end', 'write:start', 'write:end', 'read2:start', 'read2:end'],
  'a waiting write runs before reads queued behind it'
);
assert.equal(pendingWorkspaceOperations(), 0);

// A rejected operation must still release the lock.
await assert.rejects(
  runWorkspaceOperation('repo', async () => { throw new Error('boom'); }, { mode: 'write' }),
  /boom/
);
assert.equal(pendingWorkspaceOperations(), 0);
await runWorkspaceOperation('repo', async () => 'ok', { mode: 'write' });

console.log('Workspace operation queue tests passed.');
