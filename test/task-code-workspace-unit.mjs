import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-code-'));
const repo = path.join(root, 'repo');
const stateDir = path.join(root, 'state');
const configPath = path.join(root, 'config.json');
fs.mkdirSync(repo, { recursive: true });
fs.writeFileSync(path.join(repo, 'alpha.txt'), 'alpha baseline\n');
fs.writeFileSync(path.join(repo, 'beta.txt'), 'beta baseline\n');
fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
git('init', '--initial-branch=main');
git('config', 'user.email', 'relai@example.test');
git('config', 'user.name', 'RelAI Test');
git('add', '.');
git('commit', '-m', 'fixture');
fs.writeFileSync(path.join(repo, 'ambient.txt'), 'unrelated visible checkout change\n');

fs.writeFileSync(configPath, JSON.stringify({
  version: 7,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: { app: { path: repo, commands: {}, testCommands: {} } }
}, null, 2));

const previousConfig = process.env.REL_AI_MCP_CONFIG;
process.env.REL_AI_MCP_CONFIG = configPath;

const { flushAuditWrites } = await import('../src/audit.js');
const { readConfig } = await import('../src/config.js');
const { flushLocalAnalytics } = await import('../src/localAnalytics.js');
const { repositoryIntelligence } = await import('../src/repository/intelligence/service.js');
const {
  describeTaskCodeWorkspace,
  readTaskCodeDiff,
  readTaskCodeFile,
  writeTaskCodeFile
} = await import('../src/taskCodeWorkspace.js');
const { flushTaskHistoryPersistence } = await import('../src/taskHistoryStore.js');
const { readTaskIntegrity } = await import('../src/taskIntegrity.js');
const { resetTaskHistoryCaches } = await import('../src/taskHistoryStorage.js');
const { callTool } = await import('../src/tools.js');
const { resetToolActivity } = await import('../src/toolActivity.js');

const context = { principal: 'local:trusted', transportType: 'test' };
let taskId = '';

try {
  resetToolActivity();
  const task = await callTool('relai_work', {
    action: 'begin',
    workspace: 'app',
    bootstrap: 'none',
    title: 'Code workspace test'
  }, context);
  taskId = task.work_id;
  const config = readConfig();

  const workspace = await describeTaskCodeWorkspace(config, { taskId });
  assert.equal(workspace.workspace, 'app');
  assert.equal(workspace.workspaceMode, 'visible');
  assert.equal(workspace.integrationStatus, 'not_applicable');
  assert.equal(workspace.writable, true);
  assert.ok(workspace.files.includes('alpha.txt'));
  assert.ok(workspace.files.includes('beta.txt'));
  assert.deepEqual(workspace.changedFiles, [], 'ambient visible-checkout changes must not be presented as task-owned edits');

  const alpha = await readTaskCodeFile(config, { taskId, path: 'alpha.txt' });
  assert.equal(alpha.content.replaceAll('\r\n', '\n'), 'alpha baseline\n');
  assert.match(alpha.sha256, /^[a-f0-9]{64}$/);

  const saved = await writeTaskCodeFile(config, {
    taskId,
    path: 'alpha.txt',
    content: 'alpha from embedded editor\n',
    expectedSha256: alpha.sha256
  });
  assert.equal(saved.changed, true);
  assert.equal(fs.readFileSync(path.join(repo, 'alpha.txt'), 'utf8').replaceAll('\r\n', '\n'), 'alpha from embedded editor\n', 'embedded editing must update the visible project checkout');

  const diff = await readTaskCodeDiff(config, { taskId, path: 'alpha.txt' });
  assert.equal(diff.baseContent.replaceAll('\r\n', '\n'), 'alpha baseline\n');
  assert.equal(diff.content.replaceAll('\r\n', '\n'), 'alpha from embedded editor\n');
  assert.equal(diff.baseAvailable, true);

  const afterAlpha = await describeTaskCodeWorkspace(config, { taskId });
  assert.deepEqual(afterAlpha.changedFiles, ['alpha.txt']);
  assert.equal(afterAlpha.changedFileStatuses?.['alpha.txt']?.code, 'M');
  assert.equal(afterAlpha.changedFiles.includes('ambient.txt'), false, 'unrelated dirty files must stay out of the task edit list');

  const beta = await readTaskCodeFile(config, { taskId, path: 'beta.txt' });
  await writeTaskCodeFile(config, {
    taskId,
    path: 'beta.txt',
    content: 'beta from embedded editor\n',
    expectedSha256: beta.sha256
  });
  const afterBeta = await describeTaskCodeWorkspace(config, { taskId });
  assert.deepEqual(new Set(afterBeta.changedFiles), new Set(['alpha.txt', 'beta.txt']));
  assert.equal(afterBeta.changedFileStatuses?.['beta.txt']?.code, 'M');

  const refreshedAlpha = await readTaskCodeFile(config, { taskId, path: 'alpha.txt' });
  fs.writeFileSync(path.join(repo, 'alpha.txt'), 'alpha changed in external IDE\n');
  await assert.rejects(
    () => writeTaskCodeFile(config, {
      taskId,
      path: 'alpha.txt',
      content: 'stale editor overwrite\n',
      expectedSha256: refreshedAlpha.sha256
    }),
    error => error?.code === 'TASK_CODE_STALE_FILE',
    'an embedded editor save must not overwrite a newer external IDE edit'
  );
  assert.equal(fs.readFileSync(path.join(repo, 'alpha.txt'), 'utf8').replaceAll('\r\n', '\n'), 'alpha changed in external IDE\n');

  await assert.rejects(
    () => readTaskCodeFile(config, { taskId, path: '../outside.txt' }),
    /Code editor path|traversal|outside/i,
    'code access must preserve the repository safe-path boundary'
  );

  const integrity = readTaskIntegrity(config, taskId, 'app');
  assert.deepEqual(
    new Set(integrity.taskOwnedChangedFiles),
    new Set(['alpha.txt', 'beta.txt']),
    'editor writes must remain attributed to the active task'
  );

  console.log('Task code workspace visible editing, diffing, ownership filtering, and stale-save protection passed.');
} finally {
  await repositoryIntelligence.shutdown();
  await flushAuditWrites();
  await flushTaskHistoryPersistence();
  resetTaskHistoryCaches();
  resetToolActivity();
  await flushLocalAnalytics();
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 50 });
}
