

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { readJsonFile, writeJsonAtomic } from './durableState.js';
import { getStateDir } from './statePaths.js';
import { runProcess, summarizeCommand } from "./process.js";
import { activeProcessesForWorkspace } from "./processManager.js";
import { assertSafeWorkspaceRoot } from './workspaceSafety.js';
import { isSecretPath } from './safety.js';
import { taskError } from './toolActivity.js';

function registryPath(config) {
  return path.join(getStateDir(config), 'worktrees', 'index.json');
}

function managedRoot(config) {
  return path.join(getStateDir(config), 'worktrees', 'repositories');
}

function readRegistry(config) {
  return readJsonFile(registryPath(config), {
    backup: true,
    mode: 0o600,
    validate: isWorktreeRegistry
  }) || { worktrees: {} };
}

function writeRegistry(config, registry) {
  if (!isWorktreeRegistry(registry)) throw new TypeError('Managed worktree registry is invalid.');
  writeJsonAtomic(registryPath(config), registry, { backup: true, mode: 0o600 });
}

function isWorktreeRegistry(value) {
  if (!isRecord(value) || !isRecord(value.worktrees)) return false;
  return Object.entries(value.worktrees).every(([alias, entry]) => isWorktreeEntry(alias, entry));
}

function isWorktreeEntry(alias, entry) {
  if (!isRecord(entry) || entry.alias !== alias) return false;
  for (const key of ['id', 'alias', 'sourceAlias', 'sourcePath', 'path', 'branch', 'base', 'owningTaskId', 'createdAt']) {
    if (typeof entry[key] !== 'string') return false;
  }
  return Boolean(entry.id && entry.alias && entry.sourceAlias && entry.sourcePath && entry.path && entry.branch && entry.base && entry.createdAt);
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) throw new Error('Worktree name must use 1-80 letters, numbers, dot, underscore, or dash.');
  return name;
}

function taskWorktreeName(taskId) {
  const digest = crypto.createHash('sha256').update(String(taskId || '')).digest('hex').slice(0, 12);
  return `task-${digest}`;
}

function integrationError(code, message, alternatives = []) {
  return taskError(code, message, {
    retryable: true,
    allowedAlternatives: alternatives.length ? alternatives : [
      'Keep using the same work_id; the isolated task changes are preserved.',
      'Resolve the reported integration blocker, then call relai_work with action "finish" again.'
    ]
  });
}

function managedTaskWorktreeEntry(config, sourceAlias, taskId) {
  const source = String(sourceAlias || '').trim();
  const owner = String(taskId || '').trim();
  if (!source || !owner) return null;
  return Object.values(readRegistry(config).worktrees || {}).find(entry =>
    entry?.taskIsolation === true
    && entry.sourceAlias === source
    && entry.owningTaskId === owner
  ) || null;
}

async function gitWorkspaceAvailable(workspace, config) {
  const result = await runProcess('git', ['rev-parse', '--is-inside-work-tree'], { cwd: workspace.path, timeout: 30000 }, config);
  return result.exitCode === 0 && String(result.stdout || '').trim() === 'true';
}

