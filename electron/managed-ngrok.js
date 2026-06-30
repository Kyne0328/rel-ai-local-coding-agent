const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const tunnelManager = require('../src/tunnelManager');

const UPDATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const URL_RE = /https:\/\/[^\s"'<>]+/i;

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
    path.join(__dirname, 'bin', 'ngrok', platform, fileName),
    path.join(__dirname, '..', 'vendor', 'ngrok', platform, fileName),
    path.join(process.cwd(), 'vendor', 'ngrok', platform, fileName)
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function ensureExecutable(file) {
  if (process.platform !== 'win32') {
    try { fs.chmodSync(file, 0o755); } catch (_) {}
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

function normalizeNgrokAuthtoken(value) {
  const token = String(value || '').trim();
  if (!token) throw new Error('ngrok authtoken is required.');
  if (/\s/.test(token)) throw new Error('ngrok authtoken cannot contain spaces.');
  if (token.length < 8) throw new Error('ngrok authtoken is too short.');
  return token;
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
  } catch (_) {
    return {};
  }
}

function writeUpdateState(next) {
  fs.mkdirSync(managedRoot(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(ngrokStatePath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

function runNgrok(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(managedNgrokPath(), args, {
      cwd: managedRoot(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timeoutMs = Number(options.timeoutMs || 45000);
    const timer = setTimeout(() => {
      tunnelManager.killProcess(child);
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
    lastOk: result.ok === true,
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

function extractPublicUrl(text) {
  const match = String(text || '').match(URL_RE);
  return match ? match[0].replace(/[).,;]+$/, '') : '';
}

function startManagedNgrokTunnel({ domain, port, timeoutMs = 30000, onLog = () => {}, onProcess = () => {} } = {}) {
  const safeDomain = String(domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  if (!safeDomain) throw new Error('ngrok domain is required.');
  const safePort = Number(port || 3333);
  const args = [
    'http',
    `http://127.0.0.1:${safePort}`,
    '--url',
    `https://${safeDomain}`,
    '--config',
    ngrokConfigPath(),
    '--log=stdout'
  ];

  return new Promise((resolve) => {
    const child = spawn(managedNgrokPath(), args, {
      cwd: managedRoot(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    if (typeof onProcess === 'function') onProcess(child, 'managed-ngrok');
    let settled = false;
    let buffer = '';
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!result.ok && child.exitCode === null && !child.killed) tunnelManager.killProcess(child);
      resolve(result);
    };
    const handleChunk = (chunk) => {
      const text = String(chunk || '');
      buffer += text;
      onLog(text, 'managed-ngrok');
      const publicUrl = extractPublicUrl(buffer);
      if (publicUrl) {
        finish({ ok: true, provider: 'managed-ngrok', publicUrl, process: child, command: [managedNgrokPath(), ...args].join(' ') });
      }
    };
    const timer = setTimeout(() => {
      finish({ ok: false, provider: 'managed-ngrok', publicUrl: '', process: null, error: `Timed out after ${timeoutMs}ms waiting for ngrok to publish a public URL.` });
    }, Number(timeoutMs || 30000));
    child.on('error', (error) => finish({ ok: false, provider: 'managed-ngrok', publicUrl: '', process: null, error: error.message }));
    child.on('exit', (code, signal) => {
      if (!settled) finish({ ok: false, provider: 'managed-ngrok', publicUrl: '', process: null, error: `ngrok exited before publishing a URL (code=${code}, signal=${signal}).` });
    });
    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);
  });
}

function previewManagedNgrokCommand(domain, port) {
  const safeDomain = String(domain || '<domain>').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  const safePort = Number(port || 3333);
  return `managed ngrok http --url=https://${safeDomain} http://127.0.0.1:${safePort} --config ${ngrokConfigPath()} --log=stdout`;
}

module.exports = {
  UPDATE_INTERVAL_MS,
  bundledNgrokPath,
  managedNgrokPath,
  ngrokConfigPath,
  normalizeNgrokAuthtoken,
  ensureManagedNgrok,
  writeNgrokConfig,
  maybeUpdateManagedNgrok,
  prepareManagedNgrok,
  startManagedNgrokTunnel,
  previewManagedNgrokCommand
};
