import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TASKS_EXTENSION_ID } from '../src/mcp/protocol.js';
import { createHttpMcpSession, postMcp } from './helpers/http-mcp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-native-tasks-http-'));
const workspaceDir = path.join(stateDir, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });
fs.writeFileSync(path.join(workspaceDir, 'README.md'), '# Transport test workspace' + String.fromCharCode(10));
const configPath = path.join(stateDir, 'config.json');
const tokenA = 'relai-http-native-token-a';
const tokenB = 'relai-http-native-token-b';
const tasksCapabilities = { extensions: { [TASKS_EXTENSION_ID]: {} } };
const port = await freePort();
const base = `http://127.0.0.1:${port}`;

fs.writeFileSync(configPath, `${JSON.stringify({
  version: 2,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  toolMode: 'chatgpt_local_repo',
  trustedLocalAgent: true,
  maxOutputBytes: 2 * 1024 * 1024,
  telemetry: { enabled: false, endpoint: '', sampleRatio: 1 },
  processEnvironment: { allow: [] },
  workspaces: {
    repo: {
      path: workspaceDir,
      protectedBranches: ['main', 'master'],
      defaultBaseBranch: 'main',
      allowedRemotes: ['origin'],
      context: { snapshotMaxFiles: 3000, includeRoots: [], excludePaths: ['.git', 'node_modules', 'build', 'dist', 'coverage'] },
      testCommands: {},
      commands: {}
    }
  }
}, null, 2)}\n`);
writeOAuthStore();

const child = spawn(process.execPath, [
  path.join(root, 'bin', 'rel-ai-mcp-http.js'),
  '--host', '127.0.0.1',
  '--port', String(port),
  '--no-profile-write'
], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: configPath,
    REL_AI_MCP_STATE_DIR: stateDir,
    REL_AI_MCP_TOKEN: 'http-native-approval-token'
  }
});
let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

let nativeSession;
let synchronousSession;
let otherPrincipalSession;
try {
  await waitForHealth();
  nativeSession = await createHttpMcpSession(base, {
    token: tokenA,
    clientName: 'http-native-client',
    capabilities: tasksCapabilities
  });
  synchronousSession = await createHttpMcpSession(base, {
    token: tokenA,
    clientName: 'http-sync-client',
    capabilities: {}
  });
  otherPrincipalSession = await createHttpMcpSession(base, {
    token: tokenB,
    clientName: 'http-other-client',
    capabilities: tasksCapabilities
  });

  const unauthenticated = await postMcp(base, {
    id: 100,
    method: 'tasks/get',
    params: { taskId: 'task_unknown' },
    capabilities: tasksCapabilities,
    name: 'task_unknown'
  });
  assert.equal(unauthenticated.response.status, 401, 'authentication must precede task dispatch');

  const nativeLogicalTask = await startLogicalTask(nativeSession, 'HTTP native Tasks parity');
  const nativeStart = await nativeSession.request('tools/call', {
    name: 'relai_exec',
    arguments: {
      workspace: 'repo',
      work_id: nativeLogicalTask,
      command: quickCommand('transport-parity'),
      timeoutMs: 15000,
      maxOutputBytes: 65536
    }
  });
  assert.equal(nativeStart.response.status, 200, JSON.stringify(nativeStart.body));
  assert.equal(nativeStart.body.error, undefined);
  assert.equal(nativeStart.body.result.resultType, 'task');
  assert.match(nativeStart.body.result.taskId, /^task_/);
  const nativeTaskId = nativeStart.body.result.taskId;

  const denied = await otherPrincipalSession.request('tasks/get', { taskId: nativeTaskId });
  assert.equal(denied.body.error.code, -32602);
  assert.match(denied.body.error.message, /not available to this client/i);

  const unsupportedGet = await synchronousSession.request('tasks/get', { taskId: nativeTaskId });
  assert.equal(unsupportedGet.body.error.code, -32021);

  const nativeFinal = await waitForTerminal(nativeSession, nativeTaskId);
  assert.equal(nativeFinal.status, 'completed', JSON.stringify(nativeFinal));
  assert.equal(nativeFinal.result.structuredContent.ok, true, JSON.stringify(nativeFinal.result));

  const synchronousLogicalTask = await startLogicalTask(synchronousSession, 'HTTP bounded synchronous parity');
  const synchronous = await synchronousSession.request('tools/call', {
    name: 'relai_exec',
    arguments: {
      workspace: 'repo',
      work_id: synchronousLogicalTask,
      command: quickCommand('transport-parity'),
      timeoutMs: 5000,
      maxOutputBytes: 65536
    }
  });
  assert.equal(synchronous.response.status, 200, JSON.stringify(synchronous.body));
  assert.equal(synchronous.body.error, undefined);

  assert.equal(synchronous.body.result.taskId, undefined, 'client without Tasks capability must not receive a task handle');
  assert.equal(synchronous.body.result.structuredContent.ok, true, JSON.stringify(synchronous.body.result));
  assert.equal(
    synchronous.body.result.structuredContent.stdout,
    nativeFinal.result.structuredContent.stdout,
    'native and bounded synchronous modes must execute the same domain operation'
  );
  assert.equal(synchronous.body.result.structuredContent.exitCode, nativeFinal.result.structuredContent.exitCode);

  const invalidUpdate = await nativeSession.request('tasks/update', {
    taskId: nativeTaskId,
    inputResponses: { approval: { approved: true } }
  });
  assert.equal(invalidUpdate.body.error.code, -32602);

  const cancelLogicalTask = await startLogicalTask(nativeSession, 'HTTP native cancellation');
  const cancellable = await nativeSession.request('tools/call', {
    name: 'relai_exec',
    arguments: {
      workspace: 'repo',
      work_id: cancelLogicalTask,
      command: delayCommand(5000),
      timeoutMs: 15000,
      maxOutputBytes: 65536
    }
  });
  assert.equal(cancellable.body.result.resultType, 'task');
  const cancellation = await nativeSession.request('tasks/cancel', { taskId: cancellable.body.result.taskId });
  assert.equal(cancellation.body.error, undefined);
  const cancelled = await waitForTerminal(nativeSession, cancellable.body.result.taskId);
  assert.equal(cancelled.status, 'cancelled', JSON.stringify(cancelled));

  console.log('HTTP native Tasks negotiation, bounded fallback, authorization, lifecycle routes, parity, and cancellation passed.');
} finally {
  await nativeSession?.close().catch(() => {});
  await synchronousSession?.close().catch(() => {});
  await otherPrincipalSession?.close().catch(() => {});
  child.kill('SIGTERM');
  await once(child, 'close').catch(() => {});
  fs.rmSync(stateDir, { recursive: true, force: true });
}

