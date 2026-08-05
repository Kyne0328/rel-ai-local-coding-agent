import assert from 'node:assert/strict';

import { mergeDashboardActivity } from '../src/http/dashboardData.js';

const merged = mergeDashboardActivity({
  entries: [
    {
      id: 'persisted-event',
      timestamp: '2026-08-05T10:00:00.000Z',
      tool: 'relai_read',
      status: 'running',
      summary: 'Reading repository.',
      args: { token: 'must-not-leak' }
    },
    {
      id: 'persisted-event',
      timestamp: '2026-08-05T10:00:01.000Z',
      tool: 'relai_read',
      status: 'completed',
      summary: 'Repository read complete.',
      output: { secret: 'must-not-leak' }
    }
  ]
}, [{
  id: 'work-1',
  workspace: 'repo',
  events: [{
    operationId: 'operation-2',
    ts: '2026-08-05T10:00:02.000Z',
    tool: 'relai_validate',
    ok: false,
    error: { message: 'Validation failed.' }
  }]
}], 20);

assert.equal(merged.entries.length, 2, 'persisted event IDs must merge lifecycle updates');
assert.deepEqual(merged.entries.map(entry => entry.eventId), ['persisted-event', 'operation-2']);
assert.deepEqual(merged.entries.map(entry => entry.ts), [
  '2026-08-05T10:00:01.000Z',
  '2026-08-05T10:00:02.000Z'
]);
assert.equal(merged.entries[0].status, 'completed');
assert.equal(merged.entries[0].message, 'Repository read complete.');
assert.equal(merged.entries[0].args, undefined);
assert.equal(merged.entries[0].output, undefined);
assert.equal(merged.entries[1].status, 'failed');
assert.equal(merged.entries[1].workspace, 'repo');
assert.equal(merged.entries[1].taskId, 'work-1');
assert.equal(merged.entries[1].message, 'Validation failed.');

console.log('Dashboard activity identity, timestamp, ordering, and safe projection passed.');
