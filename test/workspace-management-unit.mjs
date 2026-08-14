import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { updateWorkspace } from "../src/configEditor.js";
import { resolveWorkspace, resolveWorkspaceInput, normalizeWorkspacePathForComparison } from "../src/config.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-workspace-management-'));
const configPath = path.join(tmp, 'config.json');
const previousConfig = process.env.REL_AI_MCP_CONFIG;
process.env.REL_AI_MCP_CONFIG = configPath;

try {
  const first = path.join(tmp, 'first');
  const second = path.join(tmp, 'second');
  fs.mkdirSync(first, { recursive: true });
  fs.mkdirSync(second, { recursive: true });
  const current = {
    stateDir: tmp,
    workspaces: {
      alpha: {
        path: first,
        context: { snapshotMaxFiles: 321 },
        testCommands: { test: 'npm test' }
      }
    }
  };
  fs.writeFileSync(configPath, JSON.stringify(current, null, 2));

  const renamed = updateWorkspace(current, {
    action: 'upsert',
    mode: 'update',
    originalAlias: 'alpha',
    alias: 'beta',
    path: second,
    enforceUniquePath: true
  });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.renamedFrom, 'alpha');
  assert.equal(renamed.config.workspaces.some(item => item.alias === 'alpha'), false);
  const beta = renamed.config.workspaces.find(item => item.alias === 'beta');
  assert.equal(beta.path, second);
  assert.equal(beta.context.snapshotMaxFiles, 321);
  assert.deepEqual(beta.testCommandKeys, ['test']);

  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(saved.workspaces.alpha, undefined);
  assert.equal(saved.workspaces.beta.path, second);

  assert.throws(() => updateWorkspace(saved, {
    action: 'upsert',
    mode: 'create',
    alias: 'beta',
    path: first,
    enforceUniquePath: true
  }), /already exists/);

  assert.throws(() => updateWorkspace(saved, {
    action: 'upsert',
    mode: 'create',
    alias: 'duplicate-path',
    path: second,
    enforceUniquePath: true
  }), /already configured as workspace 'beta'/);

  const unchanged = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(unchanged, saved, 'failed duplicate operations must not partially rename or rewrite configuration');

  const resolvedByAlias = resolveWorkspace(saved, 'beta');
  const resolvedByPath = resolveWorkspace(saved, second + path.sep);
  assert.equal(resolvedByPath.alias, 'beta');
  assert.equal(resolvedByPath.path, resolvedByAlias.path);
  assert.equal(resolveWorkspaceInput(saved, second).source, 'configured_path');
  assert.equal(normalizeWorkspacePathForComparison('C:\\Dev\\Repo\\', 'win32'), 'c:\\dev\\repo');
  assert.equal(normalizeWorkspacePathForComparison('C:/DEV/Repo/', 'win32'), 'c:\\dev\\repo');
  assert.equal(normalizeWorkspacePathForComparison('\\\\Server\\Share\\Repo\\', 'win32'), '\\\\server\\share\\repo');
  assert.throws(() => resolveWorkspace(saved, first), error => error?.code === 'WORKSPACE_PATH_NOT_CONFIGURED');
  assert.throws(() => resolveWorkspace(saved, path.join(second, 'nested')), error => error?.code === 'WORKSPACE_PATH_UNAVAILABLE');
  fs.mkdirSync(path.join(second, 'nested'));
  assert.throws(() => resolveWorkspace(saved, path.join(second, 'nested')), error => error?.code === 'WORKSPACE_PATH_NOT_CONFIGURED');
  assert.throws(() => resolveWorkspace({ workspaces: { one: { path: second }, two: { path: second } } }, second), error => error?.code === 'WORKSPACE_PATH_AMBIGUOUS');

  const linked = path.join(tmp, 'linked-second');
  try {
    fs.symlinkSync(second, linked, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(resolveWorkspace(saved, linked).alias, 'beta', 'realpath-equivalent configured paths must match');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) throw error;
  }
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('Workspace management unit passed');
