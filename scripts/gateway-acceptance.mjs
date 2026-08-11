import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { electronPlatformSpec, normalizeElectronPlatform } from './electron-platform.mjs';
import { resolvePackagedDirectory } from './packaged-directory.mjs';
import { GATEWAY_PROTOCOL_VERSION } from '../src/gateway/protocol.js';
import { MCP_PROTOCOL_VERSION } from '../src/mcp/protocolConstants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const platform = normalizeElectronPlatform(valueAfter(argv, '--platform', process.platform));
const packageDirectory = resolvePackagedDirectory(root, argv, { platform });
const spec = electronPlatformSpec(platform);
const executable = path.join(packageDirectory, spec.executableName);
assert.ok(fs.existsSync(executable), `Packaged desktop executable is missing: ${executable}`);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-gateway-acceptance-'));
const stateDir = path.join(sandbox, 'state');
const workspace = path.join(sandbox, 'workspace');
const configPath = path.join(stateDir, 'config.json');
const gatewayPort = await availablePort();
const mcpPort = await availablePort();
const debugPort = await availablePort();
const gatewayOrigin = `http://127.0.0.1:${gatewayPort}`;
const principalId = `prn_${'A'.repeat(32)}`;
const recoverySecret = 'R'.repeat(43);
const approvalToken = 'gateway-acceptance-local-token';
let child = null;
let stderr = '';
let fixture = null;

try {
  prepareWorkspace();
  prepareState();
  fixture = await createGatewayFixture({ port: gatewayPort, principalId, recoverySecret });
  child = launchPackagedDesktop();
  child.stderr?.on('data', chunk => { stderr += String(chunk || ''); });

  const target = await waitForDashboardTarget(debugPort);
  console.log(`Gateway acceptance DevTools target: ${target.url || '(unknown)'}`);
  await invokePairing(target);
  const result = await withTimeout(fixture.acceptance, 25_000, 'Packaged desktop did not complete gateway authentication and routed read acceptance.');

  assert.equal(result.authenticated, true, 'Packaged desktop did not authenticate the gateway challenge.');
  assert.equal(result.workspaceAdvertised, true, 'Packaged desktop did not advertise the acceptance workspace.');
  assert.equal(result.readOnlyTool, 'relai_snapshot');
  assert.equal(result.readOk, true, JSON.stringify(result.readPayload));

  const cleanShutdown = await closeDesktopViaDevTools(child, debugPort);
  if (cleanShutdown) child = null;
  assert.equal(cleanShutdown, true, 'Packaged desktop did not shut down cleanly after gateway acceptance.');
  await fixture.close();
  fixture = null;

  console.log(`Gateway packaged acceptance passed on ${platform}: challenge authentication, workspace advertisement, relai_work session bootstrap, read-only relai_snapshot routing, and clean shutdown verified.`);
} finally {
  if (child) await stopDesktop(child, platform, { allowForce: true }).catch(() => {});
  if (fixture) await fixture.close().catch(() => {});
  await delay(200);
  try { fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
}

function prepareWorkspace() {
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'README.md'), 'gateway acceptance\n', 'utf8');
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Rel.AI Gateway Acceptance'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'gateway-acceptance@example.invalid'], { cwd: workspace });
  execFileSync('git', ['add', 'README.md'], { cwd: workspace });
  execFileSync('git', ['commit', '-m', 'acceptance fixture'], { cwd: workspace, stdio: 'ignore' });
}

function prepareState() {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({
    version: 3,
    stateDir,
    auditLogPath: path.join(stateDir, 'audit.jsonl'),
    workspaces: {
      acceptance: {
        path: workspace,
        testCommands: {},
        commands: {},
        protectedBranches: ['main', 'master'],
        defaultBaseBranch: 'main',
        allowedRemotes: ['origin']
      }
    }
  }, null, 2)}\n`, 'utf8');
  const envLines = [
    '# Rel.AI gateway acceptance launcher configuration.',
    `REL_AI_MCP_CONNECTION_MODE=${JSON.stringify('cloud')}`,
    `REL_AI_GATEWAY_ORIGIN=${JSON.stringify(gatewayOrigin)}`,
    `REL_AI_MCP_PORT=${JSON.stringify(String(mcpPort))}`,
    `REL_AI_MCP_TOKEN=${JSON.stringify(approvalToken)}`,
    ''
  ];
  fs.writeFileSync(path.join(stateDir, '.env'), envLines.join('\n'), { encoding: 'utf8', mode: 0o600 });
}

function launchPackagedDesktop() {
  const args = [`--user-data-dir=${path.join(sandbox, 'electron-profile')}`, `--remote-debugging-port=${debugPort}`];
  if (platform === 'linux') args.push('--no-sandbox', '--password-store=basic');
  const env = { ...process.env };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NODE_USE_ENV_PROXY']) {
    delete env[key];
  }
  return spawn(executable, args, {
    cwd: packageDirectory,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    env: {
      ...env,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
      REL_AI_MCP_STATE_DIR: stateDir,
      REL_AI_MCP_CONFIG: configPath,
      REL_AI_GATEWAY_ORIGIN: gatewayOrigin
    }
  });
}

async function waitForDashboardTarget(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) throw new Error(`Packaged desktop exited before dashboard startup (${child.exitCode}). stderr:\n${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {}
    await delay(100);
  }
  throw new Error(`Packaged desktop DevTools target did not appear. stderr:\n${stderr}`);
}

