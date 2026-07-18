import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-completion-'));
const workspace = path.join(temp, 'workspace');
const stateDir = path.join(temp, 'state');
const configPath = path.join(temp, 'config.json');
const previousConfig = process.env.REL_AI_MCP_CONFIG;

fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'src', 'index.js'), 'console.log("ready");\n', 'utf8');
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
  scripts: { check: 'node --check src/index.js' }
}, null, 2), 'utf8');
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir,
  patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 },
  workspaces: {
    app: {
      path: workspace,
      commands: {},
      testCommands: { check: 'npm run check' }
    }
  }
}, null, 2), 'utf8');
process.env.REL_AI_MCP_CONFIG = configPath;

try {
  const { callTool } = require('../src/tools.js');
  const { getToolActivity, resetToolActivity } = require('../src/toolActivity.js');
  const { readConfig } = require('../src/config.js');
  const { readAudit } = require('../src/audit.js');
  const { resolvePolicy } = require('../src/policyResolver.js');

  resetToolActivity();
  await assert.rejects(
    () => callTool('relai_complete_task', {
      workspace: 'app',
      summary: 'No validation was run.'
    }, { publicHttpOnly: true, taskScopeId: 'completion-without-validation' }),
    /no successful final validation/i
  );

  resetToolActivity();
  const context = { publicHttpOnly: true, taskScopeId: 'validated-completion' };
  const validation = await callTool('relai_run_checks', {
    workspace: 'app',
    level: 'standard'
  }, context);
  assert.equal(validation.ok, true);
  assert.equal(validation.validationStatus, 'passed');
  assert.match(validation.nextAction, /call relai_complete_task exactly once/i);

  const completion = await callTool('relai_complete_task', {
    workspace: 'app',
    summary: 'Implemented and validated the requested code changes.'
  }, context);
  assert.equal(completion.ok, true);
  assert.equal(completion.completionKnown, true);
  assert.equal(completion.endReason, 'explicit_completion');
  assert.equal(completion.validationStatus, 'passed');
  assert.equal(resolvePolicy({ alias: 'app', path: workspace }, readConfig()).sessionActive, false, 'explicit completion must clear workspace ownership state');

  const status = getToolActivity();
  assert.equal(status.state, 'idle');
  assert.equal(status.lastTask.status, 'completed');
  assert.equal(status.lastTask.completionKnown, true);
  assert.equal(status.lastTask.endReason, 'explicit_completion');
  assert.equal(status.lastTask.summary, 'Implemented and validated the requested code changes.');

  const audit = readAudit(readConfig(), { limit: 100 });
  const completionEvent = audit.entries.find(entry => entry.tool === 'relai_complete_task' && entry.ok === true);
  assert.ok(completionEvent, 'completion must be persisted in the audit log');
  assert.equal(completionEvent.completionKnown, true);
  assert.equal(completionEvent.endReason, 'explicit_completion');
  assert.equal(completionEvent.taskSummary, 'Implemented and validated the requested code changes.');

  resetToolActivity();
  const changedContext = { publicHttpOnly: true, taskScopeId: 'changed-after-validation' };
  await callTool('relai_run_checks', { workspace: 'app', level: 'standard' }, changedContext);
  await callTool('relai_replace', {
    workspace: 'app',
    path: 'src/index.js',
    oldText: 'console.log("ready");',
    newText: 'console.log("changed after validation");'
  }, changedContext);
  await assert.rejects(
    () => callTool('relai_complete_task', {
      workspace: 'app',
      summary: 'This must be rejected.'
    }, changedContext),
    /code changed after the last passed validation/i
  );

  console.log('Explicit task completion validation gate tests passed.');
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(temp, { recursive: true, force: true });
}
