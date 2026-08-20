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
        context: { snapshotMaxFiles: 321 }
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

  for (const staleAction of ['remove', 'rename', 'prune-tests', 'prune-stale-tests']) {
    assert.throws(
      () => updateWorkspace(saved, { action: staleAction, alias: 'beta' }),
      /Unknown workspace action/,
      `${staleAction} must not survive as a compatibility workspace action`
    );
  }

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

  const sourceFile = path.join(second, 'keep-me.txt');
  fs.writeFileSync(sourceFile, 'local project data');
  assert.throws(
    () => updateWorkspace(saved, { action: 'delete', alias: 'beta' }),
    /requires confirmDelete=true/,
    'project deletion must require explicit confirmation'
  );
  const deleted = updateWorkspace(saved, { action: 'delete', alias: 'beta', confirmDelete: true });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.config.workspaces.some(item => item.alias === 'beta'), false, 'deletion removes only the Rel.AI project entry');
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), 'local project data', 'deleting a project from Rel.AI must never delete source files');
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('Workspace management unit passed');
