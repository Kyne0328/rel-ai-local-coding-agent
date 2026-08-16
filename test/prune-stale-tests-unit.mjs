import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const previousConfigPath = process.env.REL_AI_MCP_CONFIG;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-command-hard-cut-'));
const configPath = path.join(stateDir, 'config.json');
const workspacePath = path.join(stateDir, 'workspace');
process.env.REL_AI_MCP_CONFIG = configPath;

import { updateWorkspace } from '../src/configEditor.js';
import { invalidateConfigCache, readConfig } from '../src/config.js';

try {
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }, null, 2));
  fs.writeFileSync(configPath, JSON.stringify({
    version: 5,
    stateDir,
    workspaces: {
      app: {
        path: workspacePath,
        commands: { obsolete: 'npm run removed' },
        testCommands: { test: 'npm test', obsolete: 'npm run removed-test' }
      }
    }
  }, null, 2));

  invalidateConfigCache();
  const config = readConfig();
  assert.equal(config.version, 6);
  assert.equal(Object.hasOwn(config.workspaces.app, 'commands'), false);
  assert.equal(Object.hasOwn(config.workspaces.app, 'testCommands'), false);

  const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(persisted.version, 6);
  assert.equal(Object.hasOwn(persisted.workspaces.app, 'commands'), false);
  assert.equal(Object.hasOwn(persisted.workspaces.app, 'testCommands'), false);

  assert.throws(
    () => updateWorkspace(config, { action: 'prune-stale-tests', alias: 'app' }),
    /Unknown workspace action/,
    'manual stale-command pruning must stay removed after the hard cutover'
  );
} finally {
  if (previousConfigPath == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfigPath;
  invalidateConfigCache();
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Legacy command maps migrate away automatically; manual pruning is removed.');
