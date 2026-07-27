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

const { callTool } = require(path.join(root, 'src', 'tools.js'));
const { toolResult } = require(path.join(root, 'src', 'mcpServer.js'));

try {
  const output = await callTool('relai_read', {
    workspace: 'repo',
    paths: ['big.txt'],
    maxBytes: 256 * 1024,
    guidanceMode: 'none'
  }, { publicHttpOnly: true, requestId: 1, transportType: 'test' });
  const result = toolResult(output, false);
  assert.equal(result.isError, false);
  assert.ok(Array.isArray(result.structuredContent?.items), 'connector result must retain the relai_read item array');
  const item = result.structuredContent.items[0];
  assert.equal(item.returnedBytes, 256 * 1024);
  assert.equal(item.truncated, true);
  assert.equal(result.structuredContent.message, undefined, 'result must not collapse to the generic outer truncation summary');
  assert.match(result.content[0].text, /"items"/, 'text content must include the complete structured read result');

  console.log('Connector read result limit unit test passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
