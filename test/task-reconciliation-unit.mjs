import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { flushAuditWrites } from '../src/audit.js';
import { readConfig } from '../src/config.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';
import { flushTaskHistoryPersistence, readTaskHistory, readTaskHistorySessionRecord, recordWorkflowState } from '../src/taskHistoryStore.js';
import { taskCommitOwnership } from '../src/taskIntegrity.js';
import { ensureCurrentHistory, getTaskHistoryDir, listSessions, pruneSessions, writeSession } from '../src/taskHistoryStorage.js';
import { DEFAULT_TASK_IDLE_MS, getToolActivity, resetToolActivity } from '../src/toolActivity.js';
import { callTool as rawCallTool } from '../src/tools.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-reconciliation-'));
const workspace = path.join(root, 'workspace');
const stateDir = path.join(root, 'state');
const configPath = path.join(root, 'config.json');
const previousConfig = process.env.REL_AI_MCP_CONFIG;
const context = { principal: 'local:trusted', publicHttpOnly: true, transportType: 'test', transportSessionId: 'reconciliation-test' };

function git(...args) {
  return execFileSync('git', args, { cwd: workspace, encoding: 'utf8' }).trim();
}

async function begin(label) {
  const result = await rawCallTool('relai_work', { action: 'begin', workspace: 'app', title: label }, context);
  assert.ok(result.work_id);
  return result.work_id;
}

