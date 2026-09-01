import assert from 'node:assert/strict';
import { taskTraceJsonl } from '../src/ui/features/sessions/index.js';

const session = {
  trace: {
    entries: [
      { auditId: 'a1', taskId: 'task-1', tool: 'read', ok: true },
      { auditId: 'a2', taskId: 'task-1', tool: 'exec', ok: false, error: 'failed' }
    ]
  }
};
const jsonl = taskTraceJsonl(session);
const rows = jsonl.trim().split('\n').map(line => JSON.parse(line));
assert.deepEqual(rows, session.trace.entries);
assert.equal(taskTraceJsonl({}), '');
console.log('Task trace JSONL export tests passed.');
