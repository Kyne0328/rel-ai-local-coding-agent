import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveResourcePath } from './resource-path.js';

const START_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 200;

function createSecureTunnelRuntime({
  spawnImpl = spawn,
  fetchImpl = globalThis.fetch,
  stopProcess,
  resolveExecutable = bundledTunnelClientPath,
  makeEnvironment,
  stateDir = process.env.REL_AI_MCP_STATE_DIR || path.join(os.homedir(), '.rel-ai-mcp'),
  onLog = () => {},
  onStatus = () => {}
} = {}) {
  if (typeof spawnImpl !== 'function') throw new TypeError('spawnImpl is required.');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required.');
  if (typeof stopProcess !== 'function') throw new TypeError('stopProcess is required.');
  if (typeof resolveExecutable !== 'function') throw new TypeError('resolveExecutable is required.');
  if (typeof makeEnvironment !== 'function') throw new TypeError('makeEnvironment is required.');
  if (typeof onLog !== 'function' || typeof onStatus !== 'function') throw new TypeError('Tunnel callbacks must be functions.');

  let child = null;
  let generation = 0;
  let stopping = false;
  let state = freezeState({ state: 'stopped', tunnelId: '', healthUrl: '', error: '', lastConnectedAt: null });

  async function start(config = {}) {
    if (child && child.exitCode === null) throw new Error('OpenAI Secure MCP Tunnel is already running.');
    const tunnelId = normalizeTunnelId(config.tunnelId);
    const apiKey = normalizeRequiredSecret(config.apiKey, 'OpenAI tunnel runtime API key');
    const localToken = normalizeRequiredSecret(config.localToken, 'Rel.AI local bearer token');
    const port = normalizePort(config.port);
    const executable = await resolveExecutable();
    if (!executable) throw new Error('Bundled OpenAI tunnel-client is missing. Fetch and verify vendor/tunnel-client before starting Rel.AI.');
    await ensureExecutable(executable);

    const runGeneration = ++generation;
    stopping = false;
    const healthUrlFile = path.join(path.resolve(stateDir), `tunnel-health-${process.pid}.url`);
    await fs.promises.mkdir(path.dirname(healthUrlFile), { recursive: true, mode: 0o700 });
    await fs.promises.rm(healthUrlFile, { force: true });
    update({ state: 'connecting', tunnelId, healthUrl: '', error: '' });

    const args = [
      'run',
      '--control-plane.tunnel-id', tunnelId,
      '--control-plane.api-key', 'env:CONTROL_PLANE_API_KEY',
      '--mcp.server-url', `url=http://127.0.0.1:${port}/mcp,channel=main`,
      '--mcp.extra-headers', 'Authorization: env:REL_AI_LOCAL_AUTH_HEADER',
      '--mcp.discovery-extra-headers', 'Authorization: env:REL_AI_LOCAL_AUTH_HEADER',
      '--health.listen-addr', '127.0.0.1:0',
      '--health.url-file', healthUrlFile,
      '--log.format', 'json',
      '--log.level', 'info'
    ];

    onLog(`[rel-ai-mcp:tunnel] Starting OpenAI Secure MCP Tunnel ${tunnelId} -> http://127.0.0.1:${port}/mcp.`);
    let ownedChild;
    try {
      ownedChild = spawnImpl(executable, args, {
        cwd: path.dirname(healthUrlFile),
        env: makeEnvironment({
          CONTROL_PLANE_API_KEY: apiKey,
          REL_AI_LOCAL_AUTH_HEADER: `Bearer ${localToken}`
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      update({ state: 'failed', tunnelId, error: messageOf(error) });
      throw error;
    }
    child = ownedChild;
    pipeLogs(ownedChild.stdout, onLog);
    pipeLogs(ownedChild.stderr, onLog);
    ownedChild.once('error', error => {
      if (runGeneration !== generation) return;
      update({ state: 'failed', tunnelId, error: messageOf(error) });
    });
    ownedChild.once('exit', (code, signal) => {
      if (runGeneration !== generation || child !== ownedChild) return;
      child = null;
      void fs.promises.rm(healthUrlFile, { force: true }).catch(() => {});
      if (stopping) {
        update({ state: 'stopped', tunnelId: '', healthUrl: '', error: '' });
        return;
      }
      update({
        state: 'failed',
        tunnelId,
        healthUrl: '',
        error: `OpenAI tunnel-client exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'none'}).`
      });
    });

    try {
      const healthUrl = await waitForReady({ ownedChild, healthUrlFile, fetchImpl, timeoutMs: Number(config.timeoutMs || START_TIMEOUT_MS) });
      if (runGeneration !== generation || child !== ownedChild) return { cancelled: true, ...snapshot() };
      update({ state: 'running', tunnelId, healthUrl, error: '', lastConnectedAt: Date.now() });
      return { ok: true, process: ownedChild, ...snapshot() };
    } catch (error) {
      if (runGeneration === generation && child === ownedChild) {
        child = null;
        generation += 1;
        await stopProcess(ownedChild, { graceMs: 1000, forceWaitMs: 2000 }).catch(() => {});
        await fs.promises.rm(healthUrlFile, { force: true }).catch(() => {});
        update({ state: 'failed', tunnelId, healthUrl: '', error: messageOf(error) });
      }
      throw error;
    }
  }

  async function stop() {
    generation += 1;
    stopping = true;
    const ownedChild = child;
    child = null;
    if (!ownedChild) {
      update({ state: 'stopped', tunnelId: '', healthUrl: '', error: '' });
      return { stopped: true, exited: true, forced: false };
    }
    const result = await stopProcess(ownedChild, { graceMs: 1000, forceWaitMs: 2000 });
    update({ state: 'stopped', tunnelId: '', healthUrl: '', error: '' });
    return { stopped: true, ...result };
  }

  function snapshot() {
    return { ...state, processOwned: Boolean(child && child.exitCode === null) };
  }

  function update(patch) {
    state = freezeState({ ...state, ...patch });
    onStatus(snapshot());
  }

  return Object.freeze({ start, stop, snapshot });
}

async function waitForReady({ ownedChild, healthUrlFile, fetchImpl, timeoutMs }) {
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  let healthUrl = '';
  let lastError = '';
  while (Date.now() < deadline) {
    if (ownedChild.exitCode !== null) throw new Error(`OpenAI tunnel-client exited before becoming ready (code=${ownedChild.exitCode}).`);
    if (!healthUrl) {
      try { healthUrl = normalizeHealthUrl(await fs.promises.readFile(healthUrlFile, 'utf8')); }
      catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error?.code)) throw error; }
    }
    if (healthUrl) {
      try {
        const response = await fetchImpl(`${healthUrl}/readyz`, { signal: AbortSignal.timeout(1200) });
        if (response?.ok) return healthUrl;
        lastError = `readyz returned HTTP ${response?.status || 0}`;
      } catch (error) {
        lastError = messageOf(error);
      }
    }
    await delay(HEALTH_POLL_MS);
  }
  throw new Error(`OpenAI Secure MCP Tunnel did not become ready within ${Math.round(timeoutMs / 1000)} seconds${lastError ? `: ${lastError}` : '.'}`);
}

async function bundledTunnelClientPath() {
  const platform = process.platform;
  const fileName = platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client';
  const candidates = [
    resolveResourcePath(path.join('bin', 'tunnel-client', platform, fileName)),
    resolveResourcePath(path.join('vendor', 'tunnel-client', platform, fileName))
  ];
  for (const candidate of candidates) {
    try { await fs.promises.access(candidate); return candidate; } catch {}
  }
  return '';
}

function normalizeTunnelId(value) {
  const text = String(value || '').trim();
  if (!/^tunnel_[A-Za-z0-9_-]{8,200}$/.test(text)) throw new Error('OpenAI Secure MCP Tunnel ID must start with tunnel_.');
  return text;
}

function normalizePort(value) {
  const port = Number(value || 3333);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Connection port must be between 1024 and 65535.');
  return port;
}

function normalizeRequiredSecret(value, label) {
  const text = String(value || '').trim();
  if (!text || text.length > 4096 || /[\r\n\0]/.test(text)) throw new Error(`${label} is missing or invalid.`);
  return text;
}

function normalizeHealthUrl(value) {
  const text = String(value || '').trim().replace(/\/$/, '');
  const url = new URL(text);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new Error('OpenAI tunnel-client health URL must be loopback HTTP.');
  }
  return url.origin;
}

async function ensureExecutable(file) {
  if (process.platform === 'win32') return;
  try { await fs.promises.chmod(file, 0o700); } catch {}
}

function pipeLogs(stream, onLog) {
  stream?.on?.('data', chunk => onLog(String(chunk || '')));
}

function freezeState(value) {
  return Object.freeze({ ...value });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown tunnel error');
}

export { createSecureTunnelRuntime };
