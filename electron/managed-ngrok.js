import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import https from 'node:https';
import { spawn, spawnSync } from 'node:child_process';
import { killProcess } from '../src/processKill.js';
import { normalizeNgrokAuthtoken } from './ngrok-token.js';
import {
  ngrokSpecForCurrentPlatform,
  readNgrokManifest,
  verifyNgrokArchive,
  verifyNgrokExecutable
} from './ngrok-provenance.js';

const URL_RE = /https:\/\/[^\s"'<>]+/i;
const MANAGED_NGROK_LABEL = 'managed-ngrok';
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const DOWNLOAD_INACTIVITY_MS = 30 * 1000;

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

function ensureExecutable(file) {
  if (process.platform === 'win32') return;
  fs.chmodSync(file, 0o700);
}

function emit(onLog, message) {
  if (typeof onLog === 'function') onLog(String(message));
}

async function downloadNgrokArchive(url, destination, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      emit(options.onLog, `Downloading official ngrok archive (attempt ${attempt} of ${DOWNLOAD_ATTEMPTS})…`);
      const result = await downloadHttpsFile(url, destination, options);
      emit(options.onLog, `Downloaded ${(result.bytes / 1024 / 1024).toFixed(1)} MiB. Verifying archive…`);
      return result;
    } catch (error) {
      lastError = error;
      fs.rmSync(destination, { force: true });
      if (attempt < DOWNLOAD_ATTEMPTS) {
        emit(options.onLog, `ngrok download attempt ${attempt} failed: ${messageOf(error)} Retrying…`);
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw new Error(`The official ngrok archive could not be downloaded after ${DOWNLOAD_ATTEMPTS} attempts. ${messageOf(lastError)}`, { cause: lastError });
}

function downloadHttpsFile(url, destination, options = {}) {
  const expectedSize = Number(options.expectedSize || 0);
  const maxBytes = Number(options.maxBytes || Math.max(expectedSize, 64 * 1024 * 1024));
  const timeoutMs = Number(options.timeoutMs || DOWNLOAD_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const request = https.get(url, {
      headers: { 'User-Agent': 'Rel.AI-MCP-ngrok-acquisition/1' },
      signal: AbortSignal.timeout(timeoutMs)
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`ngrok distribution server returned HTTP ${response.statusCode || 'unknown'}.`));
        return;
      }
      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength && declaredLength > maxBytes) {
        response.resume();
        reject(new Error(`ngrok archive exceeds the ${maxBytes}-byte download limit.`));
        return;
      }
      if (expectedSize && declaredLength && declaredLength !== expectedSize) {
        response.resume();
        reject(new Error(`ngrok archive length mismatch: expected ${expectedSize}, got ${declaredLength}.`));
        return;
      }

      let bytes = 0;
      let settled = false;
      const output = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
      const fail = error => {
        if (settled) return;
        settled = true;
        response.destroy();
        output.destroy();
        reject(error);
      };
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) fail(new Error(`ngrok archive exceeded the ${maxBytes}-byte download limit.`));
      });
      response.on('error', fail);
      output.on('error', fail);
      output.on('finish', () => {
        if (settled) return;
        if (expectedSize && bytes !== expectedSize) {
          fail(new Error(`ngrok archive size mismatch: expected ${expectedSize}, got ${bytes}.`));
          return;
        }
        settled = true;
        resolve({ destination, bytes });
      });
      response.pipe(output);
    });
    request.setTimeout(DOWNLOAD_INACTIVITY_MS, () => request.destroy(new Error('ngrok download stalled for 30 seconds.')));
    request.on('error', reject);
  });
}

function extractNgrokArchive(archivePath, destination) {
  if (process.platform !== 'win32') throw new Error('Automatic ngrok archive extraction is currently supported only on Windows.');
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const script = 'Microsoft.PowerShell.Archive\\Expand-Archive -LiteralPath $env:REL_AI_NGROK_ARCHIVE -DestinationPath $env:REL_AI_NGROK_EXTRACT -Force';
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    env: { ...process.env, REL_AI_NGROK_ARCHIVE: archivePath, REL_AI_NGROK_EXTRACT: destination }
  });
  if (result.status !== 0) throw new Error(`The verified ngrok archive could not be extracted. ${result.stderr || result.error?.message || `exit ${result.status}`}`);
  return destination;
}

function findExtractedExecutable(directory, fileName) {
  const pending = [directory];
  const matches = [];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('The ngrok archive contains an unsupported symbolic link.');
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name === fileName) matches.push(target);
    }
  }
  if (matches.length !== 1) throw new Error(`The ngrok archive must contain exactly one ${fileName} executable.`);
  return matches[0];
}

