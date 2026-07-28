import * as fs from "node:fs";
import * as os from "node:os";
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const electronRoot = path.dirname(fileURLToPath(import.meta.url));
import { killProcess } from "../src/processKill.js";
import { normalizeNgrokAuthtoken } from "./ngrok-token.js";

const UPDATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const URL_RE = /https:\/\/[^\s"'<>]+/i;
const MANAGED_NGROK_LABEL = 'managed-ngrok';

function relaiStateDir() {
  return process.env.REL_AI_MCP_STATE_DIR || path.join(os.homedir(), '.rel-ai-mcp');
}

function managedRoot() {
  return path.join(relaiStateDir(), 'managed-ngrok');
}

function managedBinDir() {
  return path.join(managedRoot(), 'bin');
}

function managedNgrokPath() {
  return path.join(managedBinDir(), process.platform === 'win32' ? 'ngrok.exe' : 'ngrok');
}

function ngrokConfigPath() {
  return path.join(managedRoot(), 'ngrok.yml');
}

function ngrokStatePath() {
  return path.join(managedRoot(), 'state.json');
}

function bundledNgrokPath() {
  const platform = process.platform;
  const fileName = platform === 'win32' ? 'ngrok.exe' : 'ngrok';
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'ngrok', platform, fileName) : '',
    path.join(electronRoot, 'bin', 'ngrok', platform, fileName),
    path.join(electronRoot, '..', 'vendor', 'ngrok', platform, fileName),
    path.join(process.cwd(), 'vendor', 'ngrok', platform, fileName)
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function ensureExecutable(file) {
  if (process.platform !== 'win32') {
    // Owner-only exec (0o700): the same user that downloaded the binary runs it;
    // no need for group/other bits.
    try {
      fs.chmodSync(file, 0o700);
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) {
        console.error(`[rel-ai-mcp:ngrok] Failed to set executable permissions on ${file}:`, error);
      }
    }
  }
}

function ensureManagedNgrok() {
  const target = managedNgrokPath();
  if (fs.existsSync(target)) {
    ensureExecutable(target);
    return { ok: true, path: target, copied: false };
  }

  const source = bundledNgrokPath();
  if (!source) {
    throw new Error('Bundled ngrok seed binary is missing. Add ngrok to vendor/ngrok/<platform>/ before building the Electron app.');
  }

  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, target);
  ensureExecutable(target);
  return { ok: true, path: target, copied: true, source };
}

function writeNgrokConfig(authtoken) {
  const token = normalizeNgrokAuthtoken(authtoken);
  const configPath = ngrokConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    configPath,
    `version: "3"\nagent:\n  authtoken: ${JSON.stringify(token)}\n`,
    { mode: 0o600 }
  );
  return configPath;
}

function readUpdateState() {
  try {
    return JSON.parse(fs.readFileSync(ngrokStatePath(), 'utf8'));
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) {
      console.warn(`[rel-ai-mcp:ngrok] Failed to read or parse ngrok update state: ${error.message}`);
    }
    return {};
  }
}

