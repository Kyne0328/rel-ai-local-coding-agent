import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { createServiceProcessClient } from '../electron/service-process-client.js';
import { projectServiceActivityEvent, projectServiceActivitySnapshot } from '../electron/service-activity-projection.js';

const projectedTask = {
  taskId: 'task-projection',
  workspace: 'repo',
  events: [{ eventId: 'private-timeline' }],
  currentOperations: [{ id: 'private-operation' }],
  principalFingerprint: 'private-principal'
};
const projectedEvent = projectServiceActivityEvent({
  phase: 'finished',
  operationId: 'operation-42',
  task: projectedTask
});
assert.equal(projectedEvent.operationId, 'operation-42', 'service activity must preserve operation correlation across the desktop boundary');
assert.equal(Object.hasOwn(projectedEvent.task, 'events'), false, 'service activity must not serialize task timelines into Electron IPC');
assert.equal(Object.hasOwn(projectedEvent.task, 'currentOperations'), false, 'service activity must not serialize active-operation payloads into Electron IPC');
assert.equal(Object.hasOwn(projectedEvent.task, 'principalFingerprint'), false, 'service activity must not serialize principal fingerprints into Electron IPC');
assert.equal(projectServiceActivityEvent({ phase: 'progress', task: projectedTask }), null, 'high-frequency progress must be dropped before Electron IPC serialization');
assert.equal(projectServiceActivitySnapshot({ tasks: [projectedTask] }).tasks[0].taskId, 'task-projection');

class FakeUtilityProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = 4321;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.sent = [];
    this.killed = false;
    queueMicrotask(() => this.emit('spawn'));
  }

  postMessage(message) {
    this.sent.push(message);
    if (message.type !== 'request') return;
    const responses = {
      start: { ok: true, port: 4567 },
      'dashboard-bootstrap': { ok: true, port: 4567, bootstrap: 'bootstrap-token' },
      stop: {
        ok: true,
        cleanup: {
          clean: true,
          managedProcesses: { attempted: 0, stopped: 0, orphaned: 0 },
          localService: { closed: true, forced: false }
        }
      }
    };
    queueMicrotask(() => this.emit('message', {
      type: 'response',
      id: message.id,
      ok: true,
      result: responses[message.method]
    }));
  }

  kill() {
    this.killed = true;
  }
}

const forks = [];
let child = null;
const utilityProcess = {
  fork(modulePath, args, options) {
    child = new FakeUtilityProcess();
    forks.push({ modulePath, args, options, child });
    return child;
  }
};

const nativeCalls = [];
const logs = [];
const client = createServiceProcessClient({
  utilityProcess,
  modulePath: '/app/electron/service-process.js',
  cwd: '/app',
  nativeHandlers: {
    openFolder: payload => {
      nativeCalls.push(payload.path);
      return { ok: true };
    }
  },
  onLog: (message, options) => logs.push({ message, options })
});

client.updateContext({ status: { serverRunning: false } });
const activityEvents = [];
client.activitySource.onToolActivity(event => activityEvents.push(event));
const unsubscribeBrokenActivityListener = client.activitySource.onToolActivity(() => { throw new Error('listener boom'); });

const started = await client.start({ host: '127.0.0.1', port: 3333, token: 'secret' });
assert.equal(started.port, 4567);
assert.equal(client.isListening(), true);
assert.equal(client.port(), 4567);
assert.equal(forks.length, 1);
assert.equal(forks[0].options.serviceName, 'Rel.AI MCP Service');
assert.equal(forks[0].options.stdio, 'pipe');
assert.equal(forks[0].options.cwd, '/app');
const initialContextMessages = child.sent.filter(message => message.type === 'context');
assert.equal(initialContextMessages.length, 1, 'service startup must send the retained desktop context only once');
assert.equal(initialContextMessages[0].context.status?.serverRunning, false);

