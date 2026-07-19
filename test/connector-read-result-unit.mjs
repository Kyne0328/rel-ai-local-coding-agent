import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-connector-result-'));
const wsRoot = path.join(tmp, 'repo');
const stateDir = path.join(tmp, 'state');
const configPath = path.join(tmp, 'config.json');
fs.mkdirSync(wsRoot, { recursive: true });
fs.writeFileSync(path.join(wsRoot, 'big.txt'), 'x'.repeat(400000));
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  trustedBudgetMultiplier: 2,
  workspaces: {
    repo: {
      path: wsRoot,
      testCommands: {},
      commands: {}
    }
  }
}, null, 2));
process.env.REL_AI_MCP_CONFIG = configPath;

const { handleMessage } = require(path.join(root, 'src', 'server.js'));

try {
  const response = await handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'relai_read',
      arguments: {
        workspace: 'repo',
        paths: ['big.txt'],
        maxBytes: 256 * 1024,
        guidanceMode: 'none'
      }
    }
  }, {
    publicHttpOnly: true,
    taskScopeId: 'test:connector-read-result-limit'
  });

  const toolResult = response.result;
  assert.equal(toolResult.isError, false);
  assert.ok(Array.isArray(toolResult.structuredContent?.items), 'connector result must retain the relai_read item array');
  const item = toolResult.structuredContent.items[0];
  assert.equal(item.returnedBytes, 256 * 1024);
  assert.equal(item.truncated, true);
  assert.equal(toolResult.structuredContent.message, undefined, 'result must not collapse to the generic outer truncation summary');
  assert.match(toolResult.content[0].text, /"items"/, 'text content must include the complete structured read result');

  console.log('Connector read result limit unit test passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
