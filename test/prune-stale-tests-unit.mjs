import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Isolate config writes to a temp config file before requiring config-backed modules.
// Setting only REL_AI_MCP_STATE_DIR is not enough: getConfigPath() otherwise still
// points at the user's real ~/.rel-ai-mcp/config.json, and this test can overwrite
// their saved workspaces with the temporary "myapp" fixture.
const previousConfigPath = process.env.REL_AI_MCP_CONFIG;
const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-prune-state-'));
const configPath = path.join(stateDir, 'config.json');
process.env.REL_AI_MCP_STATE_DIR = stateDir;
process.env.REL_AI_MCP_CONFIG = configPath;

const { updateWorkspace } = require('../src/configEditor.js');
const { readConfig } = require('../src/config.js');

// Workspace with a package.json exposing only `test` and `build` scripts.
const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-prune-ws-'));

try {
  fs.writeFileSync(path.join(wsDir, 'package.json'), JSON.stringify({ scripts: { test: 'node t.js', build: 'node b.js' } }));

  const config = {
    stateDir,
    workspaces: {
      myapp: {
        path: wsDir,
        commands: {
          'npm:build': 'npm run build',
          'npm:gone-command': 'npm run gone-command'
        },
        testCommands: {
          'npm:test': 'npm run test',       // valid — matches a discovered script
          'npm:test:v4': 'npm run test:v4', // stale — no such script
          'npm:legacy': 'old custom cmd'    // stale — not a discovered command
        }
      }
    }
  };

  // 1. prune removes only the stale keys, keeps the valid one
  {
    const result = updateWorkspace(config, { action: 'prune-stale-tests', alias: 'myapp' });
    assert.equal(result.ok, true, 'prune: ok');
    assert.deepEqual([...result.removed].sort((a, b) => a.localeCompare(b)), ['npm:gone-command', 'npm:legacy', 'npm:test:v4'], 'prune: removes stale regular and test commands');
    const ws = result.config.workspaces.find((w) => w.alias === 'myapp');
    assert.deepEqual(ws.commandKeys, ['npm:build'], 'prune: keeps the valid regular command');
    assert.deepEqual(ws.testCommandKeys, ['npm:test'], 'prune: keeps the valid key');
    assert.deepEqual(ws.staleTestCommandKeys || [], [], 'prune: no stale keys remain');
  }

  // 2. prune is a no-op when nothing is stale
  {
    const current = readConfig();
    const result = updateWorkspace(current, { action: 'prune-stale-tests', alias: 'myapp' });
    assert.equal(result.ok, true, 'prune no-op: ok');
    assert.deepEqual(result.removed, [], 'prune no-op: nothing removed');
  }

  // 3. refuses when the workspace path is unavailable (cannot tell stale from valid)
  {
    const missing = path.join(os.tmpdir(), 'relai-prune-missing-' + Date.now());
    const cfg = { stateDir, workspaces: { gone: { path: missing, testCommands: { 'npm:test': 'npm run test' } } } };
    assert.throws(
      () => updateWorkspace(cfg, { action: 'prune-stale-tests', alias: 'gone' }),
      /unavailable/,
      'prune: refuses when the workspace path is unavailable'
    );
  }
} finally {
  if (previousConfigPath == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfigPath;
  if (previousStateDir == null) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(wsDir, { recursive: true, force: true });
}

console.log('prune-stale-tests unit tests passed.');
