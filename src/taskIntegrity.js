import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveWorkspace } from './config.js';
import { readJsonFile, writeJsonAtomic } from './durableState.js';
import { getStateDir } from './statePaths.js';

const STORE_VERSION = 1;
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_WAIT_MS = 10;
const lockSleeper = new Int32Array(new SharedArrayBuffer(4));
const CODE_MUTATING_TOOLS = new Set([
  'relai_edit',
  'relai_tidy_run',
  'relai_restore_paths',
  'relai_reset_workspace'
]);

class TaskIntegrityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'TaskIntegrityError';
    this.code = code;
    this.retryable = code === 'TASK_INTEGRITY_PERSISTENCE_FAILED';
  }
}

function recordTaskIntegrityEvent(config, event = {}) {
  const taskId = clean(event.taskId);
  const workspaceAlias = clean(event.workspace);
  if (!taskId || !workspaceAlias || Number(event.taskIdentityVersion || 0) < 2) return null;

  try {
    return withIntegrityLock(config, () => {
      let authority = readJson(taskFile(config, taskId));
      if (!authority) {
        if (clean(event.tool) !== 'relai_begin_work') {
          throw new TaskIntegrityError(
            'TASK_INTEGRITY_STATE_MISSING',
            `Authoritative integrity state is missing for logical task '${taskId}'. Start a new logical task rather than reconstructing safety state from audit history.`
          );
        }
        const workspace = resolveWorkspace(config, workspaceAlias);
        authority = createAuthority(taskId, workspace, event);
      }
      const workspace = resolveWorkspace(config, authority.workspace || workspaceAlias);
      const workspaceState = readJson(workspaceFile(config, workspace.alias)) || createWorkspaceState(workspace.alias);
      const projection = applyIntegrityEvent(authority, workspaceState, workspace, event);
      writeJson(taskFile(config, taskId), authority);
      writeJson(workspaceFile(config, workspace.alias), workspaceState);
      return projection;
    });
  } catch (error) {
    if (error instanceof TaskIntegrityError) throw error;
    throw new TaskIntegrityError(
      'TASK_INTEGRITY_PERSISTENCE_FAILED',
      `Authoritative integrity state could not be persisted for logical task '${taskId}'.`,
      { cause: error }
    );
  }
}

function readTaskIntegrity(config, taskId, workspaceAlias = '') {
  try {
    const authority = readJson(taskFile(config, taskId));
    if (!authority) return null;
    if (workspaceAlias && authority.workspace !== workspaceAlias) return null;
    return authority;
  } catch (error) {
    if (error instanceof TaskIntegrityError) throw error;
    throw new TaskIntegrityError('TASK_INTEGRITY_STATE_INVALID', `Authoritative integrity state is unreadable for logical task '${taskId}'.`, { cause: error });
  }
}

function taskOwnedChangedFiles(config, taskId, workspaceAlias = '') {
  const authority = readTaskIntegrity(config, taskId, workspaceAlias);
  return Array.isArray(authority?.taskOwnedChangedFiles) ? [...authority.taskOwnedChangedFiles] : [];
}
function readWorkspaceIntegrity(config, workspaceAlias) {
  try {
    return readJson(workspaceFile(config, workspaceAlias)) || createWorkspaceState(workspaceAlias);
  } catch (error) {
    if (error instanceof TaskIntegrityError) throw error;
    throw new TaskIntegrityError('TASK_INTEGRITY_STATE_INVALID', `Workspace integrity state is unreadable for '${workspaceAlias}'.`, { cause: error });
  }
}

function applyIntegrityEvent(authority, workspaceState, workspace, event) {
  const tool = clean(event.tool);
  const timestamp = clean(event.ts) || new Date().toISOString();
  const changedFiles = exactChangedFiles(event);
  const mutation = eventMutatedCode(event) && (event.ok !== false || changedFiles.length > 0);

  authority.updatedAt = timestamp;
  authority.workspace = workspace.alias;
  authority.workspacePath = workspace.path;

  if (mutation) {
    authority.mutationGeneration += 1;
    authority.taskOwnedChangedFiles = unique([...authority.taskOwnedChangedFiles, ...changedFiles]);
    authority.lastMutationAt = timestamp;
    authority.lastMutationTool = tool;
    authority.validationResult = authority.validationResult === 'passed' ? 'stale' : authority.validationResult;
    authority.validatedRepositoryFingerprint = '';
    workspaceState.generation += 1;
    workspaceState.updatedAt = timestamp;
    workspaceState.lastMutation = {
      taskId: authority.taskId,
      generation: workspaceState.generation,
      changedFiles,
      tool,
      at: timestamp
    };
  }

  if (tool === 'relai_run_checks' || (tool === 'relai_edit' && clean(event.validationStatus))) {
    applyValidationState(authority, workspaceState, event, timestamp);
  }

  if (event.completionKnown === true || tool === 'relai_finish_work' && event.ok !== false) {
    authority.finalCompletionGeneration = authority.mutationGeneration;
    authority.completedAt = timestamp;
  }
  if (tool === 'relai_cancel_work' && event.ok !== false) authority.cancelledAt = timestamp;

  authority.ambientChangedFiles = repositoryChangedFiles(workspace.path);
  authority.externalChangedFiles = authority.ambientChangedFiles.filter(file =>
    !authority.baseline.changedFiles.includes(file) && !authority.taskOwnedChangedFiles.includes(file)
  );

  return {
    taskMutationGeneration: authority.mutationGeneration,
    taskValidatedMutationGeneration: authority.latestValidatedMutationGeneration,
    taskWorkspaceGeneration: workspaceState.generation,
    taskOwnedChangedFiles: authority.taskOwnedChangedFiles,
    externalChangedFiles: authority.externalChangedFiles
  };
}

