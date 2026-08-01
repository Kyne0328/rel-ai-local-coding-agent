import assert from 'node:assert/strict';
import {
  DASHBOARD_RUNTIME_HANDOFF_FIELDS,
  TASK_ENTITY_IDENTIFIERS,
  recoveryStateView,
  taskEntityView
} from '../src/ui/task-identity.js';

assert.equal(TASK_ENTITY_IDENTIFIERS.logicalTask.field, 'work_id');
assert.equal(TASK_ENTITY_IDENTIFIERS.nativeTask.field, 'taskId');
assert.equal(TASK_ENTITY_IDENTIFIERS.process.field, 'processId');
assert.deepEqual(taskEntityView({ work_id: 'logical-1', nativeTaskId: 'native-1', processId: 42 }), {
  logicalTaskId: 'logical-1',
  nativeTaskId: 'native-1',
  processId: '42'
});
assert.ok(DASHBOARD_RUNTIME_HANDOFF_FIELDS.oauth.includes('activeIssuer'));
assert.ok(DASHBOARD_RUNTIME_HANDOFF_FIELDS.oauth.includes('persistedIssuer'));
assert.ok(DASHBOARD_RUNTIME_HANDOFF_FIELDS.nativeTask.includes('inputRequired'));
assert.match(recoveryStateView({ nativeTasksSupported: false }).title, /not advertised/i);
assert.match(recoveryStateView({ nativeTasksSupported: false }).action, /No server recovery is required/i);
assert.match(recoveryStateView({ recoveryState: 'input_required' }).title, /input required/i);
assert.match(recoveryStateView({ recoveryState: 'interrupted_non_resumable' }).message, /cannot be resumed/i);
assert.match(recoveryStateView({ recoveryState: 'cancelled' }).title, /cancelled/i);
assert.match(recoveryStateView({ validation: 'failed', repairable: true }).action, /same work session/i);
assert.match(recoveryStateView({ recoveryState: 'issuer_disagreement' }).title, /issuer mismatch/i);
assert.match(recoveryStateView({ recoveryState: 'corrupt_oauth_state' }).title, /corrupt/i);
assert.match(recoveryStateView({ recoveryState: 'connector_reregistration_required' }).action, /affected connector/i);

console.log('Dashboard task identity and recovery adapter contracts passed.');
