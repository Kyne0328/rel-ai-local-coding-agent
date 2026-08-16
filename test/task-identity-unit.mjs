import assert from 'node:assert/strict';
import { taskEntityView } from '../src/ui/task-identity.js';
assert.deepEqual(taskEntityView({ work_id: 'logical-1', nativeTaskId: 'native-1', processId: 42 }), {
  logicalTaskId: 'logical-1',
  nativeTaskId: 'native-1',
  processId: '42'
});
console.log('Dashboard task identity contracts passed.');
