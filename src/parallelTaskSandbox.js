import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { readJsonFile, writeJsonAtomic } from './durableState.js';
import { clearSessionPolicy } from './policyResolver.js';
import { runProcess } from './process.js';
import { REUSABLE_DEPENDENCY_ROOTS, isReusableDependencyPath } from './reusableDependencies.js';
import { isSecretPath } from './safety.js';
import { getStateDir } from './statePaths.js';
import { taskError } from './toolActivity.js';
import { assertSafeWorkspaceRoot } from './workspaceSafety.js';

const REGISTRY_VERSION = 1;
const CREATE_SANDBOX_OPERATIONS = new Set(['relai_edit', 'relai_exec']);
const SANDBOX_ROUTED_OPERATIONS = new Set([
  'relai_repo_snapshot',
  'relai_read',
  'relai_search',
  'relai_code_inspect',
  'relai_exec',
  'relai_semantic_search',
  'relai_diagnostics_run',
  'relai_run_checks',
  'relai_diff',
  'relai_edit'
]);
const LIVE_PROMOTION_OPERATIONS = new Set(['relai_edit', 'relai_exec']);
const TERMINAL_TASK_STATUSES = new Set(['completed', 'cancelled', 'failed', 'inactive']);

function registryPath(config) {
  return path.join(getStateDir(config), 'parallel-sandboxes', 'index.json');
}

function sandboxRoot(config) {
  return path.join(getStateDir(config), 'parallel-sandboxes', 'repositories');
}

function readSandboxRegistry(config) {
  return readJsonFile(registryPath(config), {
    backup: true,
    mode: 0o600,
    validate: isSandboxRegistry
  }) || { version: REGISTRY_VERSION, sandboxes: {} };
}

function writeSandboxRegistry(config, registry) {
  if (!isSandboxRegistry(registry)) throw new TypeError('Parallel task sandbox registry is invalid.');
  writeJsonAtomic(registryPath(config), registry, { backup: true, mode: 0o600 });
}

function isSandboxRegistry(value) {
  if (!isRecord(value) || !isRecord(value.sandboxes)) return false;
  return Object.entries(value.sandboxes).every(([alias, entry]) => isSandboxEntry(alias, entry));
}

