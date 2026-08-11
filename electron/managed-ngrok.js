import crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const electronRoot = path.dirname(fileURLToPath(import.meta.url));
import { killProcess } from '../src/processKill.js';
import { normalizeNgrokAuthtoken } from './ngrok-token.js';

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

function bundledNgrokPath() {
  const platform = process.platform;
  const fileName = platform === 'win32' ? 'ngrok.exe' : 'ngrok';
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'ngrok', platform, fileName) : '',
    path.join(electronRoot, 'bin', 'ngrok', platform, fileName),
    path.join(electronRoot, '..', 'vendor', 'ngrok', platform, fileName),
    path.join(process.cwd(), 'vendor', 'ngrok', platform, fileName)
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

function ensureExecutable(file) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(file, 0o700);
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error(`[rel-ai-mcp:ngrok] Failed to set executable permissions on ${file}:`, error);
  }
}

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** @knipdynamic Intentional dynamic/cross-workspace module boundary. */
export function synchronizeManagedBinary(source, target) {
  const sourceSha256 = fileSha256(source);
  if (fs.existsSync(target) && fileSha256(target) === sourceSha256) {
    ensureExecutable(target);
    return { ok: true, path: target, copied: false, source, sha256: sourceSha256 };
  }

  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.copyFileSync(source, temporary);
    if (fileSha256(temporary) !== sourceSha256) throw new Error('Copied ngrok binary failed its SHA-256 verification.');
    ensureExecutable(temporary);
    fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return { ok: true, path: target, copied: true, source, sha256: sourceSha256 };
}

function ensureManagedNgrok() {
  const source = bundledNgrokPath();
  if (!source) throw new Error('Bundled ngrok seed binary is missing. Fetch and verify vendor/ngrok before building the Electron app.');
  return synchronizeManagedBinary(source, managedNgrokPath());
}

/** @knipdynamic Intentional dynamic/cross-workspace module boundary. */
export function writeNgrokConfig(authtoken) {
  const token = normalizeNgrokAuthtoken(authtoken);
  const configPath = ngrokConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    configPath,
    `version: "3"\nagent:\n  authtoken: ${JSON.stringify(token)}\n  update_check: false\n  remote_management: false\n`,
    { mode: 0o600 }
  );
  return configPath;
}

async function prepareManagedNgrok({ authtoken, onLog = () => {} } = {}) {
  const ensured = ensureManagedNgrok();
  const configPath = writeNgrokConfig(authtoken);
  onLog(`[rel-ai-mcp:ngrok] Prepared ${ensured.copied ? 'bundled' : 'verified'} ngrok binary.`);
  return {
    ok: true,
    path: ensured.path,
    copied: ensured.copied,
    sha256: ensured.sha256,
    configPath,
    update: { ok: true, skipped: true, reason: 'ngrok is updated through signed Rel.AI releases' }
  };
}

/** @knipdynamic Intentional dynamic/cross-workspace module boundary. */
export function extractPublicUrl(text, expectedDomain = '') {
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

/** @knipdynamic Intentional dynamic/cross-workspace module boundary. */
export function extractStartedTunnelUrl(text, expectedDomain = '') {
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!/\bstarted tunnel\b/i.test(line)) continue;
    const publicUrl = extractPublicUrl(line, expectedDomain);
    if (publicUrl) return publicUrl;
  }
  return '';
}

function tunnelExitError(buffer, code, signal) {
  const ngrokError = String(buffer || '').match(/\bERR_NGROK_\d+\b/i)?.[0] || '';
  const suffix = ngrokError ? ` ${ngrokError}.` : '';
  return `ngrok exited before publishing a public URL (code=${code}, signal=${signal}).${suffix}`;
}

function sanitizeDomain(domain) {
  let value = String(domain || '').trim().replace(/^https?:\/\//i, '').toLowerCase();
  while (value.endsWith('/')) value = value.slice(0, -1);
  return value;
}

function sanitizePort(port) {
  const value = Number(port || 3333);
  return Number.isFinite(value) && value > 0 && value < 65536 ? value : 3333;
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
    '--log=stdout',
    '--log-format=logfmt',
    '--log-level=info'
  ];

  onLog(`[rel-ai-mcp:ngrok] Starting managed tunnel for https://${safeDomain} -> http://127.0.0.1:${safePort}.`, MANAGED_NGROK_LABEL);
  const MAX_BUFFER_SIZE = 1048576;

  return new Promise(resolve => {
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
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!result.ok && child.exitCode === null && !child.killed) killProcess(child);
      resolve(result);
    };
    const handleChunk = chunk => {
      const text = String(chunk || '');
      if (buffer.length < MAX_BUFFER_SIZE) buffer += text;
      onLog(text, MANAGED_NGROK_LABEL);
      const publicUrl = extractStartedTunnelUrl(buffer, safeDomain);
      if (publicUrl) finish({ ok: true, provider: MANAGED_NGROK_LABEL, publicUrl, process: child, command: [managedNgrokPath(), ...args].join(' ') });
    };
    const timer = setTimeout(() => {
      finish({ ok: false, provider: MANAGED_NGROK_LABEL, publicUrl: '', process: null, error: `Timed out after ${timeoutMs}ms waiting for ngrok to publish a public URL.` });
    }, Number(timeoutMs || 30000));
    child.on('error', error => finish({ ok: false, provider: MANAGED_NGROK_LABEL, publicUrl: '', process: null, error: error.message }));
    child.on('exit', (code, signal) => {
      if (!settled) finish({ ok: false, provider: MANAGED_NGROK_LABEL, publicUrl: '', process: null, error: tunnelExitError(buffer, code, signal) });
    });
    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);
  });
}


export {
  prepareManagedNgrok,
  startManagedNgrokTunnel,
};
