

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { readJsonFile, writeJsonAtomic } from './durableState.js';
import { getStateDir } from './statePaths.js';
import { runProcess, summarizeCommand } from "./process.js";
import { activeProcessesForWorkspace } from "./processManager.js";
import { assertSafeWorkspaceRoot } from './workspaceSafety.js';
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

export { createManagedWorktree, listManagedWorktrees, removeManagedWorktree, resolveManagedWorktree, managedWorktreeAliases, readRegistry };