function isSandboxEntry(alias, entry) {
  if (!isRecord(entry) || entry.alias !== alias) return false;
  for (const key of [
    'alias', 'sourceAlias', 'sourcePath', 'path', 'taskId',
    'sourceBranch', 'syncCommit', 'createdAt'
  ]) {
    if (typeof entry[key] !== 'string' || !entry[key]) return false;
  }
  return true;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function taskDigest(taskId) {
  return crypto.createHash('sha256').update(String(taskId || '')).digest('hex').slice(0, 12);
}

function privateAlias(taskId, nonce) {
  return `__relai_sandbox_${taskDigest(taskId)}_${nonce}`;
}

function findTaskSandbox(config, sourceAlias, taskId) {
  const source = String(sourceAlias || '').trim();
  const owner = String(taskId || '').trim();
  if (!source || !owner) return null;
  return Object.values(readSandboxRegistry(config).sandboxes || {}).find(entry =>
    entry.sourceAlias === source && entry.taskId === owner
  ) || null;
}

function resolveTaskSandboxWorkspace(config, alias) {
  const key = String(alias || '').trim();
  if (!key) return null;
  const entry = readSandboxRegistry(config).sandboxes?.[key];
  if (!entry) return null;
  if (!fs.existsSync(entry.path)) {
    throw taskError('TASK_SANDBOX_UNAVAILABLE', 'The private execution sandbox for this task is unavailable. The visible workspace was not changed by this failure.');
  }
  const source = config.workspaces?.[entry.sourceAlias];
  if (!source) {
    throw taskError('TASK_SANDBOX_UNAVAILABLE', `The source workspace '${entry.sourceAlias}' for this private task sandbox is no longer configured.`);
  }
  return {
    alias: entry.alias,
    path: fs.realpathSync(entry.path),
    testCommands: source.testCommands || {},
    commands: source.commands || {},
    repoSlug: source.repoSlug || '',
    context: source.context || {},
    validationRules: source.validationRules || {},
    taskSandbox: true,
    sourceAlias: entry.sourceAlias,
    sourceBranch: entry.sourceBranch
  };
}

function activeWorkspaceTasks(activeTasks, workspaceAlias) {
  return (Array.isArray(activeTasks) ? activeTasks : [])
    .filter(task => {
      const id = String(task?.taskId || task?.id || '').trim();
      const workspace = String(task?.workspace || '').trim();
      const status = String(task?.status || '').trim().toLowerCase();
      return id && workspace === workspaceAlias && !TERMINAL_TASK_STATUSES.has(status);
    })
    .sort((left, right) => Number(left?.startedAt || 0) - Number(right?.startedAt || 0));
}

function shouldCreateSandbox(activeTasks, workspaceAlias, taskId) {
  const tasks = activeWorkspaceTasks(activeTasks, workspaceAlias);
  if (tasks.length < 2) return false;
  const primaryId = String(tasks[0]?.taskId || tasks[0]?.id || '').trim();
  return Boolean(primaryId && primaryId !== taskId);
}

async function prepareTaskExecutionWorkspace(workspace, config, taskId, operationName, options = {}) {
  const owner = String(taskId || '').trim();
  const operation = String(operationName || '').trim();
  if (!owner || !workspace?.alias || workspace.taskSandbox === true || options.forceSource === true) return workspace;

  const existing = findTaskSandbox(config, workspace.alias, owner);
  if (existing) {
    const sourceRevision = await workspaceRevision(workspace, config);
    if (!existing.sourceRevision || existing.sourceRevision !== sourceRevision) {
      await promoteTaskSandbox(workspace, config, owner, { sourceRevision });
    }
    const current = findTaskSandbox(config, workspace.alias, owner);
    return current && SANDBOX_ROUTED_OPERATIONS.has(operation)
      ? resolveTaskSandboxWorkspace(config, current.alias)
      : workspace;
  }
  if (!CREATE_SANDBOX_OPERATIONS.has(operation)) return workspace;
  if (!await currentBranch(workspace.path, config)) return workspace;

  if (!shouldCreateSandbox(options.activeTasks, workspace.alias, owner)) return workspace;
  if (!await isGitWorktree(workspace, config)) return workspace;

  const created = await createTaskSandbox(workspace, config, owner);
  return resolveTaskSandboxWorkspace(config, created.alias);
}

function shouldPromoteTaskSandbox(operationName, result) {
  if (!LIVE_PROMOTION_OPERATIONS.has(String(operationName || ''))) return false;
  return result?.changed === true || (Array.isArray(result?.changedFiles) && result.changedFiles.length > 0);
}

async function isGitWorktree(workspace, config) {
  const result = await runProcess('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: workspace.path,
    timeout: 30000
  }, config);
  return result.exitCode === 0 && String(result.stdout || '').trim() === 'true';
}

