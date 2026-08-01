import { callTool } from "../src/tools.js";
import { readTaskHistorySession } from "../src/taskHistoryStore.js";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-observability-integration-'));
const workspacePath = path.join(sandbox, 'repo');
const stateDir = path.join(sandbox, 'state');
const configPath = path.join(sandbox, 'config.json');
fs.mkdirSync(workspacePath, { recursive: true });
fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ name: 'fixture' }, null, 2));
fs.writeFileSync(path.join(workspacePath, 'src.txt'), 'session activity model\n');
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  trustedLocalAgent: true,
  maxOutputBytes: 1048576,
  workspaces: { repo: { path: workspacePath } }
}, null, 2));

const previousConfig = process.env.REL_AI_MCP_CONFIG;
process.env.REL_AI_MCP_CONFIG = configPath;

try {


  const context = { publicHttpOnly: true, requestId: 'request-1', serverInstanceId: 'server-1', transportType: 'streamable-http' };

  const started = await callTool('relai_begin_work', {
    workspace: 'repo',
    title: 'Inspect session activity model',
    objective: 'Verify canonical task and activity persistence.'
  }, context);
  assert.ok(started.work_id);
  assert.equal(started.title, 'Inspect session activity model');

  const read = await callTool('relai_read', {
    workspace: 'repo',
    work_id: started.work_id,
    paths: ['package.json', 'src.txt']
  }, { ...context, requestId: 'request-2' });
  assert.equal(read.ok, true);

  await callTool('relai_finish_work', {
    workspace: 'repo',
    work_id: started.work_id,
    summary: 'Inspected and verified session activity persistence.'
  }, { ...context, requestId: 'request-3' });

  const session = readTaskHistorySession({ stateDir, auditLogPath: path.join(stateDir, 'audit.jsonl') }, started.work_id);
  assert.equal(session.title, 'Inspect session activity model');
  assert.equal(session.objective, 'Verify canonical task and activity persistence.');
  assert.equal(session.status, 'completed');
  assert.equal(session.progress.mode, 'complete');
  assert.equal(session.progress.percentage, 100);
  assert.equal(session.toolCallCount, 3);
  assert.equal(session.failedToolCallCount, 0);
  assert.equal(session.resultSummary, 'Inspected and verified session activity persistence.');
  assert.equal(session.correlation.requestId, 'request-1');
  assert.equal(session.correlation.workspaceId, 'repo');
  assert.equal(session.events.length, 3, 'one canonical lifecycle event must be persisted per tool call');
  assert.deepEqual(session.events.map(event => event.sequence), [1, 2, 3]);
  assert.equal(session.events.every(event => event.taskId === started.work_id && event.sessionId === started.work_id), true);
  assert.equal(session.events.find(event => event.tool?.name === 'relai_read')?.result?.affectedItemCount, 2);
  assert.equal(session.events.at(-1)?.status, 'succeeded');
  assert.match(session.events[0]?.summary, /Started logical task/);
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('End-to-end tool execution persists canonical task and activity lifecycle records.');
