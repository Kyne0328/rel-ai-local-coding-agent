import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directoryArgument = process.argv.indexOf('--dir');
const packageDirectory = path.resolve(root, directoryArgument >= 0 ? String(process.argv[directoryArgument + 1] || '') : 'dist/build-check/win-unpacked');
const resources = path.join(packageDirectory, 'resources');
const packagedServer = path.join(resources, 'bin', 'rel-ai-mcp-http.js');
assert.equal(fs.existsSync(packagedServer), true, `Packaged backend is missing from ${packageDirectory}. Build the unpacked app before connector acceptance.`);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-packaged-connector-'));
const workspace = path.join(sandbox, 'workspace');
const stateDir = path.join(sandbox, 'state');
const configPath = path.join(sandbox, 'config.json');
const approvalToken = 'packaged-connector-approval-token';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
const port = await availablePort();
const base = `http://127.0.0.1:${port}`;
let child;
let stderr = '';

fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, 'acceptance.txt'), 'packaged connector acceptance\n');
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: {
    acceptance: {
      path: workspace,
      commands: {},
      testCommands: {},
      context: { snapshotMaxFiles: 100, includeRoots: [], excludePaths: ['.git', 'node_modules'] }
    }
  }
}, null, 2));

try {
  child = spawn(process.execPath, [packagedServer, '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
    cwd: resources,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      REL_AI_MCP_CONFIG: configPath,
      REL_AI_MCP_STATE_DIR: stateDir,
      REL_AI_MCP_TOKEN: approvalToken
    }
  });
  child.stderr.on('data', chunk => { stderr += String(chunk || ''); });
  await waitForHealth();

  const challenge = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: mcpHeaders(),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
  });
  assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get('www-authenticate') || '', /resource_metadata=/);

  const registration = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Packaged ChatGPT Acceptance', redirect_uris: [redirectUri] })
  });
  assert.equal(registration.status, 201);
  const client = await registration.json();
  assert.ok(client.client_id);

  const pkce = pkcePair();
  const code = await authorize(client.client_id, pkce.challenge);
  const tokenResponse = await postForm('/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    code_verifier: pkce.verifier
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  assert.ok(tokens.access_token);

  const initialized = await mcp(10, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'packaged-chatgpt-acceptance', version: '1.0.0' }
  }, tokens.access_token);
  assert.ok(initialized.result?.capabilities?.tools);
  assert.ok(initialized.result?.capabilities?.resources);

  const tools = await mcp(11, 'tools/list', {}, tokens.access_token);
  assert.equal(tools.result?.tools?.length, 20);
  const resourcesList = await mcp(12, 'resources/list', {}, tokens.access_token);
  assert.ok(resourcesList.result?.resources?.some(item => item.uri === 'relai://server/tool-surface'));
  assert.ok(resourcesList.result?.resources?.some(item => item.uri === 'relai://server/workspaces'));

  const started = await callTool(13, 'relai_start_task', { workspace: 'acceptance' }, tokens.access_token);
  const taskId = started.task_id;
  assert.ok(taskId);
  await callTool(14, 'relai_repo_snapshot', { workspace: 'acceptance', task_id: taskId, maxEntries: 50 }, tokens.access_token);
  const read = await callTool(15, 'relai_read', {
    workspace: 'acceptance', task_id: taskId, paths: ['acceptance.txt'], guidanceMode: 'none'
  }, tokens.access_token);
  assert.match(read.items?.[0]?.content || '', /packaged connector acceptance/);
  await callTool(16, 'relai_status', { workspace: 'acceptance', task_id: taskId }, tokens.access_token);
  const completed = await callTool(17, 'relai_complete_task', {
    workspace: 'acceptance', task_id: taskId, summary: 'Packaged OAuth and MCP connector acceptance completed.'
  }, tokens.access_token);
  assert.equal(completed.completionKnown, true);

  const reconnected = await mcp(20, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'packaged-chatgpt-acceptance', version: '2.0.0' }
  }, tokens.access_token);
  assert.ok(reconnected.result?.serverInfo);
  const rejected = await mcp(21, 'tools/call', {
    name: 'relai_read',
    arguments: { workspace: 'acceptance', task_id: taskId, paths: ['acceptance.txt'], guidanceMode: 'none' }
  }, tokens.access_token);
  assert.equal(rejected.result?.isError, true);
  assert.equal(rejected.result?.structuredContent?.errorCode, 'INVALID_TASK_STATE');

  for (const removedPath of ['/sse', '/messages']) {
    const response = await fetch(`${base}${removedPath}`);
    assert.equal(response.status, 404, `${removedPath} must remain removed`);
  }

  console.log('Packaged connector acceptance passed: OAuth, tools/resources, explicit task flow, completion, reconnect rejection, and removed legacy routes verified.');
} finally {
  if (child && !child.killed) child.kill('SIGKILL');
  if (child) await Promise.race([once(child, 'close'), new Promise(resolve => setTimeout(resolve, 2000))]).catch(() => {});
  fs.rmSync(sandbox, { recursive: true, force: true });
}

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth() {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Packaged server did not become healthy. stderr:\n${stderr}`);
}

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: crypto.createHash('sha256').update(verifier).digest('base64url')
  };
}

async function authorize(clientId, challenge) {
  const state = crypto.randomBytes(8).toString('hex');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'mcp',
    state
  });
  const page = await fetch(`${base}/authorize?${query}`);
  assert.equal(page.status, 200);
  const response = await postForm('/authorize', {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'mcp',
    state,
    dashboard_token: approvalToken
  }, true);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') || '');
  assert.equal(location.origin + location.pathname, redirectUri);
  assert.equal(location.searchParams.get('state'), state);
  const code = location.searchParams.get('code');
  assert.ok(code);
  return code;
}

async function postForm(pathname, values, manual = false) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)])),
    redirect: manual ? 'manual' : 'follow'
  });
}

function mcpHeaders(accessToken) {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
  };
}

async function mcp(id, method, params, accessToken) {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: mcpHeaders(accessToken),
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });
  assert.equal(response.status, 200, `${method} returned HTTP ${response.status}`);
  return readMcpResponse(response);
}

async function callTool(id, name, args, accessToken) {
  const response = await mcp(id, 'tools/call', { name, arguments: args }, accessToken);
  assert.equal(response.result?.isError, false, `${name} failed: ${JSON.stringify(response.result?.structuredContent || response.error)}`);
  return response.result.structuredContent;
}

async function readMcpResponse(response) {
  const text = await response.text();
  if (!(response.headers.get('content-type') || '').includes('text/event-stream')) return JSON.parse(text);
  const frames = text.split(/\n\n+/).map(frame => frame.trim()).filter(Boolean);
  const data = frames.flatMap(frame => frame.split(/\r?\n/))
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(Boolean);
  assert.ok(data.length, `MCP event stream contained no data frame: ${text}`);
  return JSON.parse(data.at(-1));
}
