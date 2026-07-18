import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runWorkspaceOperation, pendingWorkspaceOperations } = require('../src/workspaceOperationQueue.js');

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

console.log('Workspace operation queue tests passed.');