function applyValidationState(authority, workspaceState, event, timestamp) {
  const validationStatus = clean(event.validationStatus);
  authority.validationResult = validationStatus || (event.ok === false ? 'failed' : 'not_run');
  authority.validationAt = timestamp;
  authority.validationLevel = clean(event.validationLevel);
  authority.validationFingerprint = clean(event.validationFingerprint);
  if (authority.validationResult !== 'passed') return;
  authority.hasPassedValidation = true;
  authority.latestPassedValidationAt = timestamp;
  authority.latestValidatedMutationGeneration = authority.mutationGeneration;
  authority.validatedWorkspaceGeneration = workspaceState.generation;
  authority.validatedRepositoryFingerprint = authority.validationFingerprint;
  authority.conflictingExternalMutations = [];
}
function createAuthority(taskId, workspace, event) {
  const baseline = repositoryBaseline(workspace.path);
  const timestamp = clean(event.ts) || new Date().toISOString();
  return {
    version: STORE_VERSION,
    taskId,
    workspace: workspace.alias,
    workspacePath: workspace.path,
    createdAt: timestamp,
    updatedAt: timestamp,
    baseline,
    taskOwnedChangedFiles: [],
    ambientChangedFiles: baseline.changedFiles,
    externalChangedFiles: [],
    mutationGeneration: 0,
    latestValidatedMutationGeneration: 0,
    validatedWorkspaceGeneration: 0,
    validationResult: 'not_run',
    hasPassedValidation: false,
    latestPassedValidationAt: '',
    validationAt: '',
    validationLevel: '',
    validationFingerprint: '',
    validatedRepositoryFingerprint: '',
    conflictingExternalMutations: [],
    finalCompletionGeneration: null,
    completedAt: '',
    cancelledAt: '',
    lastMutationAt: '',
    lastMutationTool: ''
  };
}

function createWorkspaceState(workspace) {
  return {
    version: STORE_VERSION,
    workspace: clean(workspace),
    generation: 0,
    updatedAt: '',
    lastMutation: null
  };
}

function repositoryBaseline(root) {
  return {
    branch: gitText(root, ['branch', '--show-current']),
    head: gitText(root, ['rev-parse', 'HEAD']),
    changedFiles: repositoryChangedFiles(root)
  };
}

function repositoryChangedFiles(root) {
  const text = gitText(root, ['status', '--porcelain=v1', '-z'], false);
  if (!text) return [];
  const files = [];
  const parts = text.split('\0').filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const item = parts[index];
    const status = item.slice(0, 2);
    let file = item.slice(3);
    if (status.includes('R') || status.includes('C')) file = parts[++index] || file;
    if (file) files.push(normalizePath(file));
  }
  return unique(files).sort();
}

function gitText(root, args, trim = true) {
  try {
    const output = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 8 * 1024 * 1024
    });
    return trim ? output.trim() : output;
  } catch {
    return '';
  }
}

function eventMutatedCode(event) {
  const tool = clean(event.tool);
  if (tool === 'relai_exec') {
    return exactChangedFiles(event).length > 0;
  }
  return CODE_MUTATING_TOOLS.has(tool);
}

function exactChangedFiles(event) {
  return unique((Array.isArray(event.changedFiles) ? event.changedFiles : [])
    .map(normalizePath)
    .filter(Boolean));
}

function integrityDir(config) {
  return path.join(getStateDir(config), 'task-integrity');
}

function taskFile(config, taskId) {
  return path.join(integrityDir(config), 'tasks', `${digest(taskId)}.json`);
}

function workspaceFile(config, workspaceAlias) {
  return path.join(integrityDir(config), 'workspaces', `${digest(workspaceAlias)}.json`);
}

function lockFile(config) {
  return path.join(integrityDir(config), '.lock');
}

function withIntegrityLock(config, callback) {
  fs.mkdirSync(integrityDir(config), { recursive: true, mode: 0o700 });
  const file = lockFile(config);
  const started = Date.now();
  let descriptor;
  while (descriptor == null) {
    try {
      descriptor = fs.openSync(file, 'wx', 0o600);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(file, { force: true });
          continue;
        }
      } catch {}
      if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error('Task integrity state is busy. Retry the operation.', { cause: error });
      Atomics.wait(lockSleeper, 0, 0, LOCK_WAIT_MS);
    }
  }
  try {
    return callback();
  } finally {
    try { fs.closeSync(descriptor); } catch {}
    try { fs.rmSync(file, { force: true }); } catch {}
  }
}

function readJson(file) {
  return readJsonFile(file, {
    backup: true,
    validate: value => Boolean(value && typeof value === 'object' && !Array.isArray(value))
  });
}

function writeJson(file, value) {
  writeJsonAtomic(file, value, { mode: 0o600, backup: true });
}

function digest(value) {
  return crypto.createHash('sha256').update(clean(value)).digest('hex');
}

function normalizePath(value) {
  return clean(value).replaceAll('\\', '/').replace(/^\.\//, '');
}

function clean(value) {
  return String(value || '').trim();
}

function unique(values) {
  return [...new Set(values)];
}

export {



  readTaskIntegrity,
  taskOwnedChangedFiles,
  readWorkspaceIntegrity,
  recordTaskIntegrityEvent
};
