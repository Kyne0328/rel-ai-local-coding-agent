import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readAudit } from '../src/audit.js';
import { readLocalUsageSnapshot } from '../src/localAnalytics.js';
import { startMcpClient, structuredContentOf } from './helpers/mcp-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-stdio-shutdown-persistence-'));
const stateDir = path.join(temp, 'state');
const workspacePath = path.join(temp, 'workspace');
const configPath = path.join(temp, 'config.json');
const config = {
  version: 3,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: {
    repo: { path: workspacePath, commands: {}, testCommands: {} }
  }
};
fs.mkdirSync(workspacePath, { recursive: true });
fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ name: 'stdio-shutdown-fixture' }));
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

const client = startMcpClient({
  root,
  configPath,
  env: { REL_AI_MCP_STATE_DIR: stateDir },
  timeoutMs: 15_000
});

try {
  client.initialize(1);
  await client.waitFor(1);
  client.call(2, 'relai_work', { action: 'begin', workspace: 'repo', bootstrap: 'none' });
  const started = structuredContentOf(await client.waitFor(2));
  assert.match(started.work_id || '', /^[0-9a-f-]{36}$/i);

  // Close immediately after the tool response. Delayed audit/analytics writes must
  // be flushed by the stdio server shutdown path rather than lost with the process.
  await client.closeGracefully();

  const audit = readAudit(config, { workspace: 'repo', limit: 50 });
  assert.ok(audit.entries.some(entry => entry.publicTool === 'relai_work' && entry.taskId === started.work_id),
    'stdio shutdown must flush the completed public tool audit record to disk');

  const usage = readLocalUsageSnapshot(config);
  const relaiWork = usage.tools.find(item => item.tool === 'relai_work');
  assert.ok(Number(relaiWork?.toolCalls || 0) >= 1,
    'stdio shutdown must flush local analytics for the completed tool call to disk');
} finally {
  await client.closeGracefully().catch(() => {});
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('stdio shutdown flushes audit and local analytics persistence before exit.');
