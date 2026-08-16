import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createServiceProcessClient } from '../electron/service-process-client.js';

class FakeUtilityProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = 4321;
    this.sent = [];
    queueMicrotask(() => this.emit('spawn'));
  }

  postMessage(message) {
    this.sent.push(message);
    if (message.type !== 'request' || message.method !== 'start') return;
    queueMicrotask(() => this.emit('message', {
      type: 'response',
      id: message.id,
      ok: true,
      result: { ok: true, port: 3333 }
    }));
  }

  kill() {}
}

let child = null;
const client = createServiceProcessClient({
  utilityProcess: {
    fork() {
      child = new FakeUtilityProcess();
      return child;
    }
  },
  modulePath: '/app/electron/service-process.js'
});

await client.start({ host: '127.0.0.1', port: 3333 });
const phases = [];
const unsubscribe = client.activitySource.onToolActivity(event => phases.push(event.phase));
const task = {
  id: 'task-1',
  taskId: 'task-1',
  workspace: 'repo',
  state: 'working',
  status: 'running',
  activeCalls: 1,
  startedAt: 1,
  lastTool: 'relai_edit',
  operation: 'Editing files'
};

child.emit('message', {
  type: 'activity',
  event: { phase: 'snapshot', snapshot: { state: 'idle', activeConnectorCalls: 0, activeCalls: 0, activeTaskCount: 0, tasks: [] } }
});
child.emit('message', {
  type: 'activity',
  event: { phase: 'started', activeConnectorCalls: 1, activeCalls: 1, activeTaskCount: 1, taskId: 'task-1', task }
});
for (let index = 0; index < 500; index += 1) {
  child.emit('message', {
    type: 'activity',
    event: {
      phase: 'progress',
      activeConnectorCalls: 1,
      activeCalls: 1,
      activeTaskCount: 1,
      taskId: 'task-1',
      task: { ...task, operation: `Editing file ${index + 1}` }
    }
  });
}
child.emit('message', {
  type: 'activity',
  event: {
    phase: 'finished',
    activeConnectorCalls: 0,
    activeCalls: 0,
    activeTaskCount: 1,
    taskId: 'task-1',
    ok: true,
    task: { ...task, state: 'waiting', status: 'waiting', activeCalls: 0 }
  }
});

assert.deepEqual(phases, ['snapshot', 'started', 'finished'], 'high-frequency tool progress must not churn Electron main-process activity subscribers');
assert.equal(client.isListening(), true, 'dropping progress delivery must not affect service liveness');
unsubscribe();
await client.dispose({ stop: false });

console.log('Electron service activity bridge keeps main-process updates lifecycle-driven.');