try {
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'src', 'index.js'), 'export const ready = true;\n');
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { check: 'node --check src/index.js' } }, null, 2));
  git('init', '--initial-branch=main');
  git('config', 'user.email', 'relai@example.test');
  git('config', 'user.name', 'RelAI Test');
  git('add', '.');
  git('commit', '-m', 'fixture');

  fs.writeFileSync(configPath, JSON.stringify({
    version: 4,
    stateDir,
    workspaces: { app: { path: workspace, commands: {}, testCommands: { check: 'npm run check' } } }
  }, null, 2));
  process.env.REL_AI_MCP_CONFIG = configPath;
  resetToolActivity();

  fs.writeFileSync(path.join(workspace, 'ambient-unrelated.txt'), 'do not absorb\n');
  const committedTask = await begin('Commit reconciliation fixture');
  await rawCallTool('relai_edit', {
    workspace: 'app', work_id: committedTask, path: 'src/committed-owned.js', content: 'export const committed = true;\n'
  }, context);

  const committed = await rawCallTool('relai_publish', {
    action: 'commit', workspace: 'app', work_id: committedTask, message: 'commit task-owned reconciliation fixture'
  }, context);
  assert.equal(committed.ok, true);
  assert.equal(committed.addAll, false);
  assert.deepEqual(committed.paths, ['src/committed-owned.js']);
  assert.deepEqual(taskCommitOwnership(readConfig(), committedTask, 'app').ownedFiles, [], 'successful task commit must release live path ownership before another task can publish');
  assert.equal(git('status', '--porcelain=v1', '--', 'src/committed-owned.js'), '', 'committed task-owned path must be clean immediately');
  assert.equal(git('diff', '--cached', '--name-only', '--', 'src/committed-owned.js'), '', 'committed path must not remain reverse-staged');
  assert.ok(git('status', '--porcelain=v1', '--', 'ambient-unrelated.txt').startsWith('??'), 'ambient untracked work must remain untouched');

  const completedCommitted = await rawCallTool('relai_validate', {
    action: 'checks', workspace: 'app', work_id: committedTask, checks: ['npm:check'], complete: true,
    summary: 'Committed task-owned work reconciled cleanly.'
  }, context);
  assert.equal(completedCommitted.completionKnown, true);
  assert.equal(completedCommitted.residualState, 'clean');
  assert.deepEqual(completedCommitted.residualChangedFiles || [], []);
  assert.equal(getToolActivity().lastTask?.residualState, 'clean');

  fs.rmSync(path.join(workspace, 'ambient-unrelated.txt'), { force: true });
  resetToolActivity();

  const residualTask = await begin('Residual preservation fixture');
  await rawCallTool('relai_edit', {
    workspace: 'app', work_id: residualTask, path: 'src/residual-owned.js', content: 'export const residual = true;\n'
  }, context);
  const completedResidual = await rawCallTool('relai_validate', {
    action: 'checks', workspace: 'app', work_id: residualTask, checks: ['npm:check'], complete: true,
    summary: 'Validated task intentionally remains uncommitted.'
  }, context);
  assert.equal(completedResidual.completionKnown, true);
  assert.equal(completedResidual.residualState, 'preserved_uncommitted');
  assert.deepEqual(completedResidual.residualChangedFiles, ['src/residual-owned.js']);
  assert.match(completedResidual.message, /explicit preserved uncommitted work/i);
  assert.equal(getToolActivity().lastTask?.residualState, 'preserved_uncommitted');
  assert.deepEqual(getToolActivity().lastTask?.residualChangedFiles, ['src/residual-owned.js']);

  resetToolActivity();
  const idleTask = await begin('Idle task must remain resumable');
  await flushTaskHistoryPersistence();
  const idleSession = readTaskHistorySessionRecord(readConfig(), idleTask);
  const inactiveAt = new Date(Date.now() - DEFAULT_TASK_IDLE_MS - 5_000).toISOString();
  writeSession(getTaskHistoryDir(readConfig()), {
    ...idleSession,
    status: 'planning',
    state: 'waiting',
    updatedAt: inactiveAt,
    lastActivityAt: inactiveAt,
    events: (idleSession.events || []).map(event => ({ ...event, timestamp: inactiveAt, ts: inactiveAt, startedAt: inactiveAt, completedAt: inactiveAt }))
  });
  resetToolActivity();
  const historyAfterIdle = readTaskHistory(readConfig(), getToolActivity(), { limit: 100 });
  assert.equal(historyAfterIdle.some(session => session.id === idleTask && session.status === 'inactive'), true, 'an idle no-op task must remain stored as resumable inactive work');
  const resumedIdle = await rawCallTool('relai_read', { workspace: 'app', work_id: idleTask, paths: ['src/index.js'] }, context);
  assert.equal(resumedIdle.work_id, idleTask, 'a stored inactive task must resume with the same identity');
  await rawCallTool('relai_work', { action: 'cancel', workspace: 'app', work_id: idleTask, reason: 'Idle recovery regression complete.' }, context);

  resetToolActivity();
  const workflowOnlyTask = await begin('Workflow readiness is not completion');
  recordWorkflowState(readConfig(), workflowOnlyTask, {
    workflow: { stage: 'complete', completion: { hardReady: true, blockers: [] } }
  });
  await flushTaskHistoryPersistence();
  resetToolActivity();
  const workflowOnlySession = readTaskHistorySessionRecord(readConfig(), workflowOnlyTask, { reconcileInactive: true, activeTaskIds: new Set() });
  assert.notEqual(workflowOnlySession.status, 'completed', 'workflow readiness must never substitute for an explicit lifecycle completion');
  const resumedWorkflowOnly = await rawCallTool('relai_read', { workspace: 'app', work_id: workflowOnlyTask, paths: ['src/index.js'] }, context);
  assert.equal(resumedWorkflowOnly.work_id, workflowOnlyTask);
  await rawCallTool('relai_work', { action: 'cancel', workspace: 'app', work_id: workflowOnlyTask, reason: 'Workflow readiness regression complete.' }, context);

  const pruneStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-open-history-prune-'));
  const pruneConfig = { stateDir: pruneStateDir };
  ensureCurrentHistory(pruneConfig);
  const pruneDirectory = getTaskHistoryDir(pruneConfig);
  const record = (id, status, extra = {}) => writeSession(pruneDirectory, {
    id,
    status,
    workspace: 'app',
    updatedAt: new Date().toISOString(),
    progress: { mode: 'indeterminate', label: status },
    ...extra
  });
  record('open-inactive', 'inactive', { resumeStatus: 'planning' });
  record('terminal-completed', 'completed', { completionKnown: true });
  record('terminal-cancelled', 'cancelled', { endReason: 'explicit_cancellation' });
  pruneSessions(pruneDirectory, 1);
  assert.deepEqual(listSessions(pruneDirectory, 10).map(session => session.id), ['open-inactive'], 'history pruning must preserve nonterminal work even when it exceeds the nominal retention target');
  fs.rmSync(pruneStateDir, { recursive: true, force: true });

  console.log('Task commit, inactivity recovery, cleanup retention, explicit completion, and residual-state tests passed.');
} finally {
  await flushAuditWrites();
  repositoryIntelligence.shutdown();
  resetToolActivity();
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(root, { recursive: true, force: true });
}
process.exit(0);