function writeUpdateState(next) {
  fs.mkdirSync(managedRoot(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(ngrokStatePath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

function runNgrok(args, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(managedNgrokPath(), args, {
        cwd: managedRoot(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      resolve({ ok: false, exitCode: null, stdout: '', stderr: '', error: error.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timeoutMs = Number(options.timeoutMs || 45000);
    const timer = setTimeout(() => {
      killProcess(child);
      resolve({ ok: false, exitCode: null, stdout, stderr, error: `Timed out after ${timeoutMs}ms.` });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk || ''); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, exitCode: null, stdout, stderr, error: error.message });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code, stdout, stderr });
    });
  });
}

async function maybeUpdateManagedNgrok({ force = false, onLog = () => {} } = {}) {
  ensureManagedNgrok();
  const state = readUpdateState();
  const lastChecked = Date.parse(String(state.lastCheckedAt || ''));
  if (!force && Number.isFinite(lastChecked) && Date.now() - lastChecked < UPDATE_INTERVAL_MS) {
    return { ok: true, skipped: true, reason: 'recently checked', path: managedNgrokPath() };
  }

  onLog('[rel-ai-mcp:ngrok] Checking for ngrok agent updates...');
  const result = await runNgrok(['update'], { timeoutMs: 90000 });
  writeUpdateState({
    lastCheckedAt: new Date().toISOString(),
    lastOk: result.ok,
    lastExitCode: result.exitCode,
    lastError: result.error || result.stderr || ''
  });
  if (!result.ok) {
    onLog(`[rel-ai-mcp:ngrok] Update check failed; continuing with current ngrok. ${result.error || result.stderr || ''}`.trim());
  }
  return { ...result, path: managedNgrokPath() };
}

async function prepareManagedNgrok({ authtoken, onLog = () => {} } = {}) {
  const ensured = ensureManagedNgrok();
  const configPath = writeNgrokConfig(authtoken);
  const update = await maybeUpdateManagedNgrok({ onLog });
  return { ok: true, path: ensured.path, copied: ensured.copied, configPath, update };
}

function extractPublicUrl(text, expectedDomain = '') {
  const input = String(text || '');
  const pattern = new RegExp(URL_RE.source, 'ig');
  for (const match of input.matchAll(pattern)) {
    let url = match[0];
    while (url.length && ').,;'.includes(url.at(-1))) url = url.slice(0, -1);
    try {
      if (!expectedDomain || new URL(url).hostname.toLowerCase() === expectedDomain.toLowerCase()) return url;
    } catch {}
  }
  return '';
}

function sanitizeDomain(domain) {
  let s = String(domain || '').trim().replace(/^https?:\/\//i, '').toLowerCase();
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function sanitizePort(port) {
  const p = Number(port || 3333);
  return Number.isFinite(p) && p > 0 && p < 65536 ? p : 3333;
}

function startManagedNgrokTunnel({ domain, port, timeoutMs = 30000, onLog = () => {}, onProcess = () => {} } = {}) {
  const safeDomain = sanitizeDomain(domain);
  if (!safeDomain) throw new Error('ngrok domain is required.');
  const safePort = sanitizePort(port);
  const args = [
    'http',
    `http://127.0.0.1:${safePort}`,
    '--url',
    `https://${safeDomain}`,
    '--config',
    ngrokConfigPath(),
    '--log=stdout'
  ];

  const MAX_BUFFER_SIZE = 1048576;

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(managedNgrokPath(), args, {
        cwd: managedRoot(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      resolve({ ok: false, provider: MANAGED_NGROK_LABEL, publicUrl: '', process: null, error: error.message });
      return;
    }
    if (typeof onProcess === 'function') onProcess(child, MANAGED_NGROK_LABEL);
    let settled = false;
    let buffer = '';
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!result.ok && child.exitCode === null && !child.killed) killProcess(child);
      resolve(result);
    };
    const handleChunk = (chunk) => {
      const text = String(chunk || '');
      if (buffer.length < MAX_BUFFER_SIZE) {
        buffer += text;
      }
      onLog(text, MANAGED_NGROK_LABEL);
      const publicUrl = extractPublicUrl(buffer, safeDomain);
      if (publicUrl) {
        finish({ ok: true, provider: MANAGED_NGROK_LABEL, publicUrl, process: child, command: [managedNgrokPath(), ...args].join(' ') });
      }
    };
    const timer = setTimeout(() => {
      finish({ ok: false, provider: MANAGED_NGROK_LABEL, publicUrl: '', process: null, error: `Timed out after ${timeoutMs}ms waiting for ngrok to publish a public URL.` });
    }, Number(timeoutMs || 30000));
    child.on('error', (error) => finish({ ok: false, provider: MANAGED_NGROK_LABEL, publicUrl: '', process: null, error: error.message }));
    child.on('exit', (code, signal) => {
      if (!settled) finish({ ok: false, provider: MANAGED_NGROK_LABEL, publicUrl: '', process: null, error: `ngrok exited before publishing a URL (code=${code}, signal=${signal}).` });
    });
    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);
  });
}

function previewManagedNgrokCommand(domain, port) {
  const safeDomain = sanitizeDomain(domain || '<domain>');
  const safePort = sanitizePort(port);
  return `managed ngrok http --url=https://${safeDomain} http://127.0.0.1:${safePort} --config ${ngrokConfigPath()} --log=stdout`;
}

export { UPDATE_INTERVAL_MS, bundledNgrokPath, managedNgrokPath, ngrokConfigPath, normalizeNgrokAuthtoken, ensureManagedNgrok, writeNgrokConfig, maybeUpdateManagedNgrok, prepareManagedNgrok, startManagedNgrokTunnel, previewManagedNgrokCommand, extractPublicUrl };
