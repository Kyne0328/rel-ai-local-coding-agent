import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-config-defaults-'));
const configPath = path.join(root, 'config.json');
const workspaceRoot = path.join(root, 'workspace');
fs.mkdirSync(workspaceRoot, { recursive: true });
process.env.REL_AI_MCP_CONFIG = configPath;

try {
  const { makeDefaultConfig, makeDefaultContextConfig } = await import('../src/config.js');
  const { updateWorkspace } = await import('../src/configEditor.js');

  const defaults = makeDefaultContextConfig();
  assert.ok(defaults.excludePaths.includes('.rel-ai-mcp-state'), 'canonical defaults must exclude Rel.AI state');

  const current = makeDefaultConfig();
  current.stateDir = path.join(root, 'state');
  updateWorkspace(current, {
    action: 'upsert',
    alias: 'fixture',
    mode: 'create',
    path: workspaceRoot
  });

  const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(
    persisted.workspaces.fixture.context,
    defaults,
    'config editing must consume the same canonical context defaults as config loading'
  );

  const editorSource = fs.readFileSync(new URL('../src/configEditor.js', import.meta.url), 'utf8');
  assert.equal(editorSource.includes('const DEFAULT_CONTEXT'), false, 'config editor must not retain a second context-default owner');
  console.log('Configuration default ownership parity tests passed.');
} finally {
  delete process.env.REL_AI_MCP_CONFIG;
  fs.rmSync(root, { recursive: true, force: true });
}
