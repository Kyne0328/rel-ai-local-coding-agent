import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createValidationFingerprint } from '../src/bridge/validationPlan.js';
import { relaiVerify } from '../src/bridge/validation.js';
import { recordTaskHistoryEvent, recordWorkflowEvidence } from '../src/taskHistoryStore.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-validation-reuse-'));
const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-validation-state-'));
const config = { stateDir: stateRoot };
try {
  fs.mkdirSync(path.join(root, 'front-end'), { recursive: true });
  fs.writeFileSync(path.join(root, 'front-end', 'package.json'), JSON.stringify({ scripts: { test: `node -e "require('fs').writeFileSync('duplicate-marker.txt','ran')"` } }));
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
  const workspace = { alias: 'repo', path: root, commands: {}, testCommands: {} };
  const fingerprint = (await createValidationFingerprint(workspace, config)).fingerprint;
  recordTaskHistoryEvent(config, { taskId: 'task-1', taskHistoryEligible: true, taskIdentityVersion: 2, taskIdExplicit: true, tool: 'work.begin', workspace: 'repo', ok: true, ts: new Date().toISOString() });
  recordWorkflowEvidence(config, 'task-1', {
    version: 1, key: 'check:front', kind: 'check', sourceTool: 'relai_exec', createdAt: new Date().toISOString(),
    commandId: 'npm:front-end:test', command: 'npm test', cwd: 'front-end', outcome: 'passed', repositoryFingerprint: fingerprint,
    mutationGeneration: 0, workspaceGeneration: 0, paths: [], metadata: { exitCode: 0 }
  });
  const result = await relaiVerify(workspace, config, { checks: ['npm:front-end:test'] }, { taskId: 'task-1' });
  assert.equal(result.ok, true);
  assert.equal(result.executedUnits, 0);
  assert.equal(result.reusedUnits, 1);
  assert.deepEqual(result.reusedChecks, ['npm:front-end:test']);
  assert.equal(fs.existsSync(path.join(root, 'front-end', 'duplicate-marker.txt')), false, 'exact fresh evidence must avoid duplicate execution');
  assert.equal(JSON.stringify(result).includes('stdout'), false, 'reused evidence must not replay prior stdout');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Exact fresh validation evidence reuse tests passed.');