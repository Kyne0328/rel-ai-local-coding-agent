import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY
} from '@modelcontextprotocol/server';
import { createHttpRequestAbortScope, expectedMcpName } from '../src/http/mcpTransport.js';
import {
  createNativeTask,
  getNativeTask,
  requestNativeTaskInput
} from '../src/mcp/nativeTaskService.js';
import {
  MCP_PROTOCOL_VERSION,
  TASKS_EXTENSION_ID,
  TASKS_EXTENSION_REVISION
} from '../src/mcp/protocol.js';
import {
  createTaskAwareStdioTransport,
  handleTransportTaskRequest,
  isTransportTaskRequestCandidate,
  runBoundedExecution
} from '../src/mcp/transportTasks.js';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-transport-tasks-'));
const config = { stateDir: sandbox };
const owner = { clientId: 'client-a', authMode: 'oauth' };
const otherOwner = { clientId: 'client-b', authMode: 'oauth' };
const localOwner = { clientId: 'stdio:session-a', authMode: 'local_session' };
const localOtherOwner = { clientId: 'stdio:session-b', authMode: 'local_session' };
const tasksCapabilities = { extensions: { [TASKS_EXTENSION_ID]: { revision: TASKS_EXTENSION_REVISION } } };

function request(id, method, params = {}, capabilities = tasksCapabilities) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: MCP_PROTOCOL_VERSION,
        [CLIENT_INFO_META_KEY]: { name: 'transport-test', version: '1.0.0' },
        [CLIENT_CAPABILITIES_META_KEY]: capabilities
      }
    }
  };
}

class FakeTransport {
  constructor() {
    this.sent = [];
    this.closed = false;
  }

  async start() {}

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  async send(message) {
    this.sent.push(message);
  }

  receive(message) {
    this.onmessage?.(message);
  }
}

