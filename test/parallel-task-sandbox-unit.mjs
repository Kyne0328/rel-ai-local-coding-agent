import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { allWorkspaceAliases, readConfig, resolveWorkspace } from '../src/config.js';
import { createTaskSandbox, promoteTaskSandbox, readSandboxRegistry } from '../src/parallelTaskSandbox.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';
import { readTaskHistorySession } from '../src/taskHistoryStore.js';
import { resetToolActivity } from '../src/toolActivity.js';
import { callTool as rawCallTool } from '../src/tools.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-parallel-sandbox-'));
const workspacePath = path.join(root, 'workspace');
const stateDir = path.join(root, 'state');
const configPath = path.join(root, 'config.json');
const previousConfig = process.env.REL_AI_MCP_CONFIG;
const context = { principal: 'local:trusted', publicHttpOnly: true, transportType: 'test' };

function git(...args) {
  return execFileSync('git', args, { cwd: workspacePath, encoding: 'utf8' }).trim();
}

function sandboxEntries(config) {
  return Object.values(readSandboxRegistry(config).sandboxes || {});
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

try {
  fs.mkdirSync(workspacePath, { recursive: true });
  git('init', '--initial-branch=main');
  git('config', 'user.email', 'relai@example.test');
  git('config', 'user.name', 'RelAI Test');
  fs.writeFileSync(path.join(workspacePath, 'alpha.txt'), 'alpha\n');
  fs.writeFileSync(path.join(workspacePath, 'beta.txt'), 'beta\n');
  fs.writeFileSync(path.join(workspacePath, 'shared.txt'), 'shared\n');
  fs.writeFileSync(path.join(workspacePath, 'merge.txt'), 'first\nsecond\nthird\n');
  fs.writeFileSync(path.join(workspacePath, 'source-only.txt'), 'source baseline\n');
  git('add', '.');
  git('commit', '-m', 'fixture');
  fs.mkdirSync(path.join(workspacePath, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(workspacePath, 'node_modules', '.relai-marker'), 'shared dependency\n');
  fs.mkdirSync(path.join(workspacePath, 'electron', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(workspacePath, 'electron', 'node_modules', '.relai-marker'), 'shared electron dependency\n');
  fs.writeFileSync(path.join(workspacePath, 'workspace-untracked.txt'), 'untracked baseline\n');

  fs.writeFileSync(configPath, JSON.stringify({
    version: 4,
    stateDir,
    auditLogPath: path.join(stateDir, 'audit.jsonl'),
    patch: { backup: true, requireCleanGit: false, maxUpdateBytes: 2 * 1024 * 1024 },
    workspaces: { app: { path: workspacePath, commands: {}, testCommands: {} } }
  }, null, 2));
  process.env.REL_AI_MCP_CONFIG = configPath;
  resetToolActivity();

  const first = await rawCallTool('relai_work', {
    action: 'begin', workspace: 'app', bootstrap: 'compact', objective: 'First parallel task.'
  }, context);
  const second = await rawCallTool('relai_work', {
    action: 'begin', workspace: 'app', bootstrap: 'compact', objective: 'Second parallel task.'
  }, context);
  const config = readConfig();

  await rawCallTool('relai_edit', {
    workspace: 'app', work_id: first.work_id, path: 'alpha.txt', oldText: 'alpha\n', newText: 'alpha from first\n'
  }, context);
  assert.equal(fs.readFileSync(path.join(workspacePath, 'alpha.txt'), 'utf8'), 'alpha from first\n');
  assert.equal(sandboxEntries(config).length, 0, 'the oldest active task should keep the visible workspace');

  const readOnlyExec = await rawCallTool('relai_exec', {
    workspace: 'app', work_id: second.work_id, executable: 'git', argv: ['status', '--short']
  }, context);
  assert.equal(readOnlyExec.ok, true);
  assert.equal(sandboxEntries(config).length, 0, 'clearly read-only Git exec calls must not create private worktrees');

  const sideEffectingDiff = await rawCallTool('relai_exec', {
    workspace: 'app', work_id: second.work_id, executable: 'git', argv: ['diff', '--output=read-only-side-effect.txt']
  }, context);
  assert.equal(sideEffectingDiff.ok, true);
  assert.equal(sideEffectingDiff.mutationTracking, 'sandbox-baseline', 'Git commands with output side effects must stay isolated');
  assert.deepEqual(sideEffectingDiff.changedFiles, ['read-only-side-effect.txt']);
  assert.equal(fs.existsSync(path.join(workspacePath, 'read-only-side-effect.txt')), true, 'safe sandbox output should still be promoted visibly');
  assert.equal(sandboxEntries(config).length, 1, 'the concurrent task should reuse one private worktree across mutations');
  assert.equal(sandboxEntries(config)[0].taskId, second.work_id);
  assert.equal(fs.existsSync(path.join(sandboxEntries(config)[0].path, 'node_modules', '.relai-marker')), true, 'the retained sandbox must reuse root dependencies');
  assert.equal(fs.existsSync(path.join(sandboxEntries(config)[0].path, 'electron', 'node_modules', '.relai-marker')), true, 'the retained sandbox must reuse Electron dependencies');

  await assert.rejects(
    () => rawCallTool('relai_edit', {
      workspace: 'app', work_id: second.work_id, path: 'beta.txt', oldText: 'missing beta\n', newText: 'never written\n'
    }, context),
    /not found|context|match/i
  );
  assert.equal(sandboxEntries(config).length, 1, 'a failed sandboxed edit should retain the reusable private worktree');

  const secondEdit = await rawCallTool('relai_edit', {
    workspace: 'app', work_id: second.work_id, path: 'beta.txt', oldText: 'beta\n', newText: 'beta from second\n'
  }, context);
  assert.equal(secondEdit.workspace, 'app', 'hidden aliases must not leak through tool results');
  assert.equal(readText(path.join(workspacePath, 'beta.txt')), 'beta from second\n');
  assert.equal(sandboxEntries(config).length, 1, 'successful concurrent edits should promote visibly while retaining their private worktree');

  const sandboxExec = await rawCallTool('relai_exec', {
    workspace: 'app',
    work_id: second.work_id,
    executable: process.execPath,
    argv: ['-e', "require('node:fs').writeFileSync('exec-generated.txt', 'generated from sandbox exec\\n')"]
  }, context);
  assert.deepEqual(sandboxExec.changedFiles, ['exec-generated.txt']);
  assert.equal(sandboxExec.mutationTracking, 'sandbox-baseline');
  assert.equal(readText(path.join(workspacePath, 'exec-generated.txt')), 'generated from sandbox exec\n');
  assert.equal(sandboxEntries(config).length, 1, 'successful concurrent exec mutations should reuse the same private worktree while keeping promoted bytes visible');

  const staleTaskId = 'stale-inactive-task';
  const staleEntry = await createTaskSandbox(resolveWorkspace(config, 'app'), config, staleTaskId);
  fs.writeFileSync(path.join(staleEntry.path, 'inactive-recovery.txt'), 'recovered from inactive task\n');
  await rawCallTool('relai_read', {
    workspace: 'app', work_id: first.work_id, paths: ['alpha.txt']
  }, context);
  assert.equal(fs.existsSync(path.join(workspacePath, 'inactive-recovery.txt')), false, 'ordinary reads must never promote another inactive task');
  assert.equal(sandboxEntries(config).some(entry => entry.taskId === staleTaskId), true);
  await rawCallTool('relai_edit', {
    workspace: 'app', work_id: first.work_id, path: 'alpha.txt', oldText: 'alpha from first\n', newText: 'alpha after recovery boundary\n'
  }, context);
  assert.equal(readText(path.join(workspacePath, 'inactive-recovery.txt')), 'recovered from inactive task\n');
  assert.equal(sandboxEntries(config).some(entry => entry.taskId === staleTaskId), false, 'writer boundaries should reconcile inactive task bytes');

  await createTaskSandbox(resolveWorkspace(config, 'app'), config, second.work_id);
  const entries = sandboxEntries(config);
  assert.equal(entries.length, 1, 'a directly prepared concurrent task should use one private sandbox');
  assert.equal(entries[0].taskId, second.work_id);
  assert.equal(entries[0].sourceAlias, 'app');
  assert.ok(entries[0].alias.startsWith('__relai_sandbox_'));
  assert.equal(
    execFileSync('git', ['branch', '--show-current'], { cwd: entries[0].path, encoding: 'utf8' }).trim(),
    '',
    'private sandboxes should stay detached instead of creating user-visible branches'
  );
  assert.deepEqual(
    git('branch', '--format=%(refname:short)').split(/\r?\n/).filter(Boolean),
    ['main'],
    'private sandboxes must not add branches to the source repository'
  );
  assert.deepEqual(allWorkspaceAliases(config), ['app'], 'private sandboxes must stay out of normal workspace discovery');
  const resolvedSandbox = resolveWorkspace(config, entries[0].alias);
  assert.equal(resolvedSandbox.taskSandbox, true);
  assert.equal(resolvedSandbox.sourceAlias, 'app');
  assert.equal(
    readText(path.join(entries[0].path, 'workspace-untracked.txt')),
    'untracked baseline\n',
    'the private sandbox must preserve safe untracked source bytes exactly'
  );

  fs.writeFileSync(path.join(entries[0].path, 'incremental.txt'), 'incremental promotion\n');
  const incremental = await promoteTaskSandbox(resolveWorkspace(config, 'app'), config, second.work_id, {
    changedFiles: ['incremental.txt']
  });
  assert.equal(incremental.synchronization, 'reconciled', 'a retained sandbox must first absorb source changes made by the primary task');
  assert.deepEqual(incremental.changedFiles, ['incremental.txt']);
  assert.equal(readText(path.join(workspacePath, 'incremental.txt')), 'incremental promotion\n');

  await assert.rejects(
    () => rawCallTool('relai_exec', {
      workspace: 'app',
      work_id: second.work_id,
      executable: 'git',
      argv: ['update-ref', 'refs/heads/relai-escape', 'HEAD']
    }, context),
    error => error?.code === 'TASK_SANDBOX_SHARED_REF_MUTATION_BLOCKED'
  );
  assert.deepEqual(
    git('branch', '--format=%(refname:short)').split(/\r?\n/).filter(Boolean),
    ['main'],
    'a sandbox command must not be able to create or move shared source refs'
  );

  const promotedAtBeforeRead = sandboxEntries(config)[0].lastPromotedAt;
  await rawCallTool('relai_read', {
    workspace: 'app', work_id: second.work_id, paths: ['beta.txt']
  }, context);
  assert.equal(
    sandboxEntries(config)[0].lastPromotedAt,
    promotedAtBeforeRead,
    'an unchanged source revision must not trigger snapshot/promotion work for ordinary reads'
  );

  fs.writeFileSync(path.join(workspacePath, 'source-only.txt'), 'source changed outside sandbox\n');
  await rawCallTool('relai_read', {
    workspace: 'app', work_id: second.work_id, paths: ['source-only.txt']
  }, context);
  assert.equal(
    readText(path.join(entries[0].path, 'source-only.txt')),
    'source changed outside sandbox\n',
    'a real source revision change must synchronize into the private task before a routed read'
  );
  assert.notEqual(
    sandboxEntries(config)[0].lastPromotedAt,
    promotedAtBeforeRead,
    'source revision changes should advance synchronization state exactly when needed'
  );

  const registryPath = path.join(stateDir, 'parallel-sandboxes', 'index.json');
  const legacyRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  legacyRegistry.sandboxes[entries[0].alias].syncVersion = 1;
  fs.writeFileSync(registryPath, `${JSON.stringify(legacyRegistry, null, 2)}\n`);
  fs.writeFileSync(path.join(workspacePath, 'source-added-after-sandbox.txt'), 'new source file after sandbox creation\n');
  await rawCallTool('relai_read', {
    workspace: 'app', work_id: second.work_id, paths: ['source-added-after-sandbox.txt']
  }, context);
  assert.equal(
    readText(path.join(entries[0].path, 'source-added-after-sandbox.txt')),
    'new source file after sandbox creation\n',
    'legacy retained sandboxes must reconcile newly added visible source files before routed reads'
  );
  assert.equal(sandboxEntries(config)[0].syncVersion, 2, 'reconciled sandboxes must record the current synchronization invariant');

  assert.equal(
    fs.existsSync(path.join(entries[0].path, 'node_modules', '.relai-marker')),
    true,
    'shared dependency links must survive source synchronization without entering task diffs'
  );
  assert.equal(
    fs.existsSync(path.join(entries[0].path, 'electron', 'node_modules', '.relai-marker')),
    true,
    'nested Electron dependencies should be reused without entering task diffs'
  );

  fs.writeFileSync(path.join(entries[0].path, 'merge.txt'), 'first from second\nsecond\nthird\n');
  fs.writeFileSync(path.join(workspacePath, 'merge.txt'), 'first\nsecond\nthird from first\n');
  const merged = await promoteTaskSandbox(resolveWorkspace(config, 'app'), config, second.work_id);
  assert.equal(merged.promoted, true);
  assert.equal(merged.synchronization, 'reconciled');
  assert.equal(
    readText(path.join(workspacePath, 'merge.txt')),
    'first from second\nsecond\nthird from first\n',
    'non-overlapping edits in the same file must merge without overwriting visible work'
  );

  fs.writeFileSync(path.join(entries[0].path, 'shared.txt'), 'shared from second\n');
  fs.writeFileSync(path.join(workspacePath, 'shared.txt'), 'shared from first\n');
  await assert.rejects(
    () => promoteTaskSandbox(resolveWorkspace(config, 'app'), config, second.work_id),
    error => error?.code === 'TASK_SANDBOX_PROMOTION_CONFLICT'
  );
  assert.equal(
    readText(path.join(workspacePath, 'shared.txt')),
    'shared from first\n',
    'a conflicting private patch must never overwrite newer visible work'
  );
  assert.equal(sandboxEntries(config).length, 1, 'conflicting private work should remain available until task cancellation or reconciliation');
  assert.equal(sandboxEntries(config)[0].unresolved?.code, 'TASK_SANDBOX_PROMOTION_CONFLICT');
  assert.deepEqual(sandboxEntries(config)[0].unresolved?.changedFiles, ['shared.txt']);
  const blockedSession = readTaskHistorySession(config, second.work_id);
  assert.equal(blockedSession?.status, 'blocked');
  assert.equal(blockedSession?.repairable, true);
  assert.deepEqual(blockedSession?.sandboxRecovery?.changedFiles, ['shared.txt']);
  const statusWithConflict = await rawCallTool('relai_work', {
    action: 'status', workspace: 'app', work_id: second.work_id
  }, context);
  assert.equal(statusWithConflict.ok, true, 'work status must remain readable while a sandbox conflict is unresolved');
  assert.equal(statusWithConflict.work_id, second.work_id, 'work status must preserve the requested task identity during recovery');

  const cancelled = await rawCallTool('relai_work', {
    action: 'cancel', workspace: 'app', work_id: second.work_id, reason: 'Conflict coverage complete.'
  }, context);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(sandboxEntries(config).length, 0, 'cancelling a parallel task must remove its private sandbox');
  assert.equal(fs.existsSync(entries[0].path), false);
  assert.equal(readTaskHistorySession(config, second.work_id)?.sandboxRecovery, undefined, 'cancellation must clear discarded conflict recovery metadata');

  await rawCallTool('relai_work', {
    action: 'cancel', workspace: 'app', work_id: first.work_id, reason: 'Test cleanup.'
  }, context);
} finally {
  repositoryIntelligence.shutdown();
  resetToolActivity();
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Parallel tasks isolate later writers privately, promote safe changes immediately, refuse conflicts, and clean up without exposing hidden workspaces.');
// Nested raw tool calls can leave the Windows test host's piped stdio referenced even after all app resources are closed.
// This isolated process has completed teardown above, so exit explicitly to keep direct and spawnSync runners deterministic.
process.exit(0);
