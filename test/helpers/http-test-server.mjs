import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';

const DEFAULT_HOST = '127.0.0.1';
const LISTEN_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 10_000;

async function startHttpTestServer({ root, configPath, token, stateDir, env = {} }) {
  const host = DEFAULT_HOST;
  const child = spawn(process.execPath, [
    path.join(root, 'bin', 'rel-ai-mcp-http.js'),
    '--host', host,
    '--port', '0',
    '--no-profile-write'
  ], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      ...env,
      REL_AI_MCP_CONFIG: configPath,
      REL_AI_MCP_TOKEN: token,
      REL_AI_MCP_STATE_DIR: stateDir
    }
  });

  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  const getStderr = () => stderr;

  try {
    const port = await waitForListeningPort(child, getStderr, host);
    const base = `http://${host}:${port}`;
    await waitForHealth(child, base, getStderr);
    return { child, base, port, getStderr };
  } catch (error) {
    await stopHttpTestServer(child);
    throw error;
  }
}

async function waitForListeningPort(child, getStderr, host) {
  const deadline = Date.now() + LISTEN_TIMEOUT_MS;
  const pattern = new RegExp(`HTTP server listening on http:\\/\\/${escapeRegExp(host)}:(\\d+)`);
  while (Date.now() < deadline) {
    const match = getStderr().match(pattern);
    if (match) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0) return port;
      throw new Error(`HTTP test server reported an invalid listening port: ${match[1]}`);
    }
    if (child.exitCode != null) {
      throw new Error(`HTTP test server exited before listening (code ${child.exitCode}).\n${getStderr()}`);
    }
    await delay(25);
  }
  throw new Error(`HTTP test server did not report a listening port within ${LISTEN_TIMEOUT_MS}ms.\n${getStderr()}`);
}

async function waitForHealth(child, base, getStderr) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`HTTP test server exited before becoming healthy (code ${child.exitCode}).\n${getStderr()}`);
    }
    try {
      const response = await localHttpFetch(`${base}/health`);
      if (response.ok) return;
    } catch {}
    await delay(50);
  }
  throw new Error(`HTTP test server did not become healthy within ${HEALTH_TIMEOUT_MS}ms.\n${getStderr()}`);
}

function localHttpFetch(input, init = {}) {
  const target = new URL(input);
  if (target.protocol !== 'http:') throw new Error(`Local HTTP test client only accepts http: URLs, got ${target.protocol}`);
  const method = String(init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});
  headers.set('connection', 'close');
  headers.set('accept-encoding', 'identity');
  const body = requestBody(init.body);
  if (body && !headers.has('content-length')) headers.set('content-length', String(body.length));

  return new Promise((resolve, reject) => {
    const request = http.request(target, {
      method,
      headers: Object.fromEntries(headers.entries()),
      agent: false
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks);
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else if (value != null) {
            responseHeaders.set(name, String(value));
          }
        }
        const status = Number(response.statusCode || 0);
        resolve({
          status,
          ok: status >= 200 && status < 300,
          headers: responseHeaders,
          text: async () => responseBody.toString('utf8'),
          json: async () => JSON.parse(responseBody.toString('utf8')),
          arrayBuffer: async () => responseBody.buffer.slice(responseBody.byteOffset, responseBody.byteOffset + responseBody.byteLength)
        });
      });
    });
    request.on('error', error => {
      const code = String(error?.code || '').trim();
      const wrapped = new Error(
        `Local HTTP request ${method} ${target.pathname} failed${code ? ` (${code})` : ''}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
      if (code) wrapped.code = code;
      reject(wrapped);
    });
    if (body) request.write(body);
    request.end();
  });
}

function requestBody(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.from(String(value), 'utf8');
}

async function stopHttpTestServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill('SIGKILL');
  await Promise.race([
    once(child, 'close'),
    delay(2_000)
  ]).catch(() => {});
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { localHttpFetch, startHttpTestServer, stopHttpTestServer };