async function waitForSent(transport, count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (transport.sent.length >= count) return transport.sent[count - 1];
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for stdio response ${count}.`);
}

try {
  const editTaskCandidate = request(99, 'tools/call', {
    name: 'relai_edit',
    arguments: { work_id: 'work-session', path: 'README.md', oldText: 'before', newText: 'after' }
  }, tasksCapabilities);
  assert.equal(isTransportTaskRequestCandidate(config, editTaskCandidate), false, 'relai_edit must remain an ordinary tools/call operation instead of host-managed native Tasks');
  const timeout = await runBoundedExecution(
    signal => signal.aborted
      ? Promise.resolve({ stopped: true })
      : new Promise(resolve => signal.addEventListener('abort', () => resolve({ stopped: true }), { once: true })),
    { bounds: { maxDurationMs: 20, maxCapturedOutputBytes: 1024 } }
  );
  assert.equal(timeout.ok, false);
  assert.equal(timeout.error.code, -32024);
  assert.equal(timeout.error.reason, 'synchronous_timeout');

  const outputLimit = await runBoundedExecution(
    async () => ({ value: 'x'.repeat(200) }),
    { bounds: { maxDurationMs: 1000, maxCapturedOutputBytes: 64 } }
  );
  assert.equal(outputLimit.ok, false);
  assert.equal(outputLimit.error.code, -32024);
  assert.equal(outputLimit.error.reason, 'synchronous_output_limit');
  assert.ok(outputLimit.error.data.capturedOutputBytes > 64);

  const externalAbort = new AbortController();
  const aborted = runBoundedExecution(
    signal => signal.aborted
      ? Promise.resolve({ stopped: true })
      : new Promise(resolve => signal.addEventListener('abort', () => resolve({ stopped: true }), { once: true })),
    { bounds: { maxDurationMs: 1000, maxCapturedOutputBytes: 1024 }, signal: externalAbort.signal }
  );
  externalAbort.abort(new Error('client disconnected'));
  const abortedResult = await aborted;
  assert.equal(abortedResult.ok, false);
  assert.equal(abortedResult.error.code, -32800);
  assert.equal(abortedResult.error.reason, 'execution_aborted');

  const execTaskCandidate = request(100, 'tools/call', {
    name: 'relai_exec',
    arguments: {
      work_id: 'work-session',
      command: 'echo ordinary execution',
      timeoutMs: 90_000,
      maxOutputBytes: 60_000
    }
  }, tasksCapabilities);
  assert.equal(isTransportTaskRequestCandidate(config, execTaskCandidate), true, 'task-eligible relai_exec calls must reach capability negotiation');
  const synchronousFallback = await handleTransportTaskRequest(config, request(100, 'tools/call', {
    name: 'relai_exec',
    arguments: {
      work_id: 'work-session',
      command: 'echo ordinary execution',
      timeoutMs: 90_000,
      maxOutputBytes: 60_000
    }
  }, {}), {
    principal: owner,
    transportType: 'streamable-http',
    executeToolResult: async () => ({ isError: false, structuredContent: { ok: true, exitCode: 0 } })
  });
  assert.equal(synchronousFallback.body.result?.resultType, undefined, 'clients without Tasks capability must keep the synchronous result path');
  assert.equal(synchronousFallback.body.result?.structuredContent?.exitCode, 0);
  const req = new EventEmitter();
  const socket = new EventEmitter();
  req.socket = socket;
  req.aborted = false;
  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  const httpAbort = createHttpRequestAbortScope(req, res);
  req.emit('aborted');
  assert.equal(httpAbort.signal.aborted, true);
  assert.match(String(httpAbort.signal.reason?.message || ''), /aborted by the client/i);
  httpAbort.dispose();
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
  assert.equal(socket.listenerCount('close'), 0);

  assert.equal(expectedMcpName('tasks/get', { taskId: 'task-1' }), 'task-1');
  assert.equal(expectedMcpName('tasks/update', { taskId: 'task-2' }), 'task-2');
  assert.equal(expectedMcpName('tasks/cancel', { taskId: 'task-3' }), 'task-3');

  const missingCapability = await handleTransportTaskRequest(
    config,
    request(1, 'tasks/get', { taskId: 'task-missing' }, {}),
    { principal: owner, transportType: 'streamable-http' }
  );
  assert.equal(missingCapability.body.error.code, -32021);
  assert.deepEqual(missingCapability.body.error.data.requiredCapabilities, tasksCapabilities);

  const malformedCapability = await handleTransportTaskRequest(
    config,
    request(101, 'tasks/get', { taskId: 'task-missing' }, { extensions: [] }),
    { principal: owner, transportType: 'streamable-http' }
  );
  assert.equal(malformedCapability.body.error.code, -32602);
  assert.deepEqual(malformedCapability.body.error.data, {
    reason: 'invalid_client_capabilities',
    capabilityReason: 'malformed_extensions',
    expectedCapabilities: tasksCapabilities
  });

  const unsupportedRevision = await handleTransportTaskRequest(
    config,
    request(102, 'tasks/get', { taskId: 'task-missing' }, {
      extensions: { [TASKS_EXTENSION_ID]: { revision: '1900-01-01' } }
    }),
    { principal: owner, transportType: 'streamable-http' }
  );
  assert.equal(unsupportedRevision.body.error.code, -32602);
  assert.equal(unsupportedRevision.body.error.data.capabilityReason, 'unsupported_tasks_revision');

  const invalidId = await handleTransportTaskRequest(
    config,
    { ...request(103, 'tasks/get', { taskId: 'task-missing' }), id: { invalid: true } },
    { principal: owner, transportType: 'streamable-http' }
  );
  assert.equal(invalidId.body.id, null);
  assert.equal(invalidId.body.error.code, -32600);

  const taskController = new AbortController();
  const task = createNativeTask(config, {
    principal: owner,
    method: 'tools/call',
    name: 'input-test',
    executor: { controller: taskController, resume() {} }
  });
  requestNativeTaskInput(config, task.taskId, {
    approval: {
      responseSchema: {
        type: 'object',
        required: ['approved'],
        additionalProperties: false,
        properties: { approved: { type: 'boolean' } }
      }
    }
  }, { principal: owner });

  const updated = await handleTransportTaskRequest(
    config,
    request(2, 'tasks/update', {
      taskId: task.taskId,
      inputResponses: { approval: { approved: true } }
    }),
    { principal: owner, transportType: 'streamable-http' }
  );
  assert.equal(updated.body.error, undefined);
  assert.equal(getNativeTask(config, task.taskId, { principal: owner }).status, 'working');

  const replayedUpdate = await handleTransportTaskRequest(
    config,
    request(3, 'tasks/update', {
      taskId: task.taskId,
      inputResponses: { approval: { approved: true } }
    }),
    { principal: owner, transportType: 'streamable-http' }
  );
  assert.equal(replayedUpdate.body.error, undefined);
  assert.equal(replayedUpdate.body.result.resultType, 'complete');

  const denied = await handleTransportTaskRequest(
    config,
    request(4, 'tasks/get', { taskId: task.taskId }),
    { principal: otherOwner, transportType: 'streamable-http' }
  );
  assert.equal(denied.body.error.code, -32602);
  assert.match(denied.body.error.message, /not available to this client/i);

  const cancelled = await handleTransportTaskRequest(
    config,
    request(5, 'tasks/cancel', { taskId: task.taskId }),
    { principal: owner, transportType: 'streamable-http' }
  );
  assert.equal(cancelled.body.error, undefined);
  const cancellationRequested = getNativeTask(config, task.taskId, { principal: owner });
  assert.equal(cancellationRequested.status, 'working');
  assert.equal(taskController.signal.aborted, true);

  const malformed = await handleTransportTaskRequest(
    config,
    request(6, 'tasks/get'),
    { principal: owner, transportType: 'streamable-http' }
  );
  assert.equal(malformed.body.error.code, -32602);

  const stdioTask = createNativeTask(config, {
    principal: localOwner,
    method: 'tools/call',
    name: 'stdio-isolation-test',
    executor: { controller: new AbortController() }
  });
  const stdioWire = new FakeTransport();
  const stdio = createTaskAwareStdioTransport({ config, principal: localOwner, transport: stdioWire });
  await stdio.start();
  stdioWire.receive(request(7, 'tasks/get', { taskId: stdioTask.taskId }, {}));
  const stdioMissing = await waitForSent(stdioWire, 1);
  assert.deepEqual(stdioMissing.error, missingCapability.body.error);

  stdioWire.receive(request(8, 'tasks/get', { taskId: stdioTask.taskId }));
  const stdioOwned = await waitForSent(stdioWire, 2);
  assert.equal(stdioOwned.result.taskId, stdioTask.taskId);
  assert.equal(stdioOwned.result.status, 'working');

  let delegatedInvalid = null;
  stdio.onmessage = message => { delegatedInvalid = message; };
  const invalidEligibleCall = request(81, 'tools/call', {
    name: 'relai_exec',
    arguments: { work_id: 'work-session', command: 'echo invalid', defer: true }
  });
  stdioWire.receive(invalidEligibleCall);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delegatedInvalid, invalidEligibleCall, 'invalid eligible-tool arguments must delegate to SDK validation without closing stdio');

  const otherWire = new FakeTransport();
  const otherStdio = createTaskAwareStdioTransport({ config, principal: localOtherOwner, transport: otherWire });
  await otherStdio.start();
  otherWire.receive(request(9, 'tasks/get', { taskId: stdioTask.taskId }));
  const stdioDenied = await waitForSent(otherWire, 1);
  assert.equal(stdioDenied.error.code, denied.body.error.code);
  assert.equal(stdioDenied.error.message, denied.body.error.message);

  await stdio.close();
  await otherStdio.close();

  console.log('HTTP and stdio Tasks routing, identity isolation, cancellation, abort, timeout, and output-limit tests passed.');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
