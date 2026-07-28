import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseManifest = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.json'), 'utf8'));
const { applicationVersion, protocolVersion: mcpProtocolVersion, toolSurfaceVersion, toolCount } = releaseManifest;
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
fs.writeFileSync(path.join(workspace, 'acceptance.mjs'), "import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nassert.equal(fs.readFileSync(new URL('./acceptance.txt', import.meta.url), 'utf8'), 'packaged connector acceptance verified\\n');\n");
fs.writeFileSync(path.join(workspace, 'package.json'), `${JSON.stringify({
  name: 'relai-packaged-acceptance',
  private: true,
  type: 'module',
  scripts: { check: 'node acceptance.mjs' }
}, null, 2)}\n`);
runGit('init');
runGit('config', 'user.name', 'Rel.AI Acceptance');
runGit('config', 'user.email', 'relai-acceptance@example.invalid');
runGit('add', '.');
runGit('commit', '-m', 'Initialize packaged acceptance workspace');
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

  const expectedOauthCss = fs.readFileSync(path.join(resources, 'public', 'oauth.css'), 'utf8');
  const oauthCss = await fetch(`${base}/public/oauth.css`);
  assert.equal(oauthCss.status, 200);
  assert.match(oauthCss.headers.get('content-type') || '', /^text\/css(?:;\s*charset=utf-8)?$/i);
  const servedOauthCss = await oauthCss.text();
  assert.equal(servedOauthCss, expectedOauthCss);
  assert.doesNotMatch(servedOauthCss, /[A-Za-z]:\\|file:\/\/|\/home\/|\/Users\//);
  assert.equal((await fetch(`${base}/public/oauth-missing.css`)).status, 404);
  const invalidAuthorize = await fetch(`${base}/authorize`);
  assert.equal(invalidAuthorize.status, 400);
  assert.match(await invalidAuthorize.text(), /href="\/public\/oauth\.css"/);

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
    body: JSON.stringify({
      client_name: 'Packaged ChatGPT Acceptance',
      application_type: 'web',
      redirect_uris: [redirectUri]
    })
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

  const discovered = await mcp(10, 'server/discover', {}, tokens.access_token);
  assert.ok(discovered.result?.capabilities?.tools);
  assert.ok(discovered.result?.capabilities?.resources);
  assert.equal(discovered.result?.capabilities?.experimental?.relai?.toolSurfaceVersion, toolSurfaceVersion);

  const tools = await mcp(11, 'tools/list', {}, tokens.access_token);
  assert.equal(tools.result?.tools?.length, toolCount);
  const toolNames = new Set(tools.result.tools.map(tool => tool.name));
  for (const requiredTool of ['relai_start_task', 'relai_read', 'relai_complete_task']) {
    assert.equal(toolNames.has(requiredTool), true, `Packaged tool surface is missing ${requiredTool}.`);
  }
  const resourcesList = await mcp(12, 'resources/list', {}, tokens.access_token);
  assert.ok(resourcesList.result?.resources?.some(item => item.uri === 'relai://server/tool-surface'));
  assert.ok(resourcesList.result?.resources?.some(item => item.uri === 'relai://server/workspaces'));
  const surface = await readResource(13, 'relai://server/tool-surface', tokens.access_token);
  assert.equal(surface.toolSurfaceVersion, toolSurfaceVersion);
  assert.equal(surface.toolCount, toolCount);
  assert.deepEqual(surface.compatibilityAliases, {});
  const help = await readResourceText(14, 'relai://server/help', tokens.access_token);
  assert.ok(help.includes(`version: ${applicationVersion}`));

  const started = await callTool(15, 'relai_start_task', {
    workspace: 'acceptance',
    title: 'Packaged connector acceptance',
    objective: 'Verify packaged ESM runtime, guarded mutation, validation, observability, completion, and reconnect behavior.'
  }, tokens.access_token);
  const taskId = started.task_id;
  assert.ok(taskId);
  await callTool(16, 'relai_repo_snapshot', { workspace: 'acceptance', task_id: taskId, maxEntries: 50 }, tokens.access_token);
  const read = await callTool(17, 'relai_read', {
    workspace: 'acceptance', task_id: taskId, paths: ['acceptance.txt'], guidanceMode: 'none'
  }, tokens.access_token);
  assert.equal(read.items?.[0]?.content, 'packaged connector acceptance\n');

  const edited = await callTool(18, 'relai_edit', {
    workspace: 'acceptance',
    task_id: taskId,
    path: 'acceptance.txt',
    oldText: 'packaged connector acceptance\n',
    newText: 'packaged connector acceptance verified\n',
    returnDiff: true
  }, tokens.access_token);
  assert.equal(edited.changed, true);
  assert.ok(edited.changedFiles?.includes('acceptance.txt'));
  assert.equal(fs.readFileSync(path.join(workspace, 'acceptance.txt'), 'utf8'), 'packaged connector acceptance verified\n');

  const status = await callTool(19, 'relai_status', { workspace: 'acceptance', task_id: taskId }, tokens.access_token);
  assert.equal(status.version, applicationVersion);
  assert.equal(status.toolSurface?.toolCount, toolCount);
  assert.equal(status.toolSurface?.toolSurfaceVersion, toolSurfaceVersion);
  assert.deepEqual(status.toolSurface?.compatibilityAliases, {});
  assert.ok(status.workspace?.repository?.changedFiles?.includes('acceptance.txt'));

  const activeDashboard = await dashboard();
  assert.equal(activeDashboard.application?.version, applicationVersion);
  const activeTask = activeDashboard.tasks?.find(item => item.id === taskId || item.taskId === taskId);
  assert.ok(activeTask, 'dashboard task history must contain the active packaged acceptance task');
  assert.ok(activeDashboard.auditTail?.entries?.some(item => item.taskId === taskId && item.tool === 'relai_edit' && item.ok !== false));

  const completed = await callTool(20, 'relai_run_checks', {
    workspace: 'acceptance',
    task_id: taskId,
    check: 'npm run check',
    complete: true,
    summary: 'Packaged ESM connector accepted after guarded write, validation, activity inspection, and reconnect verification.'
  }, tokens.access_token);
  assert.equal(completed.validationStatus, 'passed');
  assert.equal(completed.completionKnown, true);
  assert.equal(completed.completionSource, 'relai_run_checks');
  assert.ok(completed.changedFiles?.includes('acceptance.txt'));

  const completedDashboard = await dashboard();
  const persistedTask = completedDashboard.tasks?.find(item => item.id === taskId || item.taskId === taskId);
  assert.ok(persistedTask, 'dashboard history must persist the completed packaged acceptance task');
  assert.equal(persistedTask.completionKnown, true);
  assert.equal(persistedTask.status, 'completed');
  assert.ok(persistedTask.changedFiles?.includes('acceptance.txt'));
  for (const expectedTool of ['relai_repo_snapshot', 'relai_read', 'relai_edit', 'relai_status', 'relai_run_checks']) {
    assert.ok(completedDashboard.auditTail?.entries?.some(item => item.taskId === taskId && item.tool === expectedTool), `dashboard activity is missing ${expectedTool}`);
  }

  const reconnected = await mcp(30, 'server/discover', {}, tokens.access_token, { clientVersion: '2.0.0' });
  assert.ok(reconnected.result?.capabilities?.tools);
  assert.ok(reconnected.result?.capabilities?.resources);
  const reconnectedDashboard = await dashboard();
  const reconnectedTask = reconnectedDashboard.tasks?.find(item => item.id === taskId || item.taskId === taskId);
  assert.equal(reconnectedTask?.completionKnown, true);
  assert.equal(reconnectedTask?.status, 'completed');

  const rejected = await mcp(31, 'tools/call', {
    name: 'relai_read',
    arguments: { workspace: 'acceptance', task_id: taskId, paths: ['acceptance.txt'], guidanceMode: 'none' }
  }, tokens.access_token);
  assert.equal(rejected.result?.isError, true);
  assert.equal(rejected.result?.structuredContent?.errorCode, 'INVALID_TASK_STATE');

  for (const removedPath of ['/sse', '/messages']) {
    const response = await fetch(`${base}${removedPath}`);
    assert.equal(response.status, 404, `${removedPath} must remain removed`);
  }

  console.log('Packaged connector acceptance passed: packaged OAuth CSS, release/tool versions, guarded write attribution, validation, dashboard activity/history, atomic completion, reconnect persistence/rejection, and removed legacy routes verified.');
} finally {
  if (child && !child.killed) child.kill('SIGKILL');
  if (child) await Promise.race([once(child, 'close'), new Promise(resolve => setTimeout(resolve, 2000))]).catch(() => {});
  fs.rmSync(sandbox, { recursive: true, force: true });
}

