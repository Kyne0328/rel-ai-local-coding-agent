import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY
} from '@modelcontextprotocol/server';

import {
  createNativeTask,
  requestNativeTaskInput
} from '../src/mcp/nativeTaskService.js';
import {
  INVALID_TASKS_CAPABILITY_CODE,
  MCP_PROTOCOL_VERSION,
  MISSING_TASKS_CAPABILITY_CODE
} from '../src/mcp/protocol.js';
import { handleTransportTaskRequest } from '../src/mcp/transportTasks.js';

const extensionId = 'io.modelcontextprotocol/tasks';
const tasksCapability = { extensions: { [extensionId]: {} } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-native-task-protocol-'));
const config = { stateDir: root };
let resumeCount = 0;
let resumedWith = null;

function message(id, method, params = {}, capabilities = tasksCapability) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: MCP_PROTOCOL_VERSION,
        [CLIENT_CAPABILITIES_META_KEY]: capabilities
      }
    }
  };
}

function handle(targetConfig, request, principal = 'principal-a') {
  return handleTransportTaskRequest(targetConfig, request, {
    principal,
    transportType: 'test'
  });
}

try {
  const created = createNativeTask(config, {
    principal: 'principal-a',
    method: 'tools/call',
    name: 'input-round-trip-test',
    executor: {
      resume(inputResponses) {
        resumeCount += 1;
        resumedWith = inputResponses;
      }
    }
  });
  requestNativeTaskInput(config, created.taskId, {
    approval: { mode: 'elicitation', message: 'Approve?' },
    note: { mode: 'elicitation', message: 'Add a note.' }
  }, { principal: 'principal-a' });

  const waiting = await handle(config, message(1, 'tasks/get', { taskId: created.taskId }));
  assert.equal(waiting.body.result.status, 'input_required');
  assert.ok(waiting.body.result._meta?.[SERVER_INFO_META_KEY]);
  assert.deepEqual(Object.keys(waiting.body.result.inputRequests).sort(), ['approval', 'note']);

  const partial = await handle(config, message(2, 'tasks/update', {
    taskId: created.taskId,
    inputResponses: {
      approval: { approved: true },
      unknown: { ignored: true }
    }
  }));
  assert.equal(partial.body.result.resultType, 'complete');
  assert.ok(partial.body.result._meta?.[SERVER_INFO_META_KEY]);
  const afterPartial = await handle(config, message(3, 'tasks/get', { taskId: created.taskId }));
  assert.equal(afterPartial.body.result.status, 'input_required');
  assert.deepEqual(Object.keys(afterPartial.body.result.inputRequests), ['note']);
  assert.equal(resumeCount, 0);

  const fulfilled = await handle(config, message(4, 'tasks/update', {
    taskId: created.taskId,
    inputResponses: { note: { text: 'Proceed.' } }
  }));
  assert.equal(fulfilled.body.result.resultType, 'complete');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumeCount, 1);
  assert.deepEqual(resumedWith, {
    approval: { approved: true },
    note: { text: 'Proceed.' }
  });

  const replay = await handle(config, message(5, 'tasks/update', {
    taskId: created.taskId,
    inputResponses: { note: { text: 'Replay.' } }
  }));
  assert.equal(replay.body.error, undefined);
  assert.equal(replay.body.result.resultType, 'complete');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumeCount, 1, 'already satisfied input must not resume the executor twice');

  const missingCapability = await handle(
    config,
    message(6, 'tasks/get', { taskId: created.taskId }, {})
  );
  assert.equal(missingCapability.body.error.code, MISSING_TASKS_CAPABILITY_CODE);
  assert.deepEqual(
    missingCapability.body.error.data.requiredCapabilities.extensions[extensionId],
    {}
  );

  const malformedCapability = await handle(
    config,
    message(7, 'tasks/get', { taskId: created.taskId }, { extensions: [] })
  );
  assert.equal(malformedCapability.body.error.code, INVALID_TASKS_CAPABILITY_CODE);
  assert.deepEqual(malformedCapability.body.error.data, {
    reason: 'invalid_client_capabilities',
    capabilityReason: 'malformed_extensions',
    expectedCapabilities: tasksCapability
  });

  const wrongPrincipal = await handle(
    config,
    message(8, 'tasks/get', { taskId: created.taskId }),
    'principal-b'
  );
  const unknownTask = await handle(
    config,
    message(9, 'tasks/get', { taskId: 'task_invalid' })
  );
  assert.equal(wrongPrincipal.body.error.code, -32602);
  assert.equal(unknownTask.body.error.code, -32602);
  assert.equal(wrongPrincipal.body.error.message, unknownTask.body.error.message);

  const malformedInput = await handle(config, message(10, 'tasks/update', {
    taskId: created.taskId,
    inputResponses: []
  }));
  assert.equal(malformedInput.body.error.code, -32602);
  assert.match(malformedInput.body.error.message, /input map must be an object/i);

  const emptyInput = await handle(config, message(11, 'tasks/update', {
    taskId: created.taskId,
    inputResponses: {}
  }));
  assert.equal(emptyInput.body.error.code, -32602);
  assert.match(emptyInput.body.error.message, /at least one response/i);

  const unknownOnly = createNativeTask(config, {
    principal: 'principal-a',
    method: 'tools/call',
    name: 'unknown-input-test',
    executor: { controller: new AbortController() }
  });
  requestNativeTaskInput(config, unknownOnly.taskId, {
    approval: { mode: 'elicitation', message: 'Approve?' }
  }, { principal: 'principal-a' });
  const unmatchedInput = await handle(config, message(12, 'tasks/update', {
    taskId: unknownOnly.taskId,
    inputResponses: { unknown: true }
  }));
  assert.equal(unmatchedInput.body.error, undefined);
  assert.equal(unmatchedInput.body.result.resultType, 'complete');
  const unknownOnlyState = await handle(config, message(13, 'tasks/get', { taskId: unknownOnly.taskId }));
  assert.equal(unknownOnlyState.body.result.status, 'input_required');

  const notification = message(undefined, 'tasks/get', { taskId: unknownOnly.taskId });
  delete notification.id;
  const notificationResult = await handle(config, notification);
  assert.equal(notificationResult.status, 204);
  assert.equal(notificationResult.body, null);

  const corrupt = createNativeTask(config, {
    principal: 'principal-a',
    method: 'tools/call',
    name: 'protocol-corruption-test',
    restartPolicy: 'restart_reconcilable',
    recovery: { mode: 'deadline', completeAtMs: Date.now() + 60_000, result: { ok: true } }
  });
  const corruptFile = path.join(root, 'native-tasks', `${corrupt.taskId}.json`);
  fs.writeFileSync(corruptFile, '{corrupt', 'utf8');
  const corruptResponse = await handle(config, message(14, 'tasks/get', { taskId: corrupt.taskId }));
  assert.equal(corruptResponse.body.error.code, -32603);
  assert.equal(corruptResponse.body.error.message, 'Native task record is corrupt.');
  assert.deepEqual(corruptResponse.body.error.data, {
    reason: 'task_record_corrupt',
    retryable: false
  });
  assert.doesNotMatch(JSON.stringify(corruptResponse), /[A-Za-z]:\\|\/Users\/|\/home\//);
  assert.equal(fs.existsSync(corruptFile), false);

  const blockedState = path.join(root, 'blocked-state');
  fs.writeFileSync(blockedState, 'not a directory', 'utf8');
  const storageFailure = await handle(
    { stateDir: blockedState },
    message(15, 'tasks/get', { taskId: `task_${'A'.repeat(43)}` })
  );
  assert.equal(storageFailure.body.error.code, -32603);
  assert.equal(storageFailure.body.error.message, 'Native task storage is unavailable.');
  assert.equal(storageFailure.body.error.data.retryable, true);
  assert.doesNotMatch(JSON.stringify(storageFailure), /[A-Za-z]:\\|\/Users\/|\/home\//);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Canonical native task wire routing, input validation, capability gating, corruption handling, and ownership non-disclosure passed.');
