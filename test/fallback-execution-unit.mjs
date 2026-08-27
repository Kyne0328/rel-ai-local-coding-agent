import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY
} from '@modelcontextprotocol/server';

import {
  DEFAULT_FALLBACK_GRACE_MS,
  cancelFallbackExecution,
  fallbackExecutionStatus,
  resetFallbackExecutions,
  startFallbackExecution
} from '../src/mcp/fallbackExecutions.js';
import { MCP_PROTOCOL_VERSION } from '../src/mcp/protocol.js';
import { toolResult } from '../src/mcp/results.js';
import { handleTransportTaskRequest } from '../src/mcp/transportTasks.js';
import {
  readTaskHistorySessionRecord,
  recordTaskBackgroundOperation,
  recordTaskHistoryEvent
} from '../src/taskHistoryStore.js';

function message(id, workId, command = 'node test.js') {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      name: 'relai_exec',
      arguments: {
        workspace: 'app',
        work_id: workId,
        command,
        timeoutMs: 60_000
      },
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: MCP_PROTOCOL_VERSION,
        [CLIENT_CAPABILITIES_META_KEY]: {}
      }
    }
  };
}

function completedResult(workId, stdout = 'done') {
  return toolResult({
    ok: true,
    executed: true,
    commandSucceeded: true,
    workspace: 'app',
    work_id: workId,
    durationMs: 25,
    exitCode: 0,
    stdout
  }, false);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function seedTask(config, taskId) {
  recordTaskHistoryEvent(config, {
    taskId,
    taskIdentityVersion: 2,
    taskIdExplicit: true,
    taskHistoryEligible: true,
    eventType: 'task.started',
    tool: 'work.begin',
    workspace: 'app',
    ok: true,
    ts: new Date().toISOString()
  });
}

assert.equal(DEFAULT_FALLBACK_GRACE_MS, 1_000, 'non-Tasks fallback should detach quickly instead of holding the connector open');
resetFallbackExecutions();

const fastWorkId = 'work_fast_fallback_test';
const fast = await handleTransportTaskRequest({}, message(1, fastWorkId), {
  principal: 'principal-a',
  transportType: 'test',
  synchronousFallbackGraceMs: 50,
  executeToolResult: async () => completedResult(fastWorkId, 'fast')
});
assert.equal(fast.body.result.isError, false);
assert.equal(fast.body.result.structuredContent.exitCode, 0);
assert.equal(fast.body.result.structuredContent.stdout, 'fast');

const slowWorkId = 'work_slow_fallback_test';
let executionCount = 0;
const requestAbort = new AbortController();
const slowExecute = async () => {
  executionCount += 1;
  await delay(40);
  return completedResult(slowWorkId, 'slow complete');
};
const slow = await handleTransportTaskRequest({}, message(2, slowWorkId), {
  principal: 'principal-a',
  transportType: 'test',
  signal: requestAbort.signal,
  synchronousFallbackGraceMs: 5,
  executeToolResult: slowExecute
});
assert.equal(slow.body.result.isError, false);
assert.equal(slow.body.result.structuredContent.status, 'running');
assert.equal(slow.body.result.structuredContent.pollAfterMs, 1_000);
assert.equal(slow.body.result.structuredContent.revision, 1);
assert.ok(slow.body.result.structuredContent.operationId);
assert.ok(slow.body.result.structuredContent.updatedAt);
assert.match(slow.body.result.structuredContent.nextAction, /relai_work.*status/i);
assert.equal(executionCount, 1);

requestAbort.abort(new Error('simulated connector disconnect'));
const duplicate = await handleTransportTaskRequest({}, message(3, slowWorkId), {
  principal: 'principal-a',
  transportType: 'test',
  synchronousFallbackGraceMs: 5,
  executeToolResult: slowExecute
});
assert.equal(duplicate.body.result.structuredContent.status, 'running');
assert.equal(executionCount, 1, 'a retry while the same fallback is running must not duplicate execution');

const busy = await handleTransportTaskRequest({}, message(4, slowWorkId, 'node other-test.js'), {
  principal: 'principal-a',
  transportType: 'test',
  synchronousFallbackGraceMs: 5,
  executeToolResult: slowExecute
});
assert.equal(busy.body.result.isError, false, 'an occupied work session is recoverable control flow, not a tool-level failure');
assert.equal(busy.body.result.structuredContent.ok, false);
assert.equal(busy.body.result.structuredContent.errorCode, 'TASK_OPERATION_IN_PROGRESS');
assert.match(busy.body.result.structuredContent.nextAction, /relai_work.*status/i);
assert.equal(executionCount, 1, 'a different long operation must not start while the work session is occupied');

await delay(60);
const completed = fallbackExecutionStatus(slowWorkId);
assert.equal(completed.status, 'completed');
assert.equal(completed.revision, 2);
assert.equal(completed.result.exitCode, 0);
assert.equal(completed.result.stdout, 'slow complete');
assert.equal(executionCount, 1, 'request cancellation must not abort or restart detached fallback work');

const completedRetry = await handleTransportTaskRequest({}, message(5, slowWorkId), {
  principal: 'principal-a',
  transportType: 'test',
  synchronousFallbackGraceMs: 5,
  executeToolResult: slowExecute
});
assert.equal(completedRetry.body.result.structuredContent.stdout, 'slow complete');
assert.equal(executionCount, 1, 'a completed retry with the same signature must replay instead of executing again');

const cancelledWorkId = 'work_cancelled_fallback_test';
let fallbackAbortObserved = false;
const cancellable = startFallbackExecution({
  workId: cancelledWorkId,
  tool: 'relai_validate',
  workspace: 'app',
  signature: 'cancel-signature',
  run: signal => new Promise(resolve => {
    const finish = () => {
      fallbackAbortObserved = true;
      resolve(toolResult({ ok: false, work_id: cancelledWorkId, cancelled: true }, true));
    };
    if (signal.aborted) finish();
    else signal.addEventListener('abort', finish, { once: true });
  })
});
const cancellation = cancelFallbackExecution(cancelledWorkId, { reason: 'Explicit fallback cancellation test.' });
assert.equal(cancellation.cancelled, true);
await cancellable.record.promise;
assert.equal(fallbackAbortObserved, true, 'explicit work-session cancellation must reach the detached operation signal');
assert.equal(fallbackExecutionStatus(cancelledWorkId).status, 'cancelled');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-fallback-durable-'));
const config = { stateDir: sandbox, auditLogPath: path.join(sandbox, 'audit.jsonl') };
try {
  resetFallbackExecutions();
  const durableWorkId = 'work_durable_fallback_test';
  seedTask(config, durableWorkId);
  let durableExecutionCount = 0;
  const durableExecute = async () => {
    durableExecutionCount += 1;
    await delay(30);
    return completedResult(durableWorkId, 'must-not-persist-raw-stdout');
  };
  const durableStarted = await handleTransportTaskRequest(config, message(10, durableWorkId), {
    principal: 'principal-a',
    transportType: 'test',
    synchronousFallbackGraceMs: 5,
    executeToolResult: durableExecute
  });
  assert.equal(durableStarted.body.result.structuredContent.status, 'running');
  await delay(50);

  const durableSession = readTaskHistorySessionRecord(config, durableWorkId);
  assert.equal(durableSession.backgroundOperation.status, 'completed');
  assert.equal(durableSession.backgroundOperation.revision, 2);
  assert.equal(durableSession.backgroundOperation.result.exitCode, 0);
  assert.equal(Object.hasOwn(durableSession.backgroundOperation.result, 'stdout'), false, 'durable task history must redact raw command output');
  assert.ok(durableSession.backgroundOperation.signature, 'private signature must persist for restart-safe deduplication');

  resetFallbackExecutions();
  const recovered = fallbackExecutionStatus(durableWorkId, { config });
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.result.exitCode, 0);
  assert.equal(Object.hasOwn(recovered, 'signature'), false, 'public fallback status must not expose the replay signature');
  assert.equal(Object.hasOwn(recovered.result, 'stdout'), false);

  const durableReplay = await handleTransportTaskRequest(config, message(11, durableWorkId), {
    principal: 'principal-a',
    transportType: 'test',
    synchronousFallbackGraceMs: 5,
    executeToolResult: durableExecute
  });
  assert.equal(durableReplay.body.result.structuredContent.exitCode, 0);
  assert.equal(Object.hasOwn(durableReplay.body.result.structuredContent, 'stdout'), false, 'post-restart replay should use the sanitized durable result');
  assert.equal(durableExecutionCount, 1, 'completed work must remain idempotent after the in-memory fallback cache is lost');

  const interruptedWorkId = 'work_interrupted_fallback_test';
  seedTask(config, interruptedWorkId);
  recordTaskBackgroundOperation(config, interruptedWorkId, {
    operationId: 'fallback_interrupted_fixture',
    workId: interruptedWorkId,
    tool: 'relai_exec',
    workspace: 'app',
    signature: 'interrupted-signature',
    status: 'running',
    startedAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    revision: 1,
    result: { exitCode: 0, stdout: 'must-not-persist' }
  });
  resetFallbackExecutions();
  const interrupted = fallbackExecutionStatus(interruptedWorkId, { config, now: () => Date.parse('2026-08-27T00:01:00.000Z') });
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.revision, 2);
  assert.match(interrupted.error, /runtime restarted/i);
  const interruptedSession = readTaskHistorySessionRecord(config, interruptedWorkId);
  assert.equal(interruptedSession.backgroundOperation.status, 'interrupted');
  assert.equal(Object.hasOwn(interruptedSession.backgroundOperation.result, 'stdout'), false);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
  resetFallbackExecutions();
}

console.log('Non-Tasks fallback detaches quickly, survives connector aborts, replays safely, persists sanitized state, recovers restarts, and supports explicit cancellation.');