function installVerifiedBinary(source, target, verify) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const incoming = `${target}.${process.pid}.${Date.now()}.incoming`;
  const backup = `${target}.${process.pid}.${Date.now()}.backup`;
  fs.copyFileSync(source, incoming);
  ensureExecutable(incoming);
  verify(incoming);
  let backedUp = false;
  let promoted = false;
  try {
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      backedUp = true;
    }
    fs.renameSync(incoming, target);
    promoted = true;
    verify(target);
    if (backedUp) fs.rmSync(backup, { force: true });
  } catch (error) {
    fs.rmSync(incoming, { force: true });
    if (promoted) fs.rmSync(target, { force: true });
    if (backedUp && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  } finally {
    fs.rmSync(incoming, { force: true });
    fs.rmSync(backup, { force: true });
  }
  return target;
}

async function ensureManagedNgrok(options = {}) {
  const onLog = options.onLog || (() => {});
  const manifestResult = options.manifest
    ? { manifest: options.manifest, manifestPath: options.manifestPath || '' }
    : readNgrokManifest({ manifestPath: options.manifestPath });
  const manifest = manifestResult.manifest;
  const spec = options.spec || ngrokSpecForCurrentPlatform(manifest, options);
  const target = options.targetPath || managedNgrokPath();
  const verifyExecutable = options.verifyExecutable || (file => verifyNgrokExecutable(file, manifest, spec, options));
  const hadExisting = fs.existsSync(target);

  if (hadExisting) {
    try {
      const verification = verifyExecutable(target);
      ensureExecutable(target);
      emit(onLog, `Verified managed ngrok ${manifest.version}.`);
      return { ok: true, path: target, downloaded: false, repaired: false, verification, manifestPath: manifestResult.manifestPath };
    } catch (error) {
      emit(onLog, `The managed ngrok copy is missing or invalid and will not be executed. ${messageOf(error)}`);
    }
  }

  if (options.allowDownload !== true) {
    throw new Error('The verified ngrok agent is not available. Open connection recovery and approve the official ngrok download.');
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-ai-ngrok-acquisition-'));
  const archivePath = path.join(temporaryRoot, 'ngrok.zip');
  const extractionPath = path.join(temporaryRoot, 'extract');
  try {
    const downloadArchive = options.downloadArchive || downloadNgrokArchive;
    await downloadArchive(spec.archive.url, archivePath, {
      expectedSize: spec.archive.size,
      maxBytes: spec.archive.size,
      timeoutMs: options.timeoutMs,
      onLog
    });
    const verifyArchive = options.verifyArchive || (file => verifyNgrokArchive(file, spec));
    const archiveVerification = verifyArchive(archivePath);
    emit(onLog, `Verified ngrok archive SHA-256 ${archiveVerification.sha256.slice(0, 12)}…. Extracting…`);
    const extractArchive = options.extractArchive || extractNgrokArchive;
    await extractArchive(archivePath, extractionPath, { manifest, spec, onLog });
    const extracted = options.findExecutable
      ? options.findExecutable(extractionPath, spec.executable.file)
      : findExtractedExecutable(extractionPath, spec.executable.file);
    const verification = verifyExecutable(extracted);
    emit(onLog, `Verified ngrok ${manifest.version}, publisher, certificate issuer, and executable SHA-256.`);
    installVerifiedBinary(extracted, target, verifyExecutable);
    emit(onLog, 'Installed the verified ngrok agent in Rel.AI managed storage.');
    return {
      ok: true,
      path: target,
      downloaded: true,
      repaired: hadExisting,
      verification,
      archiveVerification,
      manifestPath: manifestResult.manifestPath
    };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

function writeNgrokConfig(authtoken) {
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

async function prepareManagedNgrok({ authtoken, allowDownload = false, onLog = () => {}, ...options } = {}) {
  const ensured = await ensureManagedNgrok({ ...options, allowDownload, onLog });
  const configPath = writeNgrokConfig(authtoken);
  return {
    ok: true,
    path: ensured.path,
    downloaded: ensured.downloaded,
    repaired: ensured.repaired,
    sha256: ensured.verification.sha256,
    configPath,
    update: { ok: true, skipped: true, reason: 'ngrok is pinned by the Rel.AI acquisition manifest and does not self-update' }
  };
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

function extractStartedTunnelUrl(text, expectedDomain = '') {
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
    '--log=stdout'
  ];

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

function previewManagedNgrokCommand(domain, port) {
  const safeDomain = sanitizeDomain(domain || '<domain>');
  const safePort = sanitizePort(port);
  return `managed ngrok http --url=https://${safeDomain} http://127.0.0.1:${safePort} --config ${ngrokConfigPath()} --log=stdout`;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export {
  downloadHttpsFile,
  downloadNgrokArchive,
  ensureManagedNgrok,
  extractNgrokArchive,
  extractPublicUrl,
  extractStartedTunnelUrl,
  findExtractedExecutable,
  installVerifiedBinary,
  managedNgrokPath,
  ngrokConfigPath,
  normalizeNgrokAuthtoken,
  prepareManagedNgrok,
  previewManagedNgrokCommand,
  startManagedNgrokTunnel,
  writeNgrokConfig
};
