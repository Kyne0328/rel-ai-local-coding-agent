import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { flushAuditWrites } from '../src/audit.js';
import { callTool as rawCallTool } from '../src/tools.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';
import { resetToolActivity } from '../src/toolActivity.js';

const callTool = (name, args, context = {}) => rawCallTool(name, args, { principal: 'local:trusted', ...context });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-atomic-validation-race-'));
const workspacePath = path.join(root, 'workspace');
const stateDir = path.join(root, 'state');
const configPath = path.join(root, 'config.json');
const previousConfig = process.env.REL_AI_MCP_CONFIG;
const validationStartedPath = path.join(root, 'validation-started');
const validationReleasePath = path.join(root, 'validation-release');

fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true });
fs.writeFileSync(path.join(workspacePath, 'src', 'index.js'), 'export const ready = true;\n');
fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({
  type: 'module',
  scripts: { check: 'node --check src/index.js' }
}, null, 2));
fs.writeFileSync(path.join(workspacePath, 'validation-gate.mjs'), `
import fs from 'node:fs';
import path from 'node:path';
const started = ${JSON.stringify(validationStartedPath)};
const release = ${JSON.stringify(validationReleasePath)};
fs.writeFileSync(started, 'ready\\n');
const finish = () => {
  if (!fs.existsSync(release)) return false;
  clearTimeout(timeout);
  watcher?.close();
  process.exit(0);
};
let watcher = null;
const timeout = setTimeout(() => {
  watcher?.close();
  console.error('validation gate timed out');
  process.exit(2);
}, 10_000);
if (!finish()) {
  watcher = fs.watch(path.dirname(release), () => { finish(); });
  finish();
}
`);
execFileSync('git', ['init'], { cwd: workspacePath, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'relai@example.test'], { cwd: workspacePath });
execFileSync('git', ['config', 'user.name', 'RelAI Test'], { cwd: workspacePath });
execFileSync('git', ['add', '.'], { cwd: workspacePath });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: workspacePath, stdio: 'ignore' });
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: {
    app: {
      path: workspacePath,
      commands: {},
      testCommands: { check: 'npm run check' }
    }
  }
}, null, 2));
process.env.REL_AI_MCP_CONFIG = configPath;

const context = { publicHttpOnly: true };

async function startTask(title) {
  const result = await callTool('relai_work', {
    action: 'begin',
    workspace: 'app',
    bootstrap: 'none',
    title
  }, context);
  assert.ok(result.work_id);
  return result.work_id;
}

function waitForFile(file, timeoutMs = 10_000) {
  if (fs.existsSync(file)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const directory = path.dirname(file);
    const expected = path.basename(file);
    const watcher = fs.watch(directory, (_event, filename) => {
      if (String(filename || '') !== expected && !fs.existsSync(file)) return;
      if (!fs.existsSync(file)) return;
      cleanup();
      resolve();
    });
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${expected}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      watcher.close();
    };
    if (fs.existsSync(file)) {
      cleanup();
      resolve();
    }
  });
}

try {
  resetToolActivity();
  const primaryTask = await startTask('Atomic validation primary writer');
  const validatingTask = await startTask('Atomic validation secondary writer');

  await callTool('relai_edit', {
    workspace: 'app',
    work_id: validatingTask,
    path: 'src/atomic-race.js',
    content: 'export const atomicValue = 1;\n'
  }, context);

  const validationStarted = waitForFile(validationStartedPath);
  const completionPromise = callTool('relai_validate', {
    action: 'checks',
    workspace: 'app',
    work_id: validatingTask,
    checks: ['node validation-gate.mjs'],
    complete: true,
    summary: 'Atomic completion synchronized and revalidated relevant concurrent changes internally.'
  }, context);

  await validationStarted;
  await callTool('relai_edit', {
    workspace: 'app',
    work_id: primaryTask,
    path: 'src/atomic-race.js',
    oldText: 'export const atomicValue = 1;',
    newText: 'export const atomicValue = 1;\nexport const concurrentValue = 2;'
  }, context);
  fs.writeFileSync(validationReleasePath, 'release\\n');

  const completion = await completionPromise;
  assert.equal(completion.ok, true, 'relevant concurrent Rel.AI changes must trigger one internal locked revalidation instead of a user-visible retry');
  assert.equal(completion.completionKnown, true);
  assert.equal(completion.work_id, validatingTask);
  assert.equal(completion.completionSource, 'relai_validate:checks');

  await callTool('relai_work', {
    action: 'cancel',
    workspace: 'app',
    work_id: primaryTask,
    reason: 'Atomic race regression complete.'
  }, context);
} finally {
  await flushAuditWrites();
  repositoryIntelligence.shutdown();
  resetToolActivity();
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

console.log('Atomic validation resolves one relevant Rel.AI race internally under the source-workspace lock.');
// Nested raw tool calls can leave Windows piped stdio referenced after app resources close.
// Teardown above is complete, so exit explicitly to keep this isolated integration test deterministic.
process.exit(0);
