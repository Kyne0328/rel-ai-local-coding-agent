import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { relaiExec } from '../src/bridge/exec.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-exec-dirty-mutation-'));
const workspacePath = path.join(root, 'workspace');
const scriptPath = path.join(workspacePath, 'mutate.js');
const dirtyPath = path.join(workspacePath, 'dirty.txt');
const workspace = { alias: 'app', path: workspacePath };
const config = {};

function quote(value) {
  const text = String(value);
  if (process.platform === 'win32') return `'${text.replaceAll("'", "''")}'`;
  return `'${text.replaceAll("'", `'"'"'`)}'`;
}

try {
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.writeFileSync(dirtyPath, 'committed\n');
  fs.writeFileSync(scriptPath, "require('node:fs').writeFileSync(process.argv[2], 'changed again\\n');\n");
  execFileSync('git', ['init'], { cwd: workspacePath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'relai@example.test'], { cwd: workspacePath });
  execFileSync('git', ['config', 'user.name', 'RelAI Test'], { cwd: workspacePath });
  execFileSync('git', ['add', '.'], { cwd: workspacePath });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: workspacePath, stdio: 'ignore' });
  fs.writeFileSync(dirtyPath, 'already dirty\n');

  const command = process.platform === 'win32'
    ? `& ${quote(process.execPath)} ${quote(scriptPath)} ${quote('dirty.txt')}`
    : `${quote(process.execPath)} ${quote(scriptPath)} ${quote('dirty.txt')}`;
  const result = await relaiExec(workspace, config, { command });
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedFiles, ['dirty.txt']);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('relai_exec detects mutations to files that were already dirty before the command.');