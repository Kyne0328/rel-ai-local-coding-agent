import assert from 'node:assert/strict';
import { activityEventId } from '../src/ui/activity-event.js';

const event = {
  ts: '2026-07-18T07:00:00.000Z',
  tool: 'relai_edit',
  workspace: 'rel-ai-mcp',
  taskId: 'task-1',
  operationId: 'operation-1',
  operation: 'Editing dashboard sessions',
  ms: 42,
  ok: true
};

assert.equal(activityEventId(event), activityEventId({ ...event }), 'the same audit event must have a stable identity');
assert.notEqual(activityEventId(event), activityEventId({ ...event, operationId: 'operation-2' }), 'different operations must not collide');
assert.notEqual(activityEventId(event), activityEventId({ ...event, ok: false }), 'success and failure events must not collide');
const persisted = activityEventId({ id: 'persisted-id', tool: 'ignored' });
assert.equal(persisted, activityEventId({ id: 'persisted-id', tool: 'different' }), 'persisted event IDs must take precedence');
assert.match(persisted, /^event:[a-f0-9]{16}$/, 'event identities must be compact and URL-safe');
assert.doesNotMatch(activityEventId(event), /[\u0000-\u001f\u007f]/, 'event identities must survive route sanitization');

console.log('Activity event identity tests passed.');
