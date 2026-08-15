import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-connector-result-'));
const wsRoot = path.join(tmp, 'repo');
const stateDir = path.join(tmp, 'state');
const configPath = path.join(tmp, 'config.json');
fs.mkdirSync(wsRoot, { recursive: true });
fs.writeFileSync(path.join(wsRoot, 'big.txt'), 'x'.repeat(400000));
const largeLines = Array.from({ length: 9000 }, (_, index) => `line-${String(index + 1).padStart(5, '0')}-${'x'.repeat(72)}`);
const largeText = largeLines.join('\n');
fs.writeFileSync(path.join(wsRoot, 'large-lines.txt'), largeText);
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

const { callTool: rawCallTool } = await import('../src/tools.js');
const { toolResult } = await import('../src/mcpServer.js');
const { repositoryIntelligence } = await import('../src/repository/intelligence/service.js');
const callTool = (name, args, context = {}) => rawCallTool(name, args, { principal: 'local:trusted', ...context });

try {
  const task = await callTool('relai_work', { action: 'begin',
    workspace: 'repo',
    bootstrap: 'none'
  }, { publicHttpOnly: true, requestId: 1, transportType: 'test' });
  const output = await callTool('relai_read', {
    work_id: task.work_id,
    paths: ['big.txt'],
    maxBytes: 256 * 1024,
    guidanceMode: 'none'
  }, { publicHttpOnly: true, requestId: 2, transportType: 'test' });
  const result = toolResult(output, false);
  assert.equal(result.isError, false);
  assert.equal(output.workflow?.unchanged, true, 'passive reads must reuse the current workflow snapshot instead of rebuilding it');
  assert.ok(Array.isArray(result.structuredContent?.items), 'connector result must retain the relai_read item array');
  const item = result.structuredContent.items[0];
  assert.equal(item.returnedBytes, 256 * 1024);
  assert.equal(item.truncated, true);
  assert.equal(result.structuredContent.message, undefined, 'result must not collapse to the generic outer truncation summary');
  assert.match(result.content[0].text, /Rel\.AI operation succeeded\./, 'text content must provide a concise human-readable summary');
  assert.doesNotMatch(result.content[0].text, /"items"/, 'large structured results must not be duplicated into text content');

  const ranged = await callTool('relai_read', {
    work_id: task.work_id,
    paths: ['large-lines.txt'],
    startLine: 4000,
    endLine: 4002,
    maxBytes: 16 * 1024,
    guidanceMode: 'none'
  }, { publicHttpOnly: true, requestId: 3, transportType: 'test' });
  const rangedItem = ranged.items[0];
  assert.equal(rangedItem.content, `${largeLines.slice(3999, 4002).join('\n')}\n`);
  assert.deepEqual(rangedItem.lineRange, { startLine: 4000, endLine: 4002, totalLines: largeLines.length });
  assert.equal(rangedItem.sha256, crypto.createHash('sha256').update(largeText).digest('hex'), 'ranged reads must preserve the authoritative whole-file hash');
  assert.ok(rangedItem.returnedBytes < 1024, 'a small ranged read must not return the whole large file');

  console.log('Connector read result limit and streamed range unit tests passed.');
} finally {
  repositoryIntelligence.shutdown();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