async function startLogicalTask(session, title) {
  const response = await session.request('tools/call', {
    name: 'relai_work',
    arguments: { action: 'begin', workspace: 'repo', title }
  });
  assert.equal(response.response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.error, undefined);
  const taskId = response.body.result?.structuredContent?.work_id;
  assert.ok(taskId, JSON.stringify(response.body));
  return taskId;
}

async function waitForTerminal(session, taskId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await session.request('tasks/get', { taskId });
    assert.equal(response.response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.error, undefined, JSON.stringify(response.body));
    const task = response.body.result;
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Native HTTP task ${taskId} did not reach a terminal state. stdout=${stdout} stderr=${stderr}`);
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`HTTP MCP server did not become healthy. stdout=${stdout} stderr=${stderr}`);
}

function quickCommand(text) {
  return `node -e "process.stdout.write('${text}')"`;
}

function delayCommand(milliseconds) {
  return `node -e "setTimeout(() => {}, ${milliseconds})"`;
}

function writeOAuthStore() {
  const now = Date.now();
  const clients = {
    'http-client-a': oauthClient('http-client-a', now),
    'http-client-b': oauthClient('http-client-b', now)
  };
  const accessTokens = {
    [secretKey(tokenA)]: oauthGrant('http-client-a', now),
    [secretKey(tokenB)]: oauthGrant('http-client-b', now)
  };
  fs.writeFileSync(path.join(stateDir, 'oauth-store.json'), `${JSON.stringify({
    version: 6,
    clients,
    codes: {},
    accessTokens,
    refreshTokens: {},
    registrationAttempts: {},
    approvalRequiredAt: null,
    lastApprovedAt: now
  }, null, 2)}\n`);
}

function oauthClient(clientId, now) {
  return {
    client_id: clientId,
    client_name: clientId,
    application_type: 'web',
    redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    registered_scope: 'mcp',
    granted_scope: 'mcp',
    issuer: base,
    created_at: now
  };
}

function oauthGrant(clientId, now) {
  return {
    issuer: base,
    clientId,
    scope: 'mcp',
    resource: `${base}/mcp`,
    issuedAt: now,
    expiresAt: now + 60 * 60 * 1000
  };
}

function secretKey(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const selected = typeof address === 'object' && address ? address.port : 0;
  await new Promise(resolve => server.close(resolve));
  if (!selected) throw new Error('Unable to allocate an HTTP test port.');
  return selected;
}
