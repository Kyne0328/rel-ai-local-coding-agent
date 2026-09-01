import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY
} from '@modelcontextprotocol/server';
import { DEFAULT_MAX_BODY_BYTES, normalizeMaxBodyBytes, readRawBody, sendJson } from '../src/http/io.js';
import { createHttpRequestAbortScope, expectedMcpName } from '../src/http/mcpTransport.js';
import { resolveHttpRequestTimeoutMs } from '../src/httpServer.js';
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
  assert.equal(isTransportTaskRequestCandidate(config, editTaskCandidate), true, 'ordinary relai_edit must use recoverable long-call execution');
  const editChecksTaskCandidate = request(98, 'tools/call', {
    name: 'relai_edit',
    arguments: { work_id: 'work-session', path: 'README.md', oldText: 'before', newText: 'after', runChecks: true }
  }, tasksCapabilities);
  assert.equal(isTransportTaskRequestCandidate(config, editChecksTaskCandidate), true, 'relai_edit with post-checks must use recoverable long-call execution');
  const editWithoutTasks = await handleTransportTaskRequest(config, request(94, 'tools/call', {
    name: 'relai_edit',
    arguments: { workspace: 'app', work_id: 'edit-no-tasks', path: 'README.md', oldText: 'before', newText: 'after' }
  }, {}), {
    principal: owner,
    transportType: 'streamable-http',
    synchronousFallbackGraceMs: 0,
    executeToolResult: async () => ({ isError: false, structuredContent: { ok: true, changed: true } })
  });
  assert.equal(editWithoutTasks.body.result?.structuredContent?.status, 'running', 'ordinary edits must detach safely when the client does not advertise Tasks');
  for (const candidate of [
    request(97, 'tools/call', { name: 'relai_search', arguments: { action: 'semantic', work_id: 'work-session', query: 'target' } }, tasksCapabilities),
    request(96, 'tools/call', { name: 'relai_inspect', arguments: { action: 'architecture', work_id: 'work-session' } }, tasksCapabilities),
    request(95, 'tools/call', { name: 'relai_validate', arguments: { action: 'http', work_id: 'work-session', route: '/health' } }, tasksCapabilities)
  ]) {
    assert.equal(isTransportTaskRequestCandidate(config, candidate), true, `${candidate.params.name} long operation must reach capability negotiation`);
  }
  const timeout = await runBoundedExecution(
    signal => signal.aborted
      ? Promise.resolve({ stopped: true })
      : new Promise(resolve => signal.addEventListener('abort', () => resolve({ stopped: true }), { once: true })),
    { bounds: { maxDurationMs: 20 } }
  );
  assert.equal(timeout.ok, false);
  assert.equal(timeout.error.code, -32024);
  assert.equal(timeout.error.reason, 'synchronous_timeout');

  const largeOutput = await runBoundedExecution(
    async () => ({ value: 'x'.repeat(3 * 1024 * 1024) }),
    { bounds: { maxDurationMs: 1000 } }
  );
  assert.equal(largeOutput.ok, true, 'transport execution must not impose a second output-size policy after the tool has shaped its result');
  assert.equal(largeOutput.value.value.length, 3 * 1024 * 1024);

  const splitUtf8 = Readable.from([
    Buffer.from([0xf0, 0x9f]),
    Buffer.from([0x98, 0x80])
  ]);
  splitUtf8.headers = { 'content-length': '4' };
  assert.equal(await readRawBody(splitUtf8, 4), '😀', 'request decoding must preserve UTF-8 split across chunks');

  let preflightResumed = false;
  let preflightDestroyed = false;
  const oversizedDeclaredBody = new EventEmitter();
  oversizedDeclaredBody.headers = { 'content-length': '128' };
  oversizedDeclaredBody.resume = () => { preflightResumed = true; };
  oversizedDeclaredBody.destroy = () => { preflightDestroyed = true; };
  await assert.rejects(readRawBody(oversizedDeclaredBody, 64), error => error?.status === 413);
  assert.equal(preflightResumed, true, 'oversized request bodies should be drained so the connection can return a structured 413');
  assert.equal(preflightDestroyed, false, 'oversized request bodies must not be force-destroyed before the HTTP response is sent');
  assert.equal(normalizeMaxBodyBytes(undefined), DEFAULT_MAX_BODY_BYTES);
  assert.equal(normalizeMaxBodyBytes('not-a-number'), DEFAULT_MAX_BODY_BYTES, 'invalid body limits must fail closed to the bounded default instead of becoming unbounded');
  assert.equal(normalizeMaxBodyBytes(-1), DEFAULT_MAX_BODY_BYTES);
  assert.equal(normalizeMaxBodyBytes(12 * 1024 * 1024), 12 * 1024 * 1024, 'valid configured limits must not be arbitrarily clamped');
  assert.equal(resolveHttpRequestTimeoutMs(DEFAULT_MAX_BODY_BYTES), 300_000, 'default payloads should retain Node\'s normal finite request-receive window');
  assert.equal(resolveHttpRequestTimeoutMs(DEFAULT_MAX_BODY_BYTES * 2), 600_000, 'larger configured request bodies must receive a proportionally larger transport window');
  assert.equal(resolveHttpRequestTimeoutMs(Math.floor(DEFAULT_MAX_BODY_BYTES / 2)), 300_000, 'smaller body limits must not reduce the baseline request-receive protection window');

  let streamedOversizeResumed = false;
  const streamedOversize = new EventEmitter();
  streamedOversize.headers = {};
  streamedOversize.complete = false;
  streamedOversize.resume = () => { streamedOversizeResumed = true; };
  const streamedOversizeRead = readRawBody(streamedOversize, 64);
  streamedOversize.emit('data', Buffer.alloc(40));
  streamedOversize.emit('data', Buffer.alloc(40));
  await assert.rejects(streamedOversizeRead, error => error?.status === 413);
  assert.equal(streamedOversizeResumed, true, 'streaming bodies that cross the limit must continue draining for a structured 413 response');
  assert.equal(streamedOversize.listenerCount('data'), 0, 'rejected bodies must release buffered data listeners immediately');
  streamedOversize.emit('end');
  assert.equal(streamedOversize.listenerCount('end'), 0);
  assert.equal(streamedOversize.listenerCount('error'), 0);
  assert.equal(streamedOversize.listenerCount('close'), 0);

  const abortedBody = new EventEmitter();
  abortedBody.headers = {};
  abortedBody.complete = false;
  abortedBody.aborted = false;
  const abortedBodyRead = readRawBody(abortedBody, 64);
  abortedBody.emit('data', Buffer.alloc(32));
  abortedBody.aborted = true;
  abortedBody.emit('aborted');
  await assert.rejects(abortedBodyRead, /aborted before completion/i);
  abortedBody.emit('close');
  assert.equal(abortedBody.listenerCount('data'), 0);
  assert.equal(abortedBody.listenerCount('end'), 0);
  assert.equal(abortedBody.listenerCount('error'), 0);
  assert.equal(abortedBody.listenerCount('aborted'), 0);
  assert.equal(abortedBody.listenerCount('close'), 0, 'aborted request bodies must not leave transport listeners behind');

  let jsonStatus = 0;
  let jsonHeaders = null;
  let jsonBody = null;
  const jsonResponse = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    writeHead(status, headers) { jsonStatus = status; jsonHeaders = headers; },
    end(body) { jsonBody = body; this.writableEnded = true; }
  };
  sendJson(jsonResponse, 200, { ok: true, value: '😀' });
  assert.equal(jsonStatus, 200);
  assert.equal(typeof jsonBody, 'string', 'JSON responses should avoid a second full payload Buffer allocation');
  assert.equal(jsonHeaders['Content-Length'], Buffer.byteLength(jsonBody, 'utf8'));
  assert.doesNotThrow(() => sendJson({
    headersSent: false,
    writableEnded: true,
    destroyed: false,
    writeHead() { throw new Error('closed response must not be written'); },
    end() { throw new Error('closed response must not be ended'); }
  }, 200, { ok: true }), 'late transport errors must not try to write a second response');

  const externalAbort = new AbortController();
  const aborted = runBoundedExecution(
    signal => signal.aborted
      ? Promise.resolve({ stopped: true })
      : new Promise(resolve => signal.addEventListener('abort', () => resolve({ stopped: true }), { once: true })),
    { bounds: { maxDurationMs: 1000 }, signal: externalAbort.signal }
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

  const safeWithoutTasks = await handleTransportTaskRequest(config, request(101, 'tools/call', {
    name: 'relai_exec',
    arguments: {
      work_id: 'short-no-tasks',
      command: 'echo bounded execution',
      timeoutMs: 7_500,
      maxOutputBytes: 64 * 1024
    }
  }, {}), {
    principal: owner,
    transportType: 'streamable-http',
    synchronousFallbackGraceMs: 0,
    executeToolResult: async () => ({ isError: false, structuredContent: { ok: true, exitCode: 7 } })
  });
  assert.equal(safeWithoutTasks.body.result?.structuredContent?.exitCode, 7, 'short bounded calls must stay synchronous even when the client does not advertise Tasks');
  assert.equal(safeWithoutTasks.body.result?.structuredContent?.status, undefined, 'safe calls must not force a follow-up status request');

  const longWithoutTasks = await handleTransportTaskRequest(config, request(102, 'tools/call', {
    name: 'relai_exec',
    arguments: {
      work_id: 'long-no-tasks',
      command: 'echo detached execution',
      timeoutMs: 15_000,
      maxOutputBytes: 64 * 1024
    }
  }, {}), {
    principal: owner,
    transportType: 'streamable-http',
    synchronousFallbackGraceMs: 0,
    executeToolResult: async () => ({ isError: false, structuredContent: { ok: true, exitCode: 0 } })
  });
  assert.equal(longWithoutTasks.body.result?.structuredContent?.status, 'running', 'calls outside the safe synchronous envelope must remain detachable for clients without Tasks');

  let directArguments = null;
  const directResult = await handleTransportTaskRequest(config, request(102, 'tools/call', {
    name: 'relai_exec',
    arguments: {
      work_id: 'work-session',
      command: 'echo bounded execution',
      timeoutMs: 5_000,
      maxOutputBytes: 8 * 1024 * 1024
    }
  }, tasksCapabilities), {
    principal: owner,
    transportType: 'streamable-http',
    executeToolResult: async (_config, _name, args) => {
      directArguments = args;
      return { isError: false, structuredContent: { ok: true, exitCode: 0 } };
    }
  });
  assert.equal(directResult.body.result?.structuredContent?.exitCode, 0);
  assert.equal(directArguments.timeoutMs, 5_000, 'transport must preserve the tool timeout selected by the caller');
  assert.equal(directArguments.maxOutputBytes, 8 * 1024 * 1024, 'transport must preserve tool-owned output limits instead of silently clamping them');
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
  const invalidEligibleResponse = await waitForSent(stdioWire, 3);
  assert.equal(delegatedInvalid, null, 'invalid long-running tool arguments must stay inside the task-aware tool-result boundary');
  assert.equal(invalidEligibleResponse.id, 81);
  assert.equal(invalidEligibleResponse.result?.isError, true);
  assert.equal(invalidEligibleResponse.result?.structuredContent?.errorCode, 'INVALID_TOOL_ARGUMENTS');
  assert.match(invalidEligibleResponse.result?.structuredContent?.error || '', /invalid arguments|defer/i);

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