async function invokePairing(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await eventOnce(socket, 'open', 5000);
  try {
    let bridgeReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const ready = await cdpCall(socket, 100 + attempt, 'Runtime.evaluate', {
        expression: `Boolean(window.relaiDesktop && typeof window.relaiDesktop.beginGatewayPairing === 'function')`,
        returnByValue: true
      });
      if (ready.result?.result?.value === true) { bridgeReady = true; break; }
      await delay(50);
    }
    if (!bridgeReady) throw new Error(`Rel.AI dashboard gateway bridge did not become ready on ${target.url || 'unknown target'}.`);
    const deadline = Date.now() + 20_000;
    let gatewayStatus = null;
    for (let attempt = 0; Date.now() < deadline; attempt += 1) {
      const statusResponse = await cdpCall(socket, 1000 + attempt, 'Runtime.evaluate', {
        expression: 'window.relaiDesktop.getGatewayStatus()',
        awaitPromise: true,
        returnByValue: true
      });
      const exception = statusResponse.result?.exceptionDetails || statusResponse.exceptionDetails;
      if (exception) {
        throw new Error(`Dashboard gateway status failed on ${target.url || 'unknown target'}: ${exception.exception?.description || exception.text || JSON.stringify(exception)}`);
      }
      gatewayStatus = statusResponse.result?.result?.value || null;
      if (
        gatewayStatus?.connectionMode === 'cloud'
        && gatewayStatus?.gateway?.gatewayOrigin === gatewayOrigin
        && ['pairing_required', 'pairing'].includes(gatewayStatus?.gateway?.state)
      ) break;
      await delay(100);
    }
    assert.equal(gatewayStatus?.connectionMode, 'cloud', `Packaged desktop did not enter cloud mode: ${JSON.stringify(gatewayStatus)}`);
    assert.equal(gatewayStatus?.gateway?.gatewayOrigin, gatewayOrigin, `Packaged desktop used the wrong gateway origin: ${JSON.stringify(gatewayStatus)}`);
    if (!['pairing_required', 'pairing'].includes(gatewayStatus?.gateway?.state)) {
      const desktopStatusResponse = await cdpCall(socket, 2500, 'Runtime.evaluate', {
        expression: 'window.relaiDesktop.getStatus()',
        awaitPromise: true,
        returnByValue: true
      });
      const desktopStatus = desktopStatusResponse.result?.result?.value || null;
      assert.fail(`Packaged desktop gateway was not ready for pairing: ${JSON.stringify({ gatewayStatus, desktopStatus, stderr })}`);
    }

    const expression = `(() => {
      const bridge = window.relaiDesktop;
      if (!bridge || typeof bridge.beginGatewayPairing !== 'function') throw new Error('Rel.AI dashboard gateway bridge is unavailable: relaiDesktop=' + typeof window.relaiDesktop + ', electronAPI=' + typeof window.electronAPI);
      return bridge.beginGatewayPairing();
    })()`;
    const response = await cdpCall(socket, 3000, 'Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    const exception = response.result?.exceptionDetails || response.exceptionDetails;
    if (exception) throw new Error(`Dashboard pairing invocation failed on ${target.url || 'unknown target'}: ${exception.exception?.description || exception.text || JSON.stringify(exception)}`);
    const value = response.result?.result?.value;
    assert.equal(value?.ok, true, `Dashboard pairing invocation failed on ${target.url || 'unknown target'}: ${JSON.stringify(response)}`);
    assert.match(String(value?.pairing?.code || ''), /^[A-Z0-9-]+$/);
  } finally {
    socket.close();
  }
}