function runGit(...args) {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
}

async function dashboard() {
  const response = await fetch(`${base}/api/dashboard/v10`, {
    headers: { authorization: `Bearer ${approvalToken}` }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  return payload;
}

async function readResource(id, uri, accessToken) {
  return JSON.parse(await readResourceText(id, uri, accessToken));
}

async function readResourceText(id, uri, accessToken) {
  const response = await mcp(id, 'resources/read', { uri }, accessToken);
  const text = response.result?.contents?.[0]?.text;
  assert.equal(typeof text, 'string', `resource ${uri} did not return text`);
  return text;
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

function mcpHeaders(method, accessToken, name = '') {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': mcpProtocolVersion,
    'mcp-method': method,
    ...(name ? { 'mcp-name': name } : {}),
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
  };
}

async function mcp(id, method, params, accessToken, options = {}) {
  const name = method === 'tools/call'
    ? String(params?.name || '')
    : method === 'resources/read'
      ? String(params?.uri || '')
      : '';
  const requestParams = {
    ...(params || {}),
    _meta: {
      'io.modelcontextprotocol/protocolVersion': mcpProtocolVersion,
      'io.modelcontextprotocol/clientInfo': {
        name: 'packaged-chatgpt-acceptance',
        version: options.clientVersion || '1.0.0'
      },
      'io.modelcontextprotocol/clientCapabilities': {}
    }
  };
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: mcpHeaders(method, accessToken, name),
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: requestParams })
  });
  if (response.status !== 200) {
    const body = await response.text();
    assert.equal(response.status, 200, `${method} returned HTTP ${response.status}: ${body}`);
  }
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
