import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-work-principal-'));
const workspacePath = path.join(root, 'workspace');
const stateDir = path.join(root, 'state');
const configPath = path.join(root, 'config.json');
fs.mkdirSync(workspacePath, { recursive: true });
fs.writeFileSync(path.join(workspacePath, 'probe.txt'), 'principal-bound work session\n');
fs.writeFileSync(configPath, `${JSON.stringify({
  version: 3,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: {
    repo: {
      path: workspacePath,
      commands: {},
      testCommands: {},
      context: { excludePaths: ['.git', 'node_modules'] }
    }
  }
}, null, 2)}\n`);

const previousConfig = process.env.REL_AI_MCP_CONFIG;
const previousState = process.env.REL_AI_MCP_STATE_DIR;
process.env.REL_AI_MCP_CONFIG = configPath;
process.env.REL_AI_MCP_STATE_DIR = stateDir;

try {
  const { callTool } = await import('../src/tools.js');
  const { readTaskHistorySession, readTaskHistorySessionRecord } = await import('../src/taskHistoryStore.js');
  const owner = {
    publicHttpOnly: true,
    transportType: 'test',
    principal: { issuer: 'https://issuer.example', clientId: 'client-a', subject: 'user-a', authMode: 'oauth', scopes: ['mcp'] }
  };
  const sameOwner = {
    ...owner,
    principal: { scopes: ['mcp'], subject: 'user-a', clientId: 'client-a', issuer: 'https://issuer.example', authMode: 'oauth' }
  };
  const otherOwner = {
    ...owner,
    principal: { issuer: 'https://issuer.example', clientId: 'client-a', subject: 'user-b', authMode: 'oauth', scopes: ['mcp'] }
  };

  const started = await callTool('relai_work', { action: 'begin',
    workspace: 'repo',
    title: 'Principal ownership',
    bootstrap: 'none'
  }, owner);
  assert.ok(started.work_id);
  assert.equal(started.identity, 'work_session');
  assert.equal(started.workspace, 'repo');
  assert.equal(started.workspaceBinding, undefined, 'compact begin omits a duplicate workspace binding');

  const continued = await callTool('relai_read', {
    work_id: started.work_id,
    paths: ['probe.txt'],
    guidanceMode: 'none'
  }, sameOwner);
  assert.equal(continued.items[0].content, 'principal-bound work session\n');

  await assert.rejects(
    () => callTool('relai_read', {
      work_id: started.work_id,
      paths: ['probe.txt'],
      guidanceMode: 'none'
    }, otherOwner),
    error => error?.code === 'TASK_NOT_FOUND'
  );

  const privateRecord = readTaskHistorySessionRecord({ stateDir, auditLogPath: path.join(stateDir, 'audit.jsonl') }, started.work_id);
  assert.match(privateRecord.principalFingerprint, /^[A-Za-z0-9_-]{43}$/);
  const publicRecord = readTaskHistorySession({ stateDir, auditLogPath: path.join(stateDir, 'audit.jsonl') }, started.work_id);
  assert.equal(Object.hasOwn(publicRecord, 'principalFingerprint'), false);
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  if (previousState == null) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Work sessions are principal-bound, reconnectable by the same identity, and private ownership is not exposed.');