function cdpCall(socket, id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error(`DevTools command timed out: ${method}`));
    }, 5000);
    const onMessage = event => {
      let message;
      try { message = JSON.parse(String(event.data || '')); } catch { return; }
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(`DevTools command failed: ${message.error.message || method}`));
      else resolve(message);
    };
    socket.addEventListener('message', onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function createGatewayFixture({ port, principalId: targetPrincipalId, recoverySecret: targetRecoverySecret }) {
  let pairing = null;
  let peer = null;
  let settled = false;
  let resolveAcceptance;
  let rejectAcceptance;
  const acceptance = new Promise((resolve, reject) => { resolveAcceptance = resolve; rejectAcceptance = reject; });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      if (req.method === 'POST' && url.pathname === '/v1/pairings') {
        const body = await readJsonBody(req, 64 * 1024);
        assert.match(String(body.deviceId || ''), /^[0-9a-f-]{36}$/i);
        assert.equal(body.publicJwk?.kty, 'EC');
        pairing = {
          pairingId: 'pair_gateway_acceptance',
          pollToken: crypto.randomBytes(24).toString('base64url'),
          code: 'ABCD-EFGH-JKLM',
          expiresAt: Date.now() + 60_000,
          deviceId: String(body.deviceId),
          publicJwk: body.publicJwk
        };
        return json(res, 200, { ok: true, ...pairing });
      }
      if (req.method === 'GET' && pairing && url.pathname === `/v1/pairings/${pairing.pairingId}`) {
        if (req.headers['x-relai-pairing-token'] !== pairing.pollToken) return json(res, 401, { ok: false });
        return json(res, 200, {
          ok: true,
          status: 'paired',
          principalId: targetPrincipalId,
          recoverySecret: targetRecoverySecret,
          deviceId: pairing.deviceId
        });
      }
      json(res, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  server.on('upgrade', (req, socket) => {
    try {
      if (!pairing) throw new Error('Device connected before pairing.');
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const expectedPath = `/v1/principals/${encodeURIComponent(targetPrincipalId)}/devices/${encodeURIComponent(pairing.deviceId)}/socket`;
      if (url.pathname !== expectedPath) throw new Error(`Unexpected device socket path: ${url.pathname}`);
      const key = String(req.headers['sec-websocket-key'] || '');
      if (!key) throw new Error('WebSocket key is missing.');
      const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        ''
      ].join('\r\n'));
      peer = createWebSocketPeer(socket);
      let authenticated = false;
      let capabilities = false;
      let workspaces = false;
      let bootstrapSent = false;
      const challenge = {
        type: 'challenge',
        protocolVersion: GATEWAY_PROTOCOL_VERSION,
        principalId: targetPrincipalId,
        deviceId: pairing.deviceId,
        nonce: crypto.randomBytes(24).toString('base64url'),
        expiresAt: Date.now() + 30_000
      };
      peer.onMessage(async frame => {
        try {
          if (frame.type === 'authenticate') {
            assert.equal(frame.principalId, challenge.principalId);
            assert.equal(frame.deviceId, challenge.deviceId);
            assert.equal(frame.nonce, challenge.nonce);
            assert.equal(frame.expiresAt, challenge.expiresAt);
            const publicKey = await crypto.webcrypto.subtle.importKey('jwk', pairing.publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
            const signed = `relai-device-v1\0${challenge.principalId}\0${challenge.deviceId}\0${challenge.nonce}\0${challenge.expiresAt}`;
            const valid = await crypto.webcrypto.subtle.verify(
              { name: 'ECDSA', hash: 'SHA-256' },
              publicKey,
              Buffer.from(String(frame.signature || ''), 'base64url'),
              new TextEncoder().encode(signed)
            );
            assert.equal(valid, true, 'Gateway challenge signature was invalid.');
            authenticated = true;
            peer.send({ type: 'authenticated', protocolVersion: GATEWAY_PROTOCOL_VERSION, principalId: targetPrincipalId, deviceId: pairing.deviceId, appVersion: 'acceptance' });
            maybeBootstrap();
            return;
          }
          if (frame.type === 'capabilities') { capabilities = true; maybeBootstrap(); return; }
          if (frame.type === 'workspaces') {
            workspaces = Array.isArray(frame.aliases) && frame.aliases.includes('acceptance');
            maybeBootstrap();
            return;
          }
          if (frame.type !== 'result') return;
          if (frame.requestKey === 'rk_acceptance_begin') {
            assert.equal(frame.ok, true, JSON.stringify(frame.error));
            const workId = String(frame.payload?.result?.structuredContent?.work_id || '');
            assert.ok(workId, `relai_work begin did not return work_id: ${JSON.stringify(frame.payload)}`);
            peer.send({
              type: 'request',
              gatewayRequestId: 'gw_acceptance_snapshot',
              requestKey: 'rk_acceptance_snapshot',
              workspace: 'acceptance',
              expiresAt: Date.now() + 30_000,
              message: {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: { name: 'relai_snapshot', arguments: { workspace: 'acceptance', work_id: workId, maxEntries: 20 } }
              }
            });
            return;
          }
          if (frame.requestKey === 'rk_acceptance_snapshot') {
            assert.equal(frame.ok, true, JSON.stringify(frame.error));
            const readOk = frame.payload?.result?.isError === false && frame.payload?.result?.structuredContent?.ok === true;
            if (!settled) {
              settled = true;
              resolveAcceptance({ authenticated, workspaceAdvertised: workspaces, readOnlyTool: 'relai_snapshot', readOk, readPayload: frame.payload });
            }
          }
        } catch (error) {
          if (!settled) { settled = true; rejectAcceptance(error); }
        }
      });
      peer.onError(error => {
        if (!settled) { settled = true; rejectAcceptance(error); }
      });
      peer.send(challenge);

      function maybeBootstrap() {
        if (!authenticated || !capabilities || !workspaces || bootstrapSent) return;
        bootstrapSent = true;
        peer.send({
          type: 'request',
          gatewayRequestId: 'gw_acceptance_begin',
          requestKey: 'rk_acceptance_begin',
          workspace: 'acceptance',
          expiresAt: Date.now() + 30_000,
          message: {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'relai_work',
              arguments: {
                action: 'begin',
                workspace: 'acceptance',
                bootstrap: 'none',
                title: 'Gateway packaged acceptance',
                objective: 'Verify packaged gateway authentication and one read-only routed tool call.'
              },
              _meta: { 'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION }
            }
          }
        });
      }
    } catch (error) {
      socket.destroy();
      if (!settled) { settled = true; rejectAcceptance(error); }
    }
  });

  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return {
    acceptance,
    async close() {
      peer?.close();
      await new Promise(resolve => server.close(() => resolve()));
    }
  };
}

function createWebSocketPeer(socket) {
  let buffer = Buffer.alloc(0);
  let messageHandler = () => {};
  let errorHandler = () => {};
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    try { drain(); } catch (error) { errorHandler(error); }
  });
  socket.on('error', error => errorHandler(error));

  function drain() {
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('WebSocket frame is too large.');
        length = Number(big);
        offset = 10;
      }
      const maskBytes = masked ? 4 : 0;
      if (buffer.length < offset + maskBytes + length) return;
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      offset += maskBytes;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      buffer = buffer.subarray(offset + length);
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      if (opcode === 0x8) { socket.end(); return; }
      if (opcode === 0x9) { sendRaw(payload, 0x0a); continue; }
      if (opcode !== 0x1) continue;
      messageHandler(JSON.parse(payload.toString('utf8')));
    }
  }

  function send(value) {
    sendRaw(Buffer.from(JSON.stringify(value), 'utf8'), 0x01);
  }

  function sendRaw(payload, opcode) {
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  }

  return {
    send,
    close() { try { sendRaw(Buffer.alloc(0), 0x08); } catch {} try { socket.end(); } catch {} },
    onMessage(handler) { messageHandler = handler; },
    onError(handler) { errorHandler = handler; }
  };
}

