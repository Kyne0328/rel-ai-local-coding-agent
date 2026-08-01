import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertSafeControllerOperation } from './active-controller-guard.mjs';
import { invalidateDerivedReleaseEvidence, releaseArtifactNames } from './release-artifacts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronRoot = path.join(root, 'electron');
const options = parseArgs(process.argv.slice(2));
const mode = options.mode;
if (!['unpacked', 'release'].includes(mode)) {
  throw new Error('Use --mode unpacked or --mode release.');
}

const target = mode === 'release' ? path.join(root, 'dist') : path.join(root, 'dist', 'build-check');
assertSafeControllerOperation({ operation: 'package', targetPaths: [target] });
assertSafeBuilderArgs(options.builderArgs);

const generateColorTokens = path.join(root, 'scripts', 'generate-color-tokens.mjs');
const verifyNgrokManifest = path.join(root, 'scripts', 'verify-ngrok-seed.mjs');
const tailwindCli = packageBin(path.join(root, 'node_modules', '@tailwindcss', 'cli'), 'tailwindcss');
const electronBuilderCli = packageBin(path.join(electronRoot, 'node_modules', 'electron-builder'), 'electron-builder');

if (mode === 'unpacked') {
  runNode('unpacked output cleanup', path.join(root, 'scripts', 'clean.mjs'), ['--electron']);
}
runNode('color-token verification', generateColorTokens, ['--check']);
runNode('color-token generation', generateColorTokens);
runNode('dashboard CSS build', tailwindCli, [
  '-i', path.join(root, 'src', 'ui', 'styles', 'app.css'),
  '-o', path.join(root, 'public', 'dashboard.css'),
  '--minify'
]);
runNode('ngrok acquisition manifest verification', verifyNgrokManifest);

if (mode === 'unpacked') {
  runNode('Electron unpacked packaging', electronBuilderCli, [
    '--win',
    '--dir',
    '--config.directories.output=../dist/build-check',
    '--publish', 'never',
    ...options.builderArgs
  ], { cwd: electronRoot });
} else {
  packageRelease(electronBuilderCli, options.builderArgs);
}

console.log(`Electron ${mode} package completed without launching or installing the generated application.`);

function packageRelease(electronBuilder, builderArgs) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-ai-mcp-release-'));
  const outputArg = `--config.directories.output=${stagingRoot}`;
  const prepackaged = path.join(stagingRoot, 'win-unpacked');
  let completed = false;
  try {
    runNode('Electron release staging', electronBuilder, [
      '--win',
      '--dir',
      outputArg,
      '--publish', 'never',
      ...builderArgs
    ], { cwd: electronRoot });
    assertPrepackagedApp(prepackaged);
    runNode('NSIS artifact packaging', electronBuilder, [
      '--win', 'nsis',
      '--prepackaged', prepackaged,
      outputArg,
      '--publish', 'never',
      ...builderArgs
    ], { cwd: electronRoot });
    runNode('portable artifact packaging', electronBuilder, [
      '--win', 'portable',
      '--prepackaged', prepackaged,
      outputArg,
      '--publish', 'never',
      ...builderArgs
    ], { cwd: electronRoot });
    const promoted = promoteReleaseOutput(stagingRoot, path.join(root, 'dist'));
    console.log(`Current unpacked application: ${path.relative(root, promoted.unpackedPath)}`);
    completed = true;
  } finally {
    if (completed) {
      removeDirectory(stagingRoot);
    } else {
      console.error(`[electron-package] Release staging preserved for diagnostics: ${stagingRoot}`);
    }
  }
}

