import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveWorkspace } from './config.js';
import { runProcess } from './process.js';
import { gitStatusArgs, parseGitStatus } from './repo/gitStatus.js';
import { readJsonFile, writeJsonAtomic } from './durableState.js';
import { getStateDir } from './statePaths.js';
import { OPERATION_IDS as OP } from './tools/operationIds.js';

const STORE_VERSION = 1;
const LOCK_STALE_MS = 30_000;
const INTEGRITY_CACHE_RECHECK_MS = 250;
const AMBIENT_OWNER = '@ambient';
const integrityCache = new Map();
const CODE_MUTATING_TOOLS = new Set([
  OP.EDIT,
  OP.CHANGES_TIDY_RUN,
  OP.CHANGES_RESTORE,
  OP.CHANGES_RESET
]);
const REPOSITORY_RECONCILE_TOOLS = new Set([
  OP.VALIDATE_CHECKS,
  OP.PUBLISH_COMMIT,
  OP.WORK_FINISH,
  OP.WORK_CANCEL
]);

class TaskIntegrityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'TaskIntegrityError';
    this.code = code;
    this.retryable = code === 'TASK_INTEGRITY_PERSISTENCE_FAILED';
  }
}

async function recordTaskIntegrityEvent(config, event = {}) {
  const taskId = clean(event.taskId);
  const workspaceAlias = clean(event.workspace);
  if (!taskId || !workspaceAlias || Number(event.taskIdentityVersion || 0) < 2) return null;

  try {
    if (!integrityEventRequiresPersistence(event)) return readIntegrityProjection(config, taskId, workspaceAlias);
    const workspace = resolveWorkspace(config, workspaceAlias);
    const repository = await repositoryStateForEvent(workspace, config, event);
    return withIntegrityLock(config, () => {
      let authority = readJson(taskFile(config, taskId));
      if (!authority) {
        if (clean(event.tool) !== OP.WORK_BEGIN) {
          throw new TaskIntegrityError(
            'TASK_INTEGRITY_STATE_MISSING',
            `Authoritative integrity state is missing for logical task '${taskId}'. Start a new logical task rather than reconstructing safety state from audit history.`
          );
        }
        authority = createAuthority(taskId, workspace, event, repository.baseline);
      }
      const ownedWorkspace = resolveWorkspace(config, authority.workspace || workspaceAlias);
      const workspaceState = readJson(workspaceFile(config, ownedWorkspace.alias)) || createWorkspaceState(ownedWorkspace.alias);
      const projection = applyIntegrityEvent(authority, workspaceState, ownedWorkspace, event, repository.changedFiles);
      writeJson(taskFile(config, taskId), authority);
      writeJson(workspaceFile(config, ownedWorkspace.alias), workspaceState);
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

function taskCommitOwnership(config, taskId, workspaceAlias = '') {
  const authority = readTaskIntegrity(config, taskId, workspaceAlias);
  if (!authority) return { ownedFiles: [], conflictingFiles: [] };
  const workspace = readWorkspaceIntegrity(config, authority.workspace);
  const ownedFiles = [];
  const conflictingFiles = [];
  for (const [file, owners] of Object.entries(workspace.uncommittedOwners || {})) {
    if (!owners.includes(taskId)) continue;
    ownedFiles.push(file);
    if (owners.some(owner => owner !== taskId)) conflictingFiles.push(file);
  }
  return {
    ownedFiles: unique(ownedFiles).sort(),
    conflictingFiles: unique(conflictingFiles).sort()
  };
}

function claimTaskChangedFiles(config, taskId, workspaceAlias, changedFiles = []) {
  const owner = clean(taskId);
  const workspace = clean(workspaceAlias);
  const files = exactPaths(changedFiles);
  if (!owner || !workspace || !files.length) return { ownedFiles: [], conflictingFiles: [] };
  return withIntegrityLock(config, () => {
    const authority = readJson(taskFile(config, owner));
    if (!authority || authority.workspace !== workspace) {
      return { ownedFiles: [], conflictingFiles: [] };
    }
    const workspaceState = normalizeWorkspaceState(readJson(workspaceFile(config, workspace)) || createWorkspaceState(workspace));
    for (const file of files) addWorkspaceOwner(workspaceState, file, owner);
    writeJson(workspaceFile(config, workspace), workspaceState);
    return taskCommitOwnershipFromState(workspaceState, owner);
  });
}

function releaseTaskChangedFiles(config, taskId, workspaceAlias, changedFiles = []) {
  const owner = clean(taskId);
  const workspace = clean(workspaceAlias);
  const files = exactPaths(changedFiles);
  if (!owner || !workspace || !files.length) return { ownedFiles: [], conflictingFiles: [] };
  return withIntegrityLock(config, () => {
    const workspaceState = normalizeWorkspaceState(readJson(workspaceFile(config, workspace)) || createWorkspaceState(workspace));
    for (const file of files) removeWorkspaceOwner(workspaceState, file, owner);
    writeJson(workspaceFile(config, workspace), workspaceState);
    return taskCommitOwnershipFromState(workspaceState, owner);
  });
}

function readWorkspaceIntegrity(config, workspaceAlias) {
  try {
    return normalizeWorkspaceState(readJson(workspaceFile(config, workspaceAlias)) || createWorkspaceState(workspaceAlias));
  } catch (error) {
    if (error instanceof TaskIntegrityError) throw error;
    throw new TaskIntegrityError('TASK_INTEGRITY_STATE_INVALID', `Workspace integrity state is unreadable for '${workspaceAlias}'.`, { cause: error });
  }
}

function applyIntegrityEvent(authority, workspaceState, workspace, event, repositoryChanged = null) {
  const tool = clean(event.tool);
  const timestamp = clean(event.ts) || new Date().toISOString();
  const changedFiles = exactChangedFiles(event);
  const mutation = eventMutatedCode(event) && (event.ok !== false || changedFiles.length > 0);
  normalizeWorkspaceState(workspaceState);
  if (Array.isArray(repositoryChanged)) reconcileWorkspaceOwners(workspaceState, repositoryChanged);
  if (tool === OP.WORK_BEGIN && Array.isArray(repositoryChanged)) {
    for (const file of exactPaths(repositoryChanged)) {
      if (!workspaceState.uncommittedOwners[file]?.length) addWorkspaceOwner(workspaceState, file, AMBIENT_OWNER);
    }
  }

  authority.updatedAt = timestamp;
  authority.workspace = workspace.alias;
  authority.workspacePath = workspace.path;

  if (mutation) {
    authority.mutationGeneration += 1;
    authority.taskOwnedChangedFiles = unique([...authority.taskOwnedChangedFiles, ...changedFiles]);
    for (const file of changedFiles) addWorkspaceOwner(workspaceState, file, authority.taskId);
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

  if (tool === OP.VALIDATE_CHECKS || (tool === OP.EDIT && clean(event.validationStatus))) {
    applyValidationState(authority, workspaceState, event, timestamp);
  }

  if (event.completionKnown === true || tool === OP.WORK_FINISH && event.ok !== false) {
    authority.finalCompletionGeneration = authority.mutationGeneration;
    authority.completedAt = timestamp;
  }
  if (tool === OP.WORK_CANCEL && event.ok !== false) authority.cancelledAt = timestamp;
  if (tool === OP.PUBLISH_COMMIT && event.ok !== false) {
    for (const file of exactCommittedFiles(event)) removeWorkspaceOwner(workspaceState, file, authority.taskId);
  }

  if (mutation || REPOSITORY_RECONCILE_TOOLS.has(tool)) {
    authority.ambientChangedFiles = Array.isArray(repositoryChanged) ? repositoryChanged : authority.ambientChangedFiles;
    authority.externalChangedFiles = authority.ambientChangedFiles.filter(file =>
      !authority.baseline.changedFiles.includes(file) && !authority.taskOwnedChangedFiles.includes(file)
    );
  }

  return integrityProjection(authority, workspaceState);
}

function integrityEventRequiresPersistence(event) {
  const tool = clean(event?.tool);
  const changedFiles = exactChangedFiles(event);
  const mutation = eventMutatedCode(event) && (event?.ok !== false || changedFiles.length > 0);
  return tool === OP.WORK_BEGIN
    || mutation
    || Boolean(clean(event?.validationStatus))
    || REPOSITORY_RECONCILE_TOOLS.has(tool)
    || event?.completionKnown === true;
}

function readIntegrityProjection(config, taskId, workspaceAlias) {
  const authority = readJson(taskFile(config, taskId));
  if (!authority) {
    throw new TaskIntegrityError(
      'TASK_INTEGRITY_STATE_MISSING',
      `Authoritative integrity state is missing for logical task '${taskId}'. Start a new logical task rather than reconstructing safety state from audit history.`
    );
  }
  const workspace = clean(authority.workspace || workspaceAlias);
  const workspaceState = readJson(workspaceFile(config, workspace)) || createWorkspaceState(workspace);
  return integrityProjection(authority, workspaceState);
}

function integrityProjection(authority, workspaceState) {
  const ownership = taskCommitOwnershipFromState(normalizeWorkspaceState(workspaceState), authority.taskId);
  return {
    taskMutationGeneration: authority.mutationGeneration,
    taskValidatedMutationGeneration: authority.latestValidatedMutationGeneration,
    taskWorkspaceGeneration: workspaceState.generation,
    taskOwnedChangedFiles: authority.taskOwnedChangedFiles,
    taskUncommittedChangedFiles: ownership.ownedFiles,
    taskConflictingChangedFiles: ownership.conflictingFiles,
    externalChangedFiles: authority.externalChangedFiles
  };
}

function applyValidationState(authority, workspaceState, event, timestamp) {
  const validationStatus = clean(event.validationStatus);
  authority.validationResult = validationStatus || (event.ok === false ? 'failed' : 'not_run');
  authority.validationAt = timestamp;
  authority.validationLevel = clean(event.validationLevel);
  authority.validationFingerprint = clean(event.validationFingerprint);
  authority.validationScope = Array.isArray(event.validationScope)
    ? unique(event.validationScope.map(normalizePath).filter(Boolean)).slice(0, 1000)
    : authority.validationScope || [];
  if (authority.validationResult !== 'passed') return;
  authority.hasPassedValidation = true;
  authority.latestPassedValidationAt = timestamp;
  authority.latestValidatedMutationGeneration = authority.mutationGeneration;
  authority.validatedWorkspaceGeneration = workspaceState.generation;
  authority.validatedRepositoryFingerprint = authority.validationFingerprint;
  authority.conflictingExternalMutations = [];
}
function createAuthority(taskId, workspace, event, baseline) {
  if (!baseline) throw new TaskIntegrityError('TASK_INTEGRITY_STATE_INVALID', 'Repository baseline was not captured for task creation.');
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
    validationScope: [],
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
    lastMutation: null,
    uncommittedOwners: {}
  };
}

async function repositoryStateForEvent(workspace, config, event) {
  const tool = clean(event?.tool);
  const needsChangedFiles = tool === OP.WORK_BEGIN
    || REPOSITORY_RECONCILE_TOOLS.has(tool)
    || Boolean(clean(event?.validationStatus));
  if (!needsChangedFiles) return { baseline: null, changedFiles: null };
  const statusResult = await runProcess('git', gitStatusArgs(), {
    cwd: workspace.path,
    timeout: 30_000,
    maxOutputBytes: 8 * 1024 * 1024
  }, config);
  const parsed = statusResult.exitCode === 0 && !statusResult.stdoutTruncated
    ? parseGitStatus(statusResult.stdout || '')
    : { branch: null, unborn: false, entries: [] };
  const changedFiles = unique((parsed.entries || []).map(entry => normalizePath(entry.path)).filter(Boolean)).sort();
  if (tool !== OP.WORK_BEGIN) return { baseline: null, changedFiles };
  const headResult = await runProcess('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: workspace.path,
    timeout: 30_000,
    maxOutputBytes: 1024 * 1024
  }, config);
  const head = headResult.exitCode === 0 && !headResult.stdoutTruncated ? String(headResult.stdout || '').trim() : '';
  return {
    changedFiles,
    baseline: {
      branch: parsed.branch || '',
      head,
      unborn: parsed.unborn === true || Boolean(parsed.branch && !head),
      changedFiles
    }
  };
}

function eventMutatedCode(event) {
  const tool = clean(event.tool);
  if (tool === OP.EXEC) {
    return exactChangedFiles(event).length > 0;
  }
  return CODE_MUTATING_TOOLS.has(tool);
}

function exactChangedFiles(event) {
  return exactPaths(event.changedFiles);
}

function exactCommittedFiles(event) {
  return exactPaths(event.committedFiles);
}

function exactPaths(values) {
  return unique((Array.isArray(values) ? values : [])
    .map(normalizePath)
    .filter(Boolean));
}

function normalizeWorkspaceState(workspaceState) {
  if (!workspaceState || typeof workspaceState !== 'object') return workspaceState;
  if (!workspaceState.uncommittedOwners || typeof workspaceState.uncommittedOwners !== 'object' || Array.isArray(workspaceState.uncommittedOwners)) {
    workspaceState.uncommittedOwners = {};
  }
  for (const [file, owners] of Object.entries(workspaceState.uncommittedOwners)) {
    const normalizedFile = normalizePath(file);
    const normalizedOwners = unique((Array.isArray(owners) ? owners : []).map(clean).filter(Boolean));
    if (!normalizedFile || !normalizedOwners.length) {
      delete workspaceState.uncommittedOwners[file];
      continue;
    }
    if (normalizedFile !== file) delete workspaceState.uncommittedOwners[file];
    workspaceState.uncommittedOwners[normalizedFile] = normalizedOwners;
  }
  return workspaceState;
}

function addWorkspaceOwner(workspaceState, file, owner) {
  const normalizedFile = normalizePath(file);
  const normalizedOwner = clean(owner);
  if (!normalizedFile || !normalizedOwner) return;
  workspaceState.uncommittedOwners[normalizedFile] = unique([
    ...(workspaceState.uncommittedOwners[normalizedFile] || []),
    normalizedOwner
  ]);
}

function removeWorkspaceOwner(workspaceState, file, owner) {
  const normalizedFile = normalizePath(file);
  const normalizedOwner = clean(owner);
  if (!normalizedFile || !normalizedOwner) return;
  const owners = (workspaceState.uncommittedOwners[normalizedFile] || []).filter(value => value !== normalizedOwner);
  if (owners.length) workspaceState.uncommittedOwners[normalizedFile] = owners;
  else delete workspaceState.uncommittedOwners[normalizedFile];
}

function reconcileWorkspaceOwners(workspaceState, repositoryChanged) {
  const dirty = new Set(exactPaths(repositoryChanged));
  for (const file of Object.keys(workspaceState.uncommittedOwners)) {
    if (!dirty.has(file)) delete workspaceState.uncommittedOwners[file];
  }
}

function taskCommitOwnershipFromState(workspaceState, taskId) {
  const owner = clean(taskId);
  const ownedFiles = [];
  const conflictingFiles = [];
  for (const [file, owners] of Object.entries(workspaceState?.uncommittedOwners || {})) {
    if (!owners.includes(owner)) continue;
    ownedFiles.push(file);
    if (owners.some(value => value !== owner)) conflictingFiles.push(file);
  }
  return { ownedFiles: unique(ownedFiles).sort(), conflictingFiles: unique(conflictingFiles).sort() };
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
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'wx', 0o600);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let stale;
    try { stale = Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS; } catch (statError) {
      if (statError?.code === 'ENOENT') stale = true;
      else throw statError;
    }
    if (!stale) throw new Error('Task integrity state is busy. Retry the operation.', { cause: error });
    try { fs.rmSync(file, { force: true }); } catch {}
    try {
      descriptor = fs.openSync(file, 'wx', 0o600);
    } catch (retryError) {
      if (retryError?.code === 'EEXIST') throw new Error('Task integrity state is busy. Retry the operation.', { cause: retryError });
      throw retryError;
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
  const now = Date.now();
  const cached = integrityCache.get(file);
  if (cached && now - cached.checkedAt < INTEGRITY_CACHE_RECHECK_MS) {
    if (fs.existsSync(file)) return cached.value;
    integrityCache.delete(file);
    return null;
  }
  const identity = fileIdentity(file);
  if (identity && cached?.identity === identity) {
    cached.checkedAt = now;
    return cached.value;
  }
  const value = readJsonFile(file, {
    backup: true,
    validate: item => Boolean(item && typeof item === 'object' && !Array.isArray(item))
  });
  if (value && identity) integrityCache.set(file, { identity, value, checkedAt: now });
  else if (!value) integrityCache.delete(file);
  return value;
}

function writeJson(file, value) {
  writeJsonAtomic(file, value, { mode: 0o600, backup: true });
  const identity = fileIdentity(file);
  if (identity) integrityCache.set(file, { identity, value, checkedAt: Date.now() });
}

function fileIdentity(file) {
  try {
    const stat = fs.statSync(file, { bigint: true });
    return `${stat.mtimeNs}:${stat.size}`;
  } catch {
    return '';
  }
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
  taskCommitOwnership,
  claimTaskChangedFiles,
  releaseTaskChangedFiles,
  readWorkspaceIntegrity,
  recordTaskIntegrityEvent
};
