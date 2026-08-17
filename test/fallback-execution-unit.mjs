import assert from 'node:assert/strict';
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY
} from '@modelcontextprotocol/server';

import {
  fallbackExecutionStatus,
  resetFallbackExecutions
} from '../src/mcp/fallbackExecutions.js';
import { MCP_PROTOCOL_VERSION } from '../src/mcp/protocol.js';
import { toolResult } from '../src/mcp/results.js';
import { handleTransportTaskRequest } from '../src/mcp/transportTasks.js';

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
assert.equal(completed.result.exitCode, 0);
assert.equal(completed.result.stdout, 'slow complete');
assert.equal(executionCount, 1, 'request cancellation must not abort or restart detached fallback work');

resetFallbackExecutions();
console.log('Non-Tasks long-call fallback survives connector aborts, deduplicates retries, and preserves fast one-shot calls.');