async function createTaskSandbox(workspace, config, taskId) {
  const existing = findTaskSandbox(config, workspace.alias, taskId);
  if (existing) return existing;

  const baseline = await workspaceSnapshotCommit(workspace, config);
  const nonce = crypto.randomBytes(4).toString('hex');
  const digest = taskDigest(taskId);
  const alias = privateAlias(taskId, nonce);
  const target = path.join(sandboxRoot(config), workspace.alias, `${digest}-${nonce}`);
  assertSafeWorkspaceRoot(target, 'Parallel task sandbox path');
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });

  const command = await runProcess('git', ['worktree', 'add', '--detach', target, baseline.commit], {
    cwd: workspace.path,
    timeout: 120000
  }, config);
  if (command.exitCode !== 0) {
    throw taskError(
      'TASK_SANDBOX_CREATE_FAILED',
      `Could not create a private parallel task sandbox: ${String(command.stderr || command.stdout || command.exitCode).trim()}`
    );
  }

  const entry = {
    alias,
    sourceAlias: workspace.alias,
    sourcePath: workspace.path,
    path: fs.realpathSync(target),
    taskId,
    sourceBranch: baseline.branch,
    syncCommit: baseline.commit,
    sourceRevision: await workspaceRevision(workspace, config),
    createdAt: new Date().toISOString(),
    promotedFiles: []
  };

  try {
    overlayWorkspaceFileBytes(workspace.path, entry.path, baseline.overlayFiles);
    linkReusableDependencies(workspace.path, entry.path);
    const registry = readSandboxRegistry(config);
    registry.sandboxes[alias] = entry;
    writeSandboxRegistry(config, registry);
    return entry;
  } catch (error) {
    await removeSandboxEntry(entry, config);
    throw taskError(
      'TASK_SANDBOX_CREATE_FAILED',
      `Could not initialize the private parallel task sandbox: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function workspaceSnapshotCommit(workspace, config) {
  const tempRoot = path.join(getStateDir(config), 'parallel-sandboxes', 'tmp');
  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  const tempDir = fs.mkdtempSync(path.join(tempRoot, 'snapshot-'));
  const indexPath = path.join(tempDir, 'index');
  const env = { GIT_INDEX_FILE: indexPath };
  try {
    const headResult = await runProcess('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: workspace.path, timeout: 30000
    }, config);
    const head = headResult.exitCode === 0 ? String(headResult.stdout || '').trim() : '';
    const branchResult = await runProcess('git', ['branch', '--show-current'], {
      cwd: workspace.path, timeout: 30000
    }, config);
    const branch = branchResult.exitCode === 0 ? String(branchResult.stdout || '').trim() : '';
    const initialize = await runProcess('git', head ? ['read-tree', head] : ['read-tree', '--empty'], {
      cwd: workspace.path, timeout: 30000, env
    }, config);
    if (initialize.exitCode !== 0) throw new Error('Could not initialize the task sandbox baseline.');

    const trackedResult = await runProcess('git', ['ls-files', '-z'], {
      cwd: workspace.path, timeout: 30000, maxOutputBytes: 16 * 1024 * 1024
    }, config);
    if (trackedResult.exitCode !== 0 || trackedResult.stdoutTruncated) {
      throw new Error('Could not inspect tracked files for the task sandbox baseline.');
    }
    const trackedFiles = splitNullList(trackedResult.stdout);

    const stageTracked = await runProcess('git', ['add', '-u', '--', '.'], {
      cwd: workspace.path, timeout: 120000, env
    }, config);
    if (stageTracked.exitCode !== 0) throw new Error('Could not snapshot tracked workspace changes for parallel execution.');

    const untrackedResult = await runProcess('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd: workspace.path, timeout: 30000, maxOutputBytes: 16 * 1024 * 1024
    }, config);
    if (untrackedResult.exitCode !== 0 || untrackedResult.stdoutTruncated) {
      throw new Error('Could not inspect untracked workspace files for parallel execution.');
    }
    const untracked = splitNullList(untrackedResult.stdout).filter(item => !isReusableDependencyPath(item));
    const excludedSensitive = untracked.filter(isSecretPath);
    const safeUntracked = untracked.filter(item => !isSecretPath(item));
    for (let index = 0; index < safeUntracked.length; index += 100) {
      const staged = await runProcess('git', ['add', '--', ...safeUntracked.slice(index, index + 100)], {
        cwd: workspace.path, timeout: 120000, env
      }, config);
      if (staged.exitCode !== 0) throw new Error('Could not snapshot untracked workspace files for parallel execution.');
    }

    const treeResult = await runProcess('git', ['write-tree'], {
      cwd: workspace.path, timeout: 30000, env
    }, config);
    if (treeResult.exitCode !== 0) throw new Error('Could not write the task sandbox baseline tree.');
    const tree = String(treeResult.stdout || '').trim();
    const commitResult = await runProcess('git', [
      '-c', 'user.name=Rel.AI',
      '-c', 'user.email=relai@localhost',
      'commit-tree', tree,
      ...(head ? ['-p', head] : []),
      '-m', 'Rel.AI parallel task snapshot'
    ], { cwd: workspace.path, timeout: 30000 }, config);
    if (commitResult.exitCode !== 0) throw new Error('Could not create the task sandbox baseline commit.');
    const commit = String(commitResult.stdout || '').trim();
    if (!commit) throw new Error('Could not create the task sandbox baseline commit.');
    return {
      commit,
      head,
      branch,
      excludedSensitive,
      overlayFiles: [...new Set([...trackedFiles, ...safeUntracked])]
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function promoteTaskSandbox(sourceWorkspace, config, taskId, options = {}) {
  const entry = findTaskSandbox(config, sourceWorkspace.alias, taskId);
  if (!entry) return { promoted: false, changedFiles: [] };
  if (!fs.existsSync(entry.path)) {
    throw taskError('TASK_SANDBOX_UNAVAILABLE', 'The private execution sandbox disappeared before its changes could be promoted. The visible workspace was not modified.');
  }

  await assertPromotionBranches(sourceWorkspace, entry, config);
  const sandboxWorkspace = resolveTaskSandboxWorkspace(config, entry.alias);
  const sandboxSnapshot = await workspaceSnapshotCommit(sandboxWorkspace, config);
  if (sandboxSnapshot.excludedSensitive.length) {
    throw promotionError(
      'TASK_SANDBOX_SENSITIVE_CHANGE',
      `Private task changes include sensitive untracked paths that Rel.AI will not copy automatically: ${sandboxSnapshot.excludedSensitive.slice(0, 5).join(', ')}.`
    );
  }

  const changedFiles = await changedPaths(entry.path, entry.syncCommit, sandboxSnapshot.commit, config);
  if (changedFiles.some(isSecretPath)) {
    throw promotionError('TASK_SANDBOX_SENSITIVE_CHANGE', 'Private task changes include sensitive paths that cannot be live-promoted automatically.');
  }

  let alreadyApplied = false;
  if (changedFiles.length) {
    const patchPath = await writeCommitDiff(config, entry.path, entry.syncCommit, sandboxSnapshot.commit);
    try {
      const check = await runProcess('git', ['apply', '--check', '--binary', '--unidiff-zero', '--whitespace=nowarn', patchPath], {
        cwd: sourceWorkspace.path, timeout: 120000
      }, config);
      if (check.exitCode !== 0) {
        const reverse = await runProcess('git', ['apply', '--reverse', '--check', '--binary', '--unidiff-zero', '--whitespace=nowarn', patchPath], {
          cwd: sourceWorkspace.path, timeout: 120000
        }, config);
        if (reverse.exitCode !== 0) {
          throw promotionError(
            'TASK_SANDBOX_PROMOTION_CONFLICT',
            'This parallel task changed content that no longer applies cleanly to the visible workspace. Its private changes were preserved and no conflicting overwrite was made.'
          );
        }
        alreadyApplied = true;
      }
      if (!alreadyApplied) {
        const apply = await runProcess('git', ['apply', '--binary', '--unidiff-zero', '--whitespace=nowarn', patchPath], {
          cwd: sourceWorkspace.path, timeout: 120000
        }, config);
        if (apply.exitCode !== 0) {
          throw promotionError('TASK_SANDBOX_PROMOTION_FAILED', 'A private task patch passed preflight but could not be applied to the visible workspace. The sandbox was preserved.');
        }
      }
    } finally {
      fs.rmSync(path.dirname(patchPath), { recursive: true, force: true });
    }
  }

  const sourceSnapshot = await workspaceSnapshotCommit(sourceWorkspace, config);
  const synchronized = await synchronizeSandboxToSource(entry, sandboxSnapshot, sourceSnapshot, sourceWorkspace, config);
  if (!synchronized) {
    await removeSandboxEntry(entry, config);
    return { promoted: changedFiles.length > 0, changedFiles, sandboxRetired: true };
  }

  const registry = readSandboxRegistry(config);
  const current = registry.sandboxes?.[entry.alias];
  if (current) {
    current.syncCommit = sourceSnapshot.commit;
    current.sourceRevision = options.sourceRevision || await workspaceRevision(sourceWorkspace, config);
    current.lastPromotedAt = new Date().toISOString();
    current.promotedFiles = [...new Set([...(current.promotedFiles || []), ...changedFiles])];
    writeSandboxRegistry(config, registry);
  }
  return { promoted: changedFiles.length > 0, changedFiles, alreadyApplied };
}

async function synchronizeSandboxToSource(entry, sandboxSnapshot, sourceSnapshot, sourceWorkspace, config) {
  const changed = await changedPaths(entry.path, sandboxSnapshot.commit, sourceSnapshot.commit, config);
  if (!changed.length) return true;
  const patchPath = await writeCommitDiff(config, entry.path, sandboxSnapshot.commit, sourceSnapshot.commit);
  try {
    const check = await runProcess('git', ['apply', '--check', '--binary', '--unidiff-zero', '--whitespace=nowarn', patchPath], {
      cwd: entry.path, timeout: 120000
    }, config);
    if (check.exitCode !== 0) return false;
    const apply = await runProcess('git', ['apply', '--binary', '--unidiff-zero', '--whitespace=nowarn', patchPath], {
      cwd: entry.path, timeout: 120000
    }, config);
    if (apply.exitCode !== 0) return false;
    return true;
  } finally {
    fs.rmSync(path.dirname(patchPath), { recursive: true, force: true });
  }
}

async function assertPromotionBranches(sourceWorkspace, entry, config) {
  const sourceBranch = await currentBranch(sourceWorkspace.path, config);
  if (sourceBranch !== entry.sourceBranch) {
    throw promotionError(
      'TASK_SANDBOX_SOURCE_BRANCH_CHANGED',
      `The visible workspace moved from branch '${entry.sourceBranch}' to '${sourceBranch || '(detached)'}'. The private task changes were preserved instead of being applied to a different branch.`
    );
  }
  const sandboxBranch = await currentBranch(entry.path, config);
  if (sandboxBranch) {
    throw promotionError(
      'TASK_SANDBOX_BRANCH_CHANGED',
      `The private task sandbox attached itself to branch '${sandboxBranch}' unexpectedly, so Rel.AI preserved it instead of promoting ambiguous branch work.`
    );
  }
}

async function currentBranch(root, config) {
  const result = await runProcess('git', ['branch', '--show-current'], { cwd: root, timeout: 30000 }, config);
  return result.exitCode === 0 ? String(result.stdout || '').trim() : '';
}

async function changedPaths(root, fromCommit, toCommit, config) {
  const result = await runProcess('git', ['diff', '--name-only', '-z', fromCommit, toCommit, '--'], {
    cwd: root, timeout: 30000, maxOutputBytes: 16 * 1024 * 1024
  }, config);
  if (result.exitCode !== 0 || result.stdoutTruncated) {
    throw promotionError('TASK_SANDBOX_PROMOTION_FAILED', 'Could not calculate the private task change set. The sandbox was preserved.');
  }
  return [...new Set(splitNullList(result.stdout).filter(item => !isReusableDependencyPath(item)))];
}

async function writeCommitDiff(config, root, fromCommit, toCommit) {
  const tempRoot = path.join(getStateDir(config), 'parallel-sandboxes', 'tmp');
  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  const tempDir = fs.mkdtempSync(path.join(tempRoot, 'promote-'));
  const patchPath = path.join(tempDir, 'changes.patch');
  const result = await runProcess('git', [
    'diff', '--binary', '--full-index', '--unified=0', '--no-ext-diff', `--output=${patchPath}`,
    fromCommit, toCommit, '--'
  ], { cwd: root, timeout: 120000 }, config);
  if (result.exitCode !== 0 || !fs.existsSync(patchPath)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw promotionError('TASK_SANDBOX_PROMOTION_FAILED', 'Could not prepare the private task change set. The sandbox was preserved.');
  }
  return patchPath;
}

function promotionError(code, message) {
  return taskError(code, message, {
    retryable: true,
    allowedAlternatives: [
      'Resolve or revert the conflicting visible edit, then retry with the same work_id; its private task changes are preserved.',
      'Cancel the task to discard its private sandbox if those changes are no longer needed.'
    ]
  });
}

async function finalizeTaskSandbox(sourceWorkspace, config, taskId) {
  const entry = findTaskSandbox(config, sourceWorkspace.alias, taskId);
  if (!entry) return { finalized: false, changedFiles: [] };
  const promotion = await promoteTaskSandbox(sourceWorkspace, config, taskId);
  const current = findTaskSandbox(config, sourceWorkspace.alias, taskId);
  if (current) await removeSandboxEntry(current, config);
  return { finalized: true, changedFiles: promotion.changedFiles || [] };
}

async function discardTaskSandbox(sourceWorkspace, config, taskId) {
  const sourceAlias = typeof sourceWorkspace === 'string' ? sourceWorkspace : sourceWorkspace?.alias;
  const entry = findTaskSandbox(config, sourceAlias, taskId);
  if (!entry) return { discarded: false };
  await removeSandboxEntry(entry, config);
  return { discarded: true };
}

async function removeSandboxEntry(entry, config) {
  clearSessionPolicy(config, entry.alias, entry.taskId);
  const sandboxExists = Boolean(entry.path && fs.existsSync(entry.path));
  if (sandboxExists) {
    unlinkReusableDependencies(entry.path);
    const removed = await runProcess('git', ['worktree', 'remove', '--force', entry.path], {
      cwd: entry.sourcePath, timeout: 120000
    }, config);
    if (removed.exitCode !== 0) {
      throw taskError('TASK_SANDBOX_CLEANUP_FAILED', 'The private task sandbox could not be removed safely. Its registry entry was preserved for recovery.');
    }
  } else {
    await runProcess('git', ['worktree', 'prune'], {
      cwd: entry.sourcePath, timeout: 60000
    }, config).catch(() => {});
  }

  const registry = readSandboxRegistry(config);
  if (registry.sandboxes?.[entry.alias]) {
    delete registry.sandboxes[entry.alias];
    writeSandboxRegistry(config, registry);
  }
}

function overlayWorkspaceFileBytes(sourceRoot, targetRoot, files) {
  for (const relativePath of files || []) {
    if (isReusableDependencyPath(relativePath)) continue;
    const source = path.join(sourceRoot, relativePath);
    const target = path.join(targetRoot, relativePath);
    let stat;
    try { stat = fs.lstatSync(source); } catch { continue; }
    if (!stat.isFile()) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

async function workspaceRevision(workspace, config) {
  const headResult = await runProcess('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: workspace.path, timeout: 30000
  }, config);
  const statusResult = await runProcess('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: workspace.path, timeout: 30000, maxOutputBytes: 16 * 1024 * 1024
  }, config);
  if (statusResult.exitCode !== 0 || statusResult.stdoutTruncated) {
    throw promotionError('TASK_SANDBOX_SYNC_FAILED', 'Could not determine whether the visible workspace changed. The private task sandbox was preserved.');
  }
  const hash = crypto.createHash('sha256');
  hash.update(String(headResult.exitCode === 0 ? headResult.stdout : 'unborn').trim());
  hash.update('\0');
  hash.update(String(statusResult.stdout || ''));
  for (const entry of splitNullList(statusResult.stdout)) {
    const relativePath = statusPath(entry);
    if (!relativePath || isReusableDependencyPath(relativePath)) continue;
    const absolutePath = path.join(workspace.path, relativePath);
    try {
      const stat = fs.lstatSync(absolutePath, { bigint: true });
      hash.update(`\0${relativePath}\0${stat.mode}\0${stat.size}\0${stat.mtimeNs}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      hash.update(`\0${relativePath}\0missing`);
    }
  }
  return hash.digest('hex');
}

