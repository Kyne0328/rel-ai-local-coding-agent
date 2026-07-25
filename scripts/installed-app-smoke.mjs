import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildReleaseEvidence,
  readUsabilityManifest,
  validateReleaseEvidence,
  writeReleaseEvidence
} from './release-evidence.mjs';

if (process.platform !== 'win32') {
  console.log('Installed application smoke test is Windows-only; skipped on this platform.');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { getToolSchemas } = require(path.join(root, 'src', 'tools', 'schema.js'));
const expectedPublicToolCount = getToolSchemas().length;
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-installed-smoke-'));
const distDir = path.join(sandbox, 'dist');
const localAppData = path.join(sandbox, 'LocalAppData');
const appData = path.join(sandbox, 'AppData');
const userProfile = path.join(sandbox, 'User');
const installDir = path.join(sandbox, 'InstalledApp');
const resultPath = path.join(sandbox, 'installed-smoke-result.json');
const windowResultPath = path.join(sandbox, 'window-smoke-result.json');
const configPath = path.join(sandbox, 'config.json');
const userDataDir = path.join(sandbox, 'electron-user-data');
const requestedInstaller = String(process.env.REL_AI_SMOKE_INSTALLER || '').trim();
const requestedEvidenceDir = String(process.env.REL_AI_RELEASE_EVIDENCE_DIR || '').trim();
const evidenceDir = requestedEvidenceDir ? path.resolve(requestedEvidenceDir) : path.join(sandbox, 'release-evidence');
const screenshotsDir = path.join(evidenceDir, 'screenshots');
const evidencePath = path.join(evidenceDir, 'release-readiness.json');
const appEnv = {
  ...process.env,
  LOCALAPPDATA: localAppData,
  APPDATA: appData,
  USERPROFILE: userProfile,
  REL_AI_MCP_STATE_DIR: path.join(sandbox, 'state'),
  REL_AI_MCP_CONFIG: configPath,
  REL_AI_INSTALL_SMOKE_RESULT: resultPath,
  REL_AI_WINDOW_SMOKE_RESULT: windowResultPath,
  REL_AI_WINDOW_SMOKE_EVIDENCE_DIR: screenshotsDir
};
const installerEnv = {
  ...process.env,
  __COMPAT_LAYER: 'RunAsInvoker'
};

fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(localAppData, { recursive: true });
fs.mkdirSync(appData, { recursive: true });
fs.mkdirSync(userProfile, { recursive: true });
fs.mkdirSync(screenshotsDir, { recursive: true });

let installer = null;
let uninstaller = null;
try {
  if (requestedInstaller) {
    installer = path.resolve(requestedInstaller);
    assert.ok(fs.existsSync(installer), `Requested release installer does not exist: ${installer}`);
    assert.ok(fs.statSync(installer).isFile(), `Requested release installer is not a file: ${installer}`);
  } else {
    const electronBuilder = require.resolve('electron-builder/out/cli/cli.js', {
      paths: [path.join(root, 'electron')]
    });
    run(process.execPath, [electronBuilder, '--win', 'nsis', `--config.directories.output=${distDir}`], {
      cwd: path.join(root, 'electron'),
      env: process.env,
      timeout: 15 * 60 * 1000
    });
    installer = findFile(distDir, (file) => /setup.*\.exe$/i.test(path.basename(file)));
    assert.ok(installer, `NSIS installer was not produced under ${distDir}`);
  }

  run(installer, ['/S', `/D=${installDir}`], { cwd: root, env: installerEnv, timeout: 5 * 60 * 1000 });
  const installedExe = findFile(installDir, (file) => path.basename(file).toLowerCase() === 'rel.ai mcp.exe');
  assert.ok(installedExe, `Installed executable was not found under explicit install directory: ${installDir}`);
  uninstaller = findFile(installDir, (file) => /^uninstall.*\.exe$/i.test(path.basename(file)));

  run(installedExe, ['--installed-smoke', `--user-data-dir=${userDataDir}`], {
    cwd: path.dirname(installedExe),
    env: appEnv,
    timeout: 90 * 1000
  });
  run(installedExe, ['--window-smoke', `--user-data-dir=${userDataDir}`], {
    cwd: path.dirname(installedExe),
    env: appEnv,
    timeout: 90 * 1000
  });

  assert.ok(fs.existsSync(resultPath), 'Installed application did not write its smoke result.');
  assert.ok(fs.existsSync(windowResultPath), 'Installed application did not write its renderer usability result.');
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  const windowResult = JSON.parse(fs.readFileSync(windowResultPath, 'utf8'));
  assert.equal(result.ok, true, result.error || 'Installed application smoke failed.');
  assert.equal(windowResult.ok, true, windowResult.error || 'Installed renderer usability smoke failed.');
  assert.equal(result.isPackaged, true);
  assert.equal(result.dashboardStatus, 200);
  assert.equal(result.publicToolCount, expectedPublicToolCount);
  assert.ok(Object.values(result.resourceChecks).every(Boolean), 'One or more packaged resources are missing.');
  assert.equal(result.health?.ok, true);

  const manifest = readUsabilityManifest(root);
  const evidence = buildReleaseEvidence({
    version: result.version,
    installerPath: installer,
    installedResult: result,
    windowResult,
    manifest,
    platform: process.platform,
    architecture: process.arch
  });
  writeReleaseEvidence(evidencePath, evidence);
  const evidenceErrors = validateReleaseEvidence(evidence, manifest, { evidencePath, installerPath: installer });
  assert.deepEqual(evidenceErrors, [], `Release usability evidence is invalid:\n${evidenceErrors.join('\n')}`);
  console.log(`Installed application smoke passed for v${result.version}: ${evidence.automated.scenarios.length} automated scenarios passed; ${evidence.manual.checks.length} external checks remain manual.`);
  console.log(`Release usability evidence: ${evidencePath}`);
} finally {
  if (uninstaller && fs.existsSync(uninstaller)) {
    spawnSync(uninstaller, ['/S'], { cwd: path.dirname(uninstaller), env: installerEnv, encoding: 'utf8', timeout: 3 * 60 * 1000 });
  }
  if (!removeWithRetry(sandbox)) {
    console.warn(`Installed smoke passed, but Windows still holds temporary files at ${sandbox}.`);
  }
}

function removeWithRetry(target) {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return true;
    } catch {
      Atomics.wait(sleeper, 0, 0, 250);
    }
  }
  return false;
}

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || '');
  }
  assert.equal(result.error, undefined, `${command} failed to start: ${result.error?.message || ''}`);
  assert.equal(result.status, 0, `${command} ${args.join(' ')} exited with ${result.status}`);
  return result;
}

function findFile(start, predicate) {
  if (!fs.existsSync(start)) return null;
  const pending = [start];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (predicate(full)) return full;
    }
  }
  return null;
}
