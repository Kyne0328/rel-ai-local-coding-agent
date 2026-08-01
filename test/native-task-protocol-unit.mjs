import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';

import {
  createNativeTask,
  requestNativeTaskInput
} from '../src/mcp/nativeTaskService.js';
import { handleNativeTasksRequest } from '../src/nativeTasksProbe.js';

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
      _meta: { [CLIENT_CAPABILITIES_META_KEY]: capabilities }
    }
  };
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

  const waiting = handleNativeTasksRequest(
    config,
    message(1, 'tasks/get', { taskId: created.taskId }),
    'principal-a'
  );
  assert.equal(waiting.body.result.status, 'input_required');
  assert.deepEqual(Object.keys(waiting.body.result.inputRequests).sort(), ['approval', 'note']);

  const partial = handleNativeTasksRequest(
    config,
    message(2, 'tasks/update', {
      taskId: created.taskId,
      inputResponses: {
        approval: { approved: true },
        unknown: { ignored: true }
      }
    }),
    'principal-a'
  );
  assert.deepEqual(partial.body.result, { resultType: 'complete' });
  const afterPartial = handleNativeTasksRequest(
    config,
    message(3, 'tasks/get', { taskId: created.taskId }),
    'principal-a'
  );
  assert.equal(afterPartial.body.result.status, 'input_required');
  assert.deepEqual(Object.keys(afterPartial.body.result.inputRequests), ['note']);
  assert.equal(resumeCount, 0);

  const fulfilled = handleNativeTasksRequest(
    config,
    message(4, 'tasks/update', {
      taskId: created.taskId,
      inputResponses: { note: { text: 'Proceed.' } }
    }),
    'principal-a'
  );
  assert.deepEqual(fulfilled.body.result, { resultType: 'complete' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumeCount, 1);
  assert.deepEqual(resumedWith, {
    approval: { approved: true },
    note: { text: 'Proceed.' }
  });

  handleNativeTasksRequest(
    config,
    message(5, 'tasks/update', {
      taskId: created.taskId,
      inputResponses: { note: { text: 'Replay.' } }
    }),
    'principal-a'
  );
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumeCount, 1, 'already satisfied input must not resume the executor twice');

  const missingCapability = handleNativeTasksRequest(
    config,
    message(6, 'tasks/get', { taskId: created.taskId }, {}),
    'principal-a'
  );
  assert.equal(missingCapability.body.error.code, -32003);
  assert.deepEqual(
    missingCapability.body.error.data.requiredCapabilities.extensions[extensionId],
    {}
  );

  const wrongPrincipal = handleNativeTasksRequest(
    config,
    message(7, 'tasks/get', { taskId: created.taskId }),
    'principal-b'
  );
  const unknownTask = handleNativeTasksRequest(
    config,
    message(8, 'tasks/get', { taskId: 'task_invalid' }),
    'principal-a'
  );
  assert.equal(wrongPrincipal.body.error.code, -32602);
  assert.equal(unknownTask.body.error.code, -32602);
  assert.equal(wrongPrincipal.body.error.message, unknownTask.body.error.message);

  const malformedInput = handleNativeTasksRequest(
    config,
    message(9, 'tasks/update', { taskId: created.taskId, inputResponses: [] }),
    'principal-a'
  );
  assert.equal(malformedInput.body.error.code, -32602);
  assert.match(malformedInput.body.error.message, /input map must be an object/i);

  const corrupt = createNativeTask(config, {
    principal: 'principal-a',
    method: 'tools/call',
    name: 'protocol-corruption-test',
    restartPolicy: 'restart_reconcilable',
    recovery: { mode: 'deadline', completeAtMs: Date.now() + 60_000, result: { ok: true } }
  });
  const corruptFile = path.join(root, 'native-tasks', `${corrupt.taskId}.json`);
  fs.writeFileSync(corruptFile, '{corrupt', 'utf8');
  const corruptResponse = handleNativeTasksRequest(
    config,
    message(10, 'tasks/get', { taskId: corrupt.taskId }),
    'principal-a'
  );
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
  const storageFailure = handleNativeTasksRequest(
    { stateDir: blockedState },
    message(11, 'tools/call', {
      name: 'relai_native_tasks_probe',
      arguments: { durationMs: 1000, label: 'Storage failure test' }
    }),
    'principal-a'
  );
  assert.equal(storageFailure.body.error.code, -32603);
  assert.equal(storageFailure.body.error.message, 'Native task storage is unavailable.');
  assert.deepEqual(storageFailure.body.error.data, {
    reason: 'task_store_unavailable',
    retryable: true
  });
  assert.doesNotMatch(JSON.stringify(storageFailure), /[A-Za-z]:\\|\/Users\/|\/home\//);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Native task wire input updates, replay prevention, capability gating, and ownership non-disclosure passed.');
