import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

const DEFAULT_HOST = '127.0.0.1';
const LISTEN_TIMEOUT_MS = 10_000;
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
      const response = await fetch(`${base}/health`, { headers: { connection: 'close' } });
      if (response.ok) return;
    } catch {}
    await delay(50);
  }
  throw new Error(`HTTP test server did not become healthy within ${HEALTH_TIMEOUT_MS}ms.\n${getStderr()}`);
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

export { startHttpTestServer, stopHttpTestServer };
