'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getStateDir } = require('./audit');

const TASK_TTL_MS = 24 * 60 * 60 * 1000;
const tasks = new Map();

function taskDirectory(config) {
  return path.join(getStateDir(config), 'operation-tasks');
}

function taskPath(config, taskId) {
  return path.join(taskDirectory(config), `${validateTaskId(taskId)}.json`);
}

function validateTaskId(taskId) {
  const value = String(taskId || '').trim();
  if (!/^op_[A-Za-z0-9_-]{20,160}$/.test(value)) throw new Error('Invalid operation task id.');
  return value;
}

function createOperationTask(config, options = {}) {
  const taskId = `op_${crypto.randomBytes(24).toString('base64url')}`;
  const now = new Date().toISOString();
  const controller = new AbortController();
  const task = {
    taskId,
    status: 'working',
    method: String(options.method || ''),
    name: String(options.name || ''),
    workspace: String(options.workspace || ''),
    logicalTaskId: String(options.logicalTaskId || ''),
    principal: String(options.principal || ''),
    createdAt: now,
    updatedAt: now,
    progress: 0,
    message: String(options.message || 'Operation started.'),
    result: null,
    error: '',
    cancelRequested: false,
    controller
  };
  tasks.set(taskId, task);
  persistTask(config, task);
  return publicTask(task);
}

function updateOperationTask(config, taskId, patch = {}) {
  const task = requireTask(config, taskId);
  if (isTerminal(task.status)) return publicTask(task);
  if (patch.status) task.status = normalizeStatus(patch.status);
  if (patch.progress != null) task.progress = Math.min(1, Math.max(0, Number(patch.progress) || 0));
  if (patch.message != null) task.message = String(patch.message).slice(0, 2000);
  if (Object.hasOwn(patch, 'result')) task.result = patch.result;
  if (patch.error != null) task.error = String(patch.error).slice(0, 4000);
  task.updatedAt = new Date().toISOString();
  persistTask(config, task);
  return publicTask(task);
}

function completeOperationTask(config, taskId, result) {
  return updateOperationTask(config, taskId, { status: 'completed', progress: 1, message: 'Operation completed.', result });
}

function failOperationTask(config, taskId, error) {
  return updateOperationTask(config, taskId, { status: 'failed', message: 'Operation failed.', error: error?.message || error });
}

function cancelOperationTask(config, taskId) {
  const task = requireTask(config, taskId);
  if (isTerminal(task.status)) return publicTask(task);
  task.cancelRequested = true;
  task.controller?.abort(new Error('Operation cancelled by client.'));
  task.status = 'cancelled';
  task.message = 'Operation cancelled.';
  task.updatedAt = new Date().toISOString();
  persistTask(config, task);
  return publicTask(task);
}

function getOperationTask(config, taskId) {
  return publicTask(requireTask(config, taskId));
}

function operationTaskSignal(config, taskId) {
  return requireTask(config, taskId).controller?.signal;
}

function assertOperationTaskPrincipal(config, taskId, principal) {
  const task = requireTask(config, taskId);
  const expected = String(task.principal || '');
  const actual = String(principal || '');
  if (expected && expected !== actual) throw new Error('Task does not belong to this authorization context.');
  return publicTask(task);
}

function assertOperationTaskLogicalOwner(config, taskId, logicalTaskId) {
  const task = requireTask(config, taskId);
  const expected = String(task.logicalTaskId || '');
  const actual = String(logicalTaskId || '');
  if (expected && expected !== actual) throw new Error('Operation task belongs to a different logical task.');
  return publicTask(task);
}

function requireTask(config, taskId) {
  const id = validateTaskId(taskId);
  const memory = tasks.get(id);
  if (memory) return memory;
  const disk = readTask(config, id);
  if (!disk) throw new Error(`Unknown operation task: ${id}`);
  const task = { ...disk, controller: new AbortController() };
  tasks.set(id, task);
  return task;
}

function readTask(config, taskId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(taskPath(config, taskId), 'utf8'));
    if (Date.now() - Date.parse(parsed.updatedAt || parsed.createdAt || 0) > TASK_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistTask(config, task) {
  fs.mkdirSync(taskDirectory(config), { recursive: true, mode: 0o700 });
  const payload = { ...publicTask(task), logicalTaskId: task.logicalTaskId, principal: task.principal };
  fs.writeFileSync(taskPath(config, task.taskId), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

function publicTask(task) {
  return {
    taskId: task.taskId,
    status: task.status,
    method: task.method,
    name: task.name,
    workspace: task.workspace,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    progress: task.progress,
    message: task.message,
    ...(task.result == null ? {} : { result: task.result }),
    ...(task.error ? { error: task.error } : {}),
    cancelRequested: task.cancelRequested === true
  };
}

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (!['working', 'input_required', 'completed', 'failed', 'cancelled'].includes(status)) throw new Error(`Invalid operation task status: ${status}`);
  return status;
}

function isTerminal(status) {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

function pruneOperationTasks(config) {
  const directory = taskDirectory(config);
  if (!fs.existsSync(directory)) return { removed: 0 };
  let removed = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(directory, entry.name);
    try {
      const stat = fs.statSync(file);
      if (Date.now() - stat.mtimeMs > TASK_TTL_MS) {
        fs.rmSync(file, { force: true });
        tasks.delete(entry.name.slice(0, -5));
        removed += 1;
      }
    } catch {}
  }
  return { removed };
}

module.exports = {
  createOperationTask,
  updateOperationTask,
  completeOperationTask,
  failOperationTask,
  cancelOperationTask,
  getOperationTask,
  operationTaskSignal,
  assertOperationTaskPrincipal,
  assertOperationTaskLogicalOwner,
  pruneOperationTasks
};
