'use strict';

const {
  cancelOperationTask,
  assertOperationTaskLogicalOwner
} = require('../operationTasks');

function getDeferredOperation(config, args = {}, context = {}) {
  const operationTaskId = String(args.operationTaskId || '').trim();
  const task = assertOperationTaskLogicalOwner(config, operationTaskId, context.taskId || args.task_id);
  return { ok: true, operationTask: task };
}

function cancelDeferredOperation(config, args = {}, context = {}) {
  const operationTaskId = String(args.operationTaskId || '').trim();
  assertOperationTaskLogicalOwner(config, operationTaskId, context.taskId || args.task_id);
  const task = cancelOperationTask(config, operationTaskId);
  return { ok: true, operationTask: task };
}

module.exports = { getDeferredOperation, cancelDeferredOperation };