child.emit('message', {
  type: 'activity',
  event: {
    phase: 'snapshot',
    snapshot: { state: 'working', activeCalls: 1, activeTaskCount: 1, tasks: [{ id: 'task-1' }] }
  }
});
assert.equal(client.activitySource.getToolActivity().state, 'working');
assert.equal(client.activitySource.getToolActivity().tasks[0].id, 'task-1');
assert.equal(activityEvents.length, 1);
child.emit('message', {
  type: 'activity',
  event: { phase: 'snapshot', snapshot: { state: 'working', activeCalls: 1, activeTaskCount: 1, tasks: [{ id: 'task-1' }] } }
});
const subscriberFailures = logs.filter(entry => entry.options.code === 'activity_listener_failed');
assert.equal(subscriberFailures.length, 1, 'a failing subscriber must be diagnosable without log spam');
assert.equal(subscriberFailures[0].options.taskId, 'task-1', 'subscriber failures should retain task correlation when the event identifies one task');
unsubscribeBrokenActivityListener();

const unsubscribeCorrelatedFailureListener = client.activitySource.onToolActivity(() => { throw new Error('correlated listener boom'); });
child.emit('message', {
  type: 'activity',
  event: { phase: 'finished', taskId: 'task-1', operationId: 'operation-42', operation: 'Read project', workspace: 'repo', ok: false }
});
const correlatedFailure = logs.filter(entry => entry.options.code === 'activity_listener_failed').at(-1);
assert.equal(correlatedFailure.options.eventId, 'operation-42', 'subscriber diagnostics must retain the projected operation ID');
unsubscribeCorrelatedFailureListener();

client.updateContext({
  runtimeLogs: { available: true, revision: 1, count: 1, entries: [{ message: 'first' }] }
});
client.updateContext({
  runtimeLogChange: { type: 'append', revision: 2, count: 2, maxEntries: 3, entry: { message: 'second' } }
});
const logDeltaMessage = child.sent.at(-1);
assert.equal(logDeltaMessage.type, 'context');
assert.equal(logDeltaMessage.context.runtimeLogChange.entry.message, 'second');
assert.equal(Object.hasOwn(logDeltaMessage.context, 'runtimeLogs'), false, 'log changes must cross the utility-process boundary as deltas');

child.emit('message', { type: 'native-request', id: 'native-1', method: 'openFolder', payload: { path: '/repo' } });
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(nativeCalls, ['/repo']);
assert.ok(child.sent.some(message => message.type === 'native-response' && message.id === 'native-1' && message.ok === true));

child.stdout.write('service ready\n');
child.stderr.write('service warning\n');
await new Promise(resolve => setImmediate(resolve));
assert.ok(logs.some(entry => entry.message === 'service ready' && entry.options.level === 'info'));
assert.ok(logs.some(entry => entry.message === 'service warning' && entry.options.level === 'warning'));

const bootstrap = await client.dashboardBootstrap();
assert.equal(bootstrap.bootstrap, 'bootstrap-token');
const stopped = await client.stop();
assert.equal(stopped.cleanup.clean, true);
assert.equal(client.isListening(), false);

const exitedChild = child;
exitedChild.emit('exit', 1);
assert.equal(client.isListening(), false);
assert.equal(client.activitySource.getToolActivity().state, 'idle', 'an exited service process must not leave stale active desktop work');
assert.equal(activityEvents.at(-1).phase, 'snapshot');
assert.equal(activityEvents.at(-1).snapshot.state, 'idle');

await client.start({ host: '127.0.0.1', port: 3333, token: 'secret' });
assert.equal(forks.length, 2);
const respawnContext = child.sent.find(message => message.type === 'context');
assert.equal(respawnContext.context.runtimeLogs.revision, 2, 'a respawned service must receive the reconstructed current log snapshot');
assert.deepEqual(respawnContext.context.runtimeLogs.entries.map(entry => entry.message), ['first', 'second']);
assert.equal(Object.hasOwn(respawnContext.context, 'runtimeLogChange'), false);

await client.dispose({ stop: false });
assert.equal(child.killed, true);

console.log('Electron utility-process service bridge contracts passed.');
