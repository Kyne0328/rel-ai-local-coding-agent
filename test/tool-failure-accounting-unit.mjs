import { callTool } from "../src/tools.js";
import { getToolActivity, resetToolActivity } from "../src/toolActivity.js";
import { readAudit } from "../src/audit.js";
import { readConfig } from "../src/config.js";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-tool-failure-'));
const workspace = path.join(temp, 'workspace');
const configPath = path.join(temp, 'config.json');
const auditLogPath = path.join(temp, 'audit.jsonl');
const previous = process.env.REL_AI_MCP_CONFIG;
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { check: 'node -e "process.exit(1)"' } }));
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir: path.join(temp, 'state'),
  auditLogPath,
  workspaces: { app: { path: workspace, commands: {}, testCommands: {} } }
}));
process.env.REL_AI_MCP_CONFIG = configPath;

try {




  resetToolActivity();
  const context = { publicHttpOnly: true };
  const task = await callTool('relai_start_task', { workspace: 'app' }, context);
  const result = await callTool('relai_run_checks', { workspace: 'app', task_id: task.task_id }, context);
  assert.equal(result.ok, false);
  assert.equal(getToolActivity().failures, 1, 'returned ok:false must increment task failures');
  const event = readAudit(readConfig(), { limit: 20 }).entries.find(entry => entry.tool === 'relai_run_checks');
  assert.equal(event.ok, false, 'returned ok:false must be persisted as a failed audit event');
} finally {
  if (previous == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previous;
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Tool returned-failure accounting tests passed.');