async function closeDesktopViaDevTools(processHandle, port) {
  if (!processHandle || processHandle.exitCode != null) return true;
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!response.ok) return false;
  const version = await response.json();
  if (!version.webSocketDebuggerUrl) return false;
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await eventOnce(socket, 'open', 5000);
  const closed = Promise.race([
    once(processHandle, 'close').then(() => true),
    delay(8000).then(() => false)
  ]);
  socket.send(JSON.stringify({ id: 9001, method: 'Browser.close' }));
  const result = await closed;
  try { socket.close(); } catch {}
  return result;
}

async function stopDesktop(processHandle, targetPlatform, options = {}) {
  if (!processHandle || processHandle.exitCode != null) return true;
  if (targetPlatform === 'win32') {
    const termination = spawnSync('taskkill', ['/PID', String(processHandle.pid), '/T'], { encoding: 'utf8', windowsHide: true });
    if (termination.status !== 0) console.error(`Gateway acceptance taskkill failed (${termination.status}): ${termination.stderr || termination.stdout || ''}`);
  } else {
    try { processHandle.kill('SIGTERM'); } catch {}
  }
  const closed = await Promise.race([
    once(processHandle, 'close').then(() => true),
    delay(8000).then(() => false)
  ]);
  if (closed) return true;
  if (!options.allowForce) return false;
  if (targetPlatform === 'win32') spawnSync('taskkill', ['/PID', String(processHandle.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else { try { processHandle.kill('SIGKILL'); } catch {} }
  await Promise.race([once(processHandle, 'close'), delay(2000)]).catch(() => {});
  return false;
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

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('Request body exceeded acceptance fixture limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function eventOnce(target, name, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} timed out.`)), timeoutMs);
    target.addEventListener(name, event => { clearTimeout(timer); resolve(event); }, { once: true });
    target.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`${name} failed.`)); }, { once: true });
  });
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([promise, delay(timeoutMs).then(() => { throw new Error(message); })]);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function valueAfter(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}
