'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { classifyStatusOwnership } = require('./repo/gitOps');
const { resolveGitExecutable } = require('./gitExecutable');

const configuredWorkspaceStateTtlMs = Number(process.env.REL_AI_MCP_WORKSPACE_STATE_TTL_MS || 1000);
const WORKSPACE_GIT_STATE_TTL_MS = Number.isFinite(configuredWorkspaceStateTtlMs) ? Math.max(0, configuredWorkspaceStateTtlMs) : 1000;
const gitStateCache = new Map();

function buildWorkspaceStates(config, tasks = [], activity = {}) {
  const states = {};
  for (const [alias, workspace] of Object.entries(config.workspaces || {})) {
    states[alias] = workspaceState(alias, workspace, config, tasks, activity);
  }
  return states;
}

function workspaceState(alias, workspace, config, tasks, activity) {
  const recentTasks = tasks.filter(task => task.workspace === alias);
  const lastTask = recentTasks[0] || null;
  const lastValidation = recentTasks.find(task => task.validation !== 'not_run') || null;
  const activeTasks = resolveActiveTasks(activity);
  const currentTask = activeTasks.find(task => task.workspace === alias) || null;
  return {
    ...workspaceGitState(alias, workspace, config),
    currentActivity: currentTask ? {
      state: currentTask.state,
      tool: currentTask.lastTool || currentTask.tool,
      startedAt: currentTask.startedAt,
      activeCalls: currentTask.activeCalls || 0,
      taskId: currentTask.id || currentTask.taskId || ''
    } : null,
    lastTask,
    lastValidation: lastValidation ? { status: lastValidation.validation, completedAt: lastValidation.completedAt } : null
  };
}

function workspaceGitState(alias, workspace, config) {
  const workspacePath = String(workspace?.path || '');
  const allowed = Array.isArray(workspace.allowedRemotes) && workspace.allowedRemotes.length ? workspace.allowedRemotes : ['origin'];
  const cacheKey = `${alias}\u0000${workspacePath}\u0000${allowed.join('\u0000')}`;
  const cached = gitStateCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < WORKSPACE_GIT_STATE_TTL_MS) return cached.value;

  const exists = Boolean(workspacePath && fs.existsSync(workspacePath));
  const isGit = exists && fs.existsSync(path.join(workspacePath, '.git'));
  const result = {
    exists,
    isGit,
    branch: null,
    ahead: 0,
    behind: 0,
    dirty: false,
    changedFileCount: 0,
    sessionChangedFileCount: 0,
    remotes: [],
    remoteAvailable: false
  };
  if (isGit) {
    const status = runGit(workspacePath, ['status', '--short', '--branch']);
    if (status.ok) {
      const ownership = classifyStatusOwnership({ alias, path: workspacePath }, config, status.stdout);
      result.branch = ownership.branch;
      result.ahead = ownership.aheadBehind?.ahead || 0;
      result.behind = ownership.aheadBehind?.behind || 0;
      result.changedFileCount = ownership.entries.length;
      result.sessionChangedFileCount = ownership.sessionChanged.length;
      result.dirty = ownership.entries.length > 0;
    }
    const remotes = runGit(workspacePath, ['remote']);
    if (remotes.ok) result.remotes = String(remotes.stdout || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    result.remoteAvailable = allowed.some(remote => result.remotes.includes(remote));
  }
  gitStateCache.set(cacheKey, { createdAt: Date.now(), value: result });
  return result;
}

function resolveActiveTasks(activity) {
  if (Array.isArray(activity?.tasks)) return activity.tasks;
  if (activity?.state && activity.state !== 'idle') return [activity];
  return [];
}

function runGit(cwd, args) {
  const executable = resolveGitExecutable();
  if (!executable) {
    return { ok: false, stdout: '', stderr: 'Git was not found in a trusted installation directory.' };
  }
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 512 * 1024
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

module.exports = { buildWorkspaceStates, resolveGitExecutable };