function promoteReleaseOutput(stagingRoot, destinationRoot) {
  const prepackaged = path.join(stagingRoot, 'win-unpacked');
  assertPrepackagedApp(prepackaged);
  const artifactEntries = fs.readdirSync(stagingRoot, { withFileTypes: true })
    .filter(entry => entry.isFile());
  const artifactNames = new Set(artifactEntries.map(entry => entry.name));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const canonical = releaseArtifactNames(version);
  for (const required of [canonical.installer, canonical.portable, canonical.blockmap, canonical.metadata]) {
    if (!artifactNames.has(required)) {
      throw new Error(`Release staging is missing the canonical artifact ${required}.`);
    }
  }
  const executables = artifactEntries.filter(entry => entry.name.toLowerCase().endsWith('.exe'));
  const unexpectedExecutables = executables.filter(entry => ![canonical.installer, canonical.portable].includes(entry.name));
  if (executables.length !== 2 || unexpectedExecutables.length > 0) {
    throw new Error(`Release staging must produce exactly ${canonical.installer} and ${canonical.portable}.`);
  }

  const invalidatedEvidence = invalidateDerivedReleaseEvidence(destinationRoot, version);
  if (invalidatedEvidence.length > 0) {
    console.log(`Invalidated stale release evidence: ${invalidatedEvidence.join(', ')}`);
  }
  fs.mkdirSync(destinationRoot, { recursive: true });
  const incomingNames = new Set(artifactEntries.map(entry => entry.name));
  removeObsoleteReleaseArtifacts(destinationRoot, incomingNames);
  for (const entry of artifactEntries) {
    promoteFile(path.join(stagingRoot, entry.name), path.join(destinationRoot, entry.name));
  }

  const preferredUnpacked = path.join(destinationRoot, 'win-unpacked');
  let unpackedPath = preferredUnpacked;
  try {
    removeDirectory(preferredUnpacked);
  } catch (error) {
    const buildId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
    unpackedPath = path.join(destinationRoot, 'unpacked-builds', buildId);
    console.warn(`[electron-package] Existing dist/win-unpacked is locked and was preserved. Current unpacked output will be written to ${path.relative(root, unpackedPath)}. ${messageOf(error)}`);
  }
  fs.mkdirSync(path.dirname(unpackedPath), { recursive: true });
  fs.cpSync(prepackaged, unpackedPath, { recursive: true, force: true });

  const marker = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    relativePath: path.relative(destinationRoot, unpackedPath).replaceAll('\\', '/'),
    preferredPathAvailable: unpackedPath === preferredUnpacked
  };
  writeJsonAtomic(path.join(destinationRoot, 'current-unpacked.json'), marker);
  removeObsoleteUnpackedBuilds(path.join(destinationRoot, 'unpacked-builds'), unpackedPath);
  return { unpackedPath, artifactNames: [...incomingNames].sort() };
}

function removeObsoleteUnpackedBuilds(directory, currentPath) {
  if (!fs.existsSync(directory)) return;
  const current = path.resolve(currentPath);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(directory, entry.name);
    if (path.resolve(candidate) === current) continue;
    try {
      removeDirectory(candidate);
    } catch (error) {
      console.warn(`[electron-package] Obsolete unpacked output is still locked and was preserved: ${path.relative(root, candidate)}. ${messageOf(error)}`);
    }
  }
  try {
    if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  } catch {}
}

function removeObsoleteReleaseArtifacts(directory, incomingNames) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || incomingNames.has(entry.name) || entry.name === 'current-unpacked.json') continue;
    if (!isReleaseArtifact(entry.name)) continue;
    fs.rmSync(path.join(directory, entry.name), { force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function isReleaseArtifact(name) {
  return /(?:\.exe|\.blockmap|latest[^/]*\.ya?ml|builder-[^/]*\.ya?ml)$/i.test(name);
}

function promoteFile(source, destination) {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  fs.copyFileSync(source, temporary);
  try {
    fs.rmSync(destination, { force: true, maxRetries: 5, retryDelay: 200 });
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`Could not promote release artifact ${path.basename(destination)}.`, { cause: error });
  }
}

function writeJsonAtomic(destination, value) {
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.rmSync(destination, { force: true, maxRetries: 5, retryDelay: 200 });
  fs.renameSync(temporary, destination);
}

function parseArgs(argv) {
  let mode = '';
  const builderArgs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--mode') mode = String(argv[++index] || '');
    else if (value === '--') builderArgs.push(...argv.slice(index + 1));
    else builderArgs.push(value);
  }
  return { mode, builderArgs };
}

function assertSafeBuilderArgs(args) {
  const reserved = new Set([
    '--dir', '--prepackaged', '--pd', '--win', '--windows', '-w', '--mac', '--linux',
    '--config.directories.output'
  ]);
  const conflict = args.find(value => reserved.has(String(value).split('=')[0]));
  if (conflict) throw new Error(`Builder argument ${conflict} is controlled by the guarded packaging workflow.`);
}

function assertPrepackagedApp(directory) {
  const executable = path.join(directory, 'Rel.AI MCP.exe');
  const resources = path.join(directory, 'resources');
  if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) {
    throw new Error(`Release staging did not produce ${executable}.`);
  }
  if (!fs.existsSync(resources) || !fs.statSync(resources).isDirectory()) {
    throw new Error(`Release staging did not produce ${resources}.`);
  }
}

function packageBin(packageRoot, binName) {
  const manifestPath = path.join(packageRoot, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Required package is unavailable: ${path.relative(root, manifestPath)}. Run npm install in the appropriate package directory.`, { cause: error });
  }
  const relativeBin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
  if (!relativeBin) throw new Error(`${manifest.name || packageRoot} does not declare the ${binName} CLI.`);
  const cliPath = path.resolve(packageRoot, relativeBin);
  if (!fs.existsSync(cliPath)) throw new Error(`Required CLI is missing: ${path.relative(root, cliPath)}.`);
  return cliPath;
}

function removeDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  fs.rmSync(directory, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 10 : 2,
    retryDelay: 250
  });
}

function runNode(label, script, args = [], options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd || root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`, { cause: result.error });
  if (result.signal) throw new Error(`${label} was terminated by ${result.signal}.`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status || 1}.`);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}