function statusPath(entry) {
  const value = String(entry || '');
  if (value.length >= 4 && value[2] === ' ') return value.slice(3);
  return value;
}

function linkReusableDependencies(sourceRoot, targetRoot) {
  for (const relativeRoot of REUSABLE_DEPENDENCY_ROOTS) {
    const sourceModules = path.join(sourceRoot, relativeRoot);
    const targetModules = path.join(targetRoot, relativeRoot);
    if (!fs.existsSync(sourceModules) || fs.existsSync(targetModules)) continue;
    try {
      if (!fs.statSync(sourceModules).isDirectory()) continue;
      fs.mkdirSync(path.dirname(targetModules), { recursive: true });
      fs.symlinkSync(sourceModules, targetModules, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      // Dependency reuse is an optimization only. A sandbox remains valid without it.
    }
  }
}

function unlinkReusableDependencies(targetRoot) {
  for (const relativeRoot of REUSABLE_DEPENDENCY_ROOTS) {
    const targetModules = path.join(targetRoot, relativeRoot);
    try {
      if (!fs.lstatSync(targetModules).isSymbolicLink()) continue;
      fs.unlinkSync(targetModules);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function splitNullList(value) {
  return String(value || '').split('\0').filter(item => item.length > 0);
}

export {
  discardTaskSandbox,
  finalizeTaskSandbox,
  findTaskSandbox,
  prepareTaskExecutionWorkspace,
  promoteTaskSandbox,
  readSandboxRegistry,
  resolveTaskSandboxWorkspace,
  shouldPromoteTaskSandbox,
  workspaceSnapshotCommit
};