async function workspaceSnapshotCommit(workspace, config) {
  const tempRoot = path.join(getStateDir(config), 'worktrees', 'tmp');
  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  const tempDir = fs.mkdtempSync(path.join(tempRoot, 'snapshot-'));
  const indexPath = path.join(tempDir, 'index');
  const env = { GIT_INDEX_FILE: indexPath };
  try {
    const headResult = await runProcess('git', ['rev-parse', '--verify', 'HEAD'], { cwd: workspace.path, timeout: 30000 }, config);
    const head = headResult.exitCode === 0 ? String(headResult.stdout || '').trim() : '';
    const branchResult = await runProcess('git', ['branch', '--show-current'], { cwd: workspace.path, timeout: 30000 }, config);
    const branch = branchResult.exitCode === 0 ? String(branchResult.stdout || '').trim() : '';
    const initialize = await runProcess('git', head ? ['read-tree', head] : ['read-tree', '--empty'], {
      cwd: workspace.path, timeout: 30000, env
    }, config);
    if (initialize.exitCode !== 0) throw new Error(`Could not initialize isolated task baseline: ${initialize.stderr || initialize.stdout || initialize.exitCode}`);

    const tracked = await runProcess('git', ['add', '-u', '--', '.'], { cwd: workspace.path, timeout: 120000, env }, config);
    if (tracked.exitCode !== 0) throw new Error(`Could not snapshot tracked workspace changes: ${tracked.stderr || tracked.stdout || tracked.exitCode}`);

    const untrackedResult = await runProcess('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd: workspace.path, timeout: 30000, maxOutputBytes: 16 * 1024 * 1024
    }, config);
    if (untrackedResult.exitCode !== 0 || untrackedResult.stdoutTruncated) {
      throw new Error(`Could not inspect untracked files for task isolation: ${untrackedResult.stderr || untrackedResult.stdout || 'output exceeded limit'}`);
    }
    const untracked = String(untrackedResult.stdout || '').split('\0').map(item => item.trim()).filter(Boolean);
    const excludedSensitive = untracked.filter(isSecretPath);
    const safeUntracked = untracked.filter(item => !isSecretPath(item));
    for (let index = 0; index < safeUntracked.length; index += 100) {
      const add = await runProcess('git', ['add', '--', ...safeUntracked.slice(index, index + 100)], {
        cwd: workspace.path, timeout: 120000, env
      }, config);
      if (add.exitCode !== 0) throw new Error(`Could not snapshot untracked workspace files: ${add.stderr || add.stdout || add.exitCode}`);
    }

    const treeResult = await runProcess('git', ['write-tree'], { cwd: workspace.path, timeout: 30000, env }, config);
    if (treeResult.exitCode !== 0) throw new Error(`Could not write isolated task baseline tree: ${treeResult.stderr || treeResult.stdout || treeResult.exitCode}`);
    const tree = String(treeResult.stdout || '').trim();
    const commitArgs = [
      '-c', 'user.name=Rel.AI',
      '-c', 'user.email=relai@localhost',
      'commit-tree', tree,
      ...(head ? ['-p', head] : []),
      '-m', 'Rel.AI isolated task snapshot'
    ];
    const commitResult = await runProcess('git', commitArgs, { cwd: workspace.path, timeout: 30000 }, config);
    if (commitResult.exitCode !== 0) throw new Error(`Could not create isolated task baseline commit: ${commitResult.stderr || commitResult.stdout || commitResult.exitCode}`);
    const commit = String(commitResult.stdout || '').trim();
    if (!commit) throw new Error('Could not create isolated task baseline commit.');
    return { commit, head, branch, excludedSensitive };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function ensureTaskWorktree(workspace, config, taskId) {
  const owner = String(taskId || '').trim();
  if (!owner) return null;
  const existing = managedTaskWorktreeEntry(config, workspace.alias, owner);
  if (existing) {
    if (!fs.existsSync(existing.path)) throw taskError('TASK_WORKTREE_UNAVAILABLE', `The isolated working copy for this task is unavailable: ${existing.path}`);
    return existing;
  }
  if (!await gitWorkspaceAvailable(workspace, config)) return null;
  const baseline = await workspaceSnapshotCommit(workspace, config);
  const name = taskWorktreeName(owner);
  const created = await createManagedWorktree(workspace, config, {
    name,
    base: baseline.commit,
    branch: `relai/task/${name}`
  }, { taskId: owner });
  if (created?.ok === false) {
    throw taskError('TASK_WORKTREE_CREATE_FAILED', `Could not create an isolated working copy for this task: ${created.git?.stderr || created.git?.stdout || 'git worktree add failed'}`);
  }
  const registry = readRegistry(config);
  const entry = registry.worktrees?.[created.alias];
  if (!entry) throw taskError('TASK_WORKTREE_CREATE_FAILED', 'The isolated task worktree was created but could not be registered.');
  entry.taskIsolation = true;
  entry.sourceBranch = baseline.branch;
  entry.sourceHead = baseline.head;
  entry.baselineExcludedSensitive = baseline.excludedSensitive;
  writeRegistry(config, registry);
  return entry;
}

async function taskExecutionWorkspace(workspace, config, taskId, operationName) {
  const owner = String(taskId || '').trim();
  if (!owner || !workspace?.alias || workspace.managedWorktree === true) return workspace;
  const operation = String(operationName || '');
  const bypass = new Set([
    'relai_begin_work', 'relai_finish_work', 'relai_cancel_work',
    'relai_worktree_create', 'relai_worktree_list', 'relai_worktree_remove'
  ]);
  if (bypass.has(operation)) return workspace;
  const existing = managedTaskWorktreeEntry(config, workspace.alias, owner);
  if (existing) return resolveManagedWorktree(config, existing.alias);
  const promotes = new Set([
    'relai_edit', 'relai_exec', 'relai_tidy_run', 'relai_restore_paths', 'relai_reset_workspace',
    'relai_process_start', 'relai_process_write'
  ]);
  if (!promotes.has(operation)) return workspace;
  const created = await ensureTaskWorktree(workspace, config, owner);
  return created ? resolveManagedWorktree(config, created.alias) : workspace;
}

async function integrateTaskWorktree(workspace, config, taskId) {
  const owner = String(taskId || '').trim();
  const entry = managedTaskWorktreeEntry(config, workspace.alias, owner);
  if (!entry) return { integrated: false, changedFiles: [] };
  if (entry.integratedAt) return { integrated: true, changedFiles: entry.integratedChangedFiles || [], duplicate: true };
  if (!fs.existsSync(entry.path)) throw taskError('TASK_WORKTREE_UNAVAILABLE', `The isolated working copy for this task is unavailable: ${entry.path}`);

  const active = activeProcessesForWorkspace(config, entry.alias);
  if (active.length) {
    throw integrationError('TASK_INTEGRATION_ACTIVE_PROCESS', `Task integration is paused because ${active.length} process(es) are still running in its isolated working copy. Stop them, then finish the task again.`, [
      'Stop the task-owned process(es) with relai_process, then finish the same work_id again.',
      'Keep the work_id active; no task changes have been discarded.'
    ]);
  }
  if (entry.sourceBranch) {
    const branchResult = await runProcess('git', ['branch', '--show-current'], { cwd: workspace.path, timeout: 30000 }, config);
    const currentBranch = branchResult.exitCode === 0 ? String(branchResult.stdout || '').trim() : '';
    if (currentBranch !== entry.sourceBranch) {
      throw integrationError('TASK_INTEGRATION_BRANCH_CHANGED', `Task integration is paused because the source workspace moved from branch '${entry.sourceBranch}' to '${currentBranch || '(detached)'}'. Return to the original branch or integrate the preserved task worktree manually.`);
    }
  }

  const isolatedWorkspace = { ...workspace, alias: entry.alias, path: entry.path };
  const currentSnapshot = await workspaceSnapshotCommit(isolatedWorkspace, config);
  if (currentSnapshot.excludedSensitive.length) {
    throw integrationError('TASK_INTEGRATION_SENSITIVE_CHANGES', `Task integration is paused because the isolated working copy contains sensitive untracked files that Rel.AI will not copy automatically: ${currentSnapshot.excludedSensitive.slice(0, 5).join(', ')}.`);
  }
  const namesResult = await runProcess('git', ['diff', '--name-only', '-z', entry.base, currentSnapshot.commit, '--'], {
    cwd: entry.path, timeout: 30000, maxOutputBytes: 16 * 1024 * 1024
  }, config);
  if (namesResult.exitCode !== 0 || namesResult.stdoutTruncated) {
    throw integrationError('TASK_INTEGRATION_FAILED', 'Could not calculate the isolated task change set. The task worktree was preserved.');
  }
  const changedFiles = [...new Set(String(namesResult.stdout || '').split('\0').map(item => item.trim()).filter(Boolean))];
  const sensitiveChanged = changedFiles.filter(isSecretPath);
  if (sensitiveChanged.length) {
    throw integrationError('TASK_INTEGRATION_SENSITIVE_CHANGES', `Task integration is paused because automatic integration will not copy sensitive paths: ${sensitiveChanged.slice(0, 5).join(', ')}.`);
  }
  if (!changedFiles.length) {
    await removeIntegratedTaskWorktree(entry, config);
    return { integrated: true, changedFiles: [], empty: true };
  }

  const tempRoot = path.join(getStateDir(config), 'worktrees', 'tmp');
  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  const tempDir = fs.mkdtempSync(path.join(tempRoot, 'integrate-'));
  const patchPath = path.join(tempDir, 'task.patch');
  try {
    const diffResult = await runProcess('git', [
      'diff', '--binary', '--full-index', '--no-ext-diff', `--output=${patchPath}`,
      entry.base, currentSnapshot.commit, '--'
    ], { cwd: entry.path, timeout: 120000 }, config);
    if (diffResult.exitCode !== 0 || !fs.existsSync(patchPath)) {
      throw integrationError('TASK_INTEGRATION_FAILED', 'Could not generate the isolated task patch. The task worktree was preserved.');
    }
    const check = await runProcess('git', ['apply', '--check', '--binary', '--whitespace=nowarn', patchPath], {
      cwd: workspace.path, timeout: 120000
    }, config);
    if (check.exitCode !== 0) {
      const reverseCheck = await runProcess('git', ['apply', '--reverse', '--check', '--binary', '--whitespace=nowarn', patchPath], {
        cwd: workspace.path, timeout: 120000
      }, config);
      if (reverseCheck.exitCode !== 0) {
        throw integrationError('TASK_INTEGRATION_CONFLICT', `Task changes are safely preserved, but they no longer apply cleanly to the shared workspace. Resolve the overlapping changes in this task, then finish again. ${String(check.stderr || check.stdout || '').trim()}`, [
          'Keep using this work_id; its isolated changes are preserved.',
          'Resolve the overlapping source/task changes, then finish the same work_id again.'
        ]);
      }
    } else {
      const apply = await runProcess('git', ['apply', '--binary', '--whitespace=nowarn', patchPath], {
        cwd: workspace.path, timeout: 120000
      }, config);
      if (apply.exitCode !== 0) {
        throw integrationError('TASK_INTEGRATION_FAILED', `Automatic task integration failed after preflight. The isolated worktree was preserved. ${String(apply.stderr || apply.stdout || '').trim()}`);
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const registry = readRegistry(config);
  if (registry.worktrees?.[entry.alias]) {
    registry.worktrees[entry.alias].integratedAt = new Date().toISOString();
    registry.worktrees[entry.alias].integratedChangedFiles = changedFiles;
    writeRegistry(config, registry);
  }
  await removeIntegratedTaskWorktree({ ...entry, integratedAt: new Date().toISOString() }, config);
  return { integrated: true, changedFiles };
}

async function removeIntegratedTaskWorktree(entry, config) {
  if (fs.existsSync(entry.path)) {
    const command = await runProcess('git', ['worktree', 'remove', '--force', entry.path], { cwd: entry.sourcePath, timeout: 120000 }, config);
    if (command.exitCode !== 0) return false;
  }
  const registry = readRegistry(config);
  delete registry.worktrees[entry.alias];
  writeRegistry(config, registry);
  await runProcess('git', ['worktree', 'prune'], { cwd: entry.sourcePath, timeout: 60000 }, config);
  return true;
}

async function createManagedWorktree(workspace, config, args = {}, context = {}) {
  const name = safeName(args.name);
  const registry = readRegistry(config);
  const alias = `${workspace.alias}--${name}`;
  if (registry.worktrees?.[alias]) throw new Error(`Managed worktree '${alias}' already exists.`);
  const target = path.join(managedRoot(config), workspace.alias, name);
  assertSafeWorkspaceRoot(target, 'Managed worktree path');
  if (fs.existsSync(target)) throw new Error(`Managed worktree directory already exists: ${target}`);
  const base = String(args.base || workspace.defaultBaseBranch || 'main').trim();
  const branch = String(args.branch || `relai/${name}`).trim();
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(branch) || branch.includes('..') || branch.startsWith('-') || branch.endsWith('/')) throw new Error(`Invalid worktree branch: ${branch}`);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const command = await runProcess('git', ['worktree', 'add', '-b', branch, target, base], { cwd: workspace.path, timeout: 120000 }, config);
  if (command.exitCode !== 0) return { ok: false, workspace: workspace.alias, alias, branch, base, path: target, git: summarizeCommand(command) };
  const entry = {
    id: `wt_${crypto.randomBytes(16).toString('base64url')}`,
    alias,
    sourceAlias: workspace.alias,
    sourcePath: workspace.path,
    path: fs.realpathSync(target),
    branch,
    base,
    owningTaskId: String(context.taskId || args.work_id || ''),
    createdAt: new Date().toISOString()
  };
  registry.worktrees = registry.worktrees || {};
  registry.worktrees[alias] = entry;
  writeRegistry(config, registry);
  return { ok: true, ...entry, git: summarizeCommand(command) };
}

async function listManagedWorktrees(config, args = {}, context = {}) {
  const registry = readRegistry(config);
  const sourceAlias = String(args.workspace || '').trim();
  const taskId = String(context.taskId || args.work_id || '').trim();
  const worktrees = [];
  for (const entry of Object.values(registry.worktrees || {})) {
    if (taskId && entry.owningTaskId !== taskId) continue;
    if (sourceAlias && entry.sourceAlias !== sourceAlias && entry.alias !== sourceAlias) continue;
    const status = await worktreeStatus(entry, config);
    worktrees.push({ ...entry, ...status });
  }
  worktrees.sort((left, right) => left.alias.localeCompare(right.alias));
  return { ok: true, worktrees, count: worktrees.length };
}

async function removeManagedWorktree(workspace, config, args = {}, context = {}) {
  const registry = readRegistry(config);
  const alias = String(args.alias || args.worktree || '').trim();
  const entry = registry.worktrees?.[alias];
  if (!entry) throw new Error(`Managed worktree '${alias}' was not found.`);
  const taskId = String(context.taskId || args.work_id || '').trim();
  if (entry.owningTaskId && entry.owningTaskId !== taskId) {
    throw taskError('TASK_OWNERSHIP_MISMATCH', `Managed worktree '${alias}' belongs to a different logical task.`);
  }
  const status = await worktreeStatus(entry, config);
  const active = activeProcessesForWorkspace(config, alias);
  const force = args.force === true;
  if (!force && status.dirty) throw new Error(`Managed worktree '${alias}' is dirty. Review it before removal or retry with force after explicit approval.`);
  if (!force && active.length) throw new Error(`Managed worktree '${alias}' has ${active.length} active process(es). Stop them before removal.`);
  if (force && active.length) throw new Error(`Force removal still requires active managed processes to be stopped explicitly: ${active.map(item => item.processId).join(', ')}.`);
  const command = await runProcess('git', ['worktree', 'remove', ...(force ? ['--force'] : []), entry.path], { cwd: entry.sourcePath, timeout: 120000 }, config);
  if (command.exitCode !== 0) return { ok: false, alias, dirty: status.dirty, git: summarizeCommand(command) };
  delete registry.worktrees[alias];
  writeRegistry(config, registry);
  await runProcess('git', ['worktree', 'prune'], { cwd: entry.sourcePath, timeout: 60000 }, config);
  return { ok: true, alias, removedPath: entry.path, branchPreserved: true, git: summarizeCommand(command) };
}

async function worktreeStatus(entry, config) {
  if (!entry.path || !fs.existsSync(entry.path)) return { available: false, dirty: false, status: '', stale: true };
  const result = await runProcess('git', ['status', '--short', '--branch'], { cwd: entry.path, timeout: 30000 }, config);
  const lines = String(result.stdout || '').split(/\r?\n/).filter(Boolean);
  return {
    available: result.exitCode === 0,
    dirty: lines.some(line => !line.startsWith('##')),
    status: String(result.stdout || '').trim(),
    stale: false
  };
}

function resolveManagedWorktree(config, input) {
  const key = String(input || '').trim();
  if (!key) return null;
  const entry = readRegistry(config).worktrees?.[key];
  if (!entry) return null;
  if (!fs.existsSync(entry.path)) throw new Error(`Managed worktree '${key}' path is unavailable: ${entry.path}`);
  const source = config.workspaces?.[entry.sourceAlias];
  if (!source) throw new Error(`Managed worktree '${key}' source workspace '${entry.sourceAlias}' is no longer configured.`);
  return {
    alias: entry.alias,
    path: fs.realpathSync(entry.path),
    testCommands: source.testCommands || {},
    commands: source.commands || {},
    protectedBranches: [...new Set([...(source.protectedBranches || ['main', 'master']), entry.branch])],
    defaultBaseBranch: source.defaultBaseBranch || 'main',
    allowedRemotes: source.allowedRemotes || ['origin'],
    repoSlug: source.repoSlug || '',
    skills: Array.isArray(source.skills) ? [...source.skills] : [],
    context: source.context || {},
    validationRules: source.validationRules || {},
    managedWorktree: true,
    sourceAlias: entry.sourceAlias,
    branch: entry.branch,
    base: entry.base
  };
}

function managedWorktreeAliases(config) {
  return Object.keys(readRegistry(config).worktrees || {}).sort((left, right) => left.localeCompare(right));
}

export { createManagedWorktree, listManagedWorktrees, removeManagedWorktree, resolveManagedWorktree, managedWorktreeAliases, readRegistry, managedTaskWorktreeEntry, ensureTaskWorktree, taskExecutionWorkspace, integrateTaskWorktree, workspaceSnapshotCommit };
