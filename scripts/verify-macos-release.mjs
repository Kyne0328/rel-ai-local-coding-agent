import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { electronPlatformSpec, normalizeElectronArch } from './electron-platform.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assertMacBundleStructure(appBundle) {
  const app = path.resolve(appBundle);
  assertDirectory(app, 'macOS application bundle');

  const frameworkRoots = [];
  const nestedApps = [app];
  const frameworkSymlinks = [];
  walk(app, entry => {
    if (entry.kind === 'directory' && entry.path.endsWith('.framework')) frameworkRoots.push(entry.path);
    if (entry.kind === 'directory' && entry.path.endsWith('.app')) nestedApps.push(entry.path);
    if (entry.kind !== 'symlink') return;
    const frameworkRoot = containingFramework(app, entry.path);
    if (!frameworkRoot) return;
    const target = fs.readlinkSync(entry.path);
    if (path.isAbsolute(target)) {
      throw new Error(`Framework symlink must be relative: ${path.relative(app, entry.path)} -> ${target}`);
    }
    const resolved = path.resolve(path.dirname(entry.path), target);
    assertContained(frameworkRoot, resolved, `Framework symlink escapes its bundle: ${path.relative(app, entry.path)} -> ${target}`);
    try {
      fs.realpathSync(entry.path);
    } catch (error) {
      throw new Error(`Framework symlink is broken: ${path.relative(app, entry.path)} -> ${target}`, { cause: error });
    }
    frameworkSymlinks.push(`${normalizeRelative(app, entry.path)} -> ${target}`);
  });

  if (frameworkRoots.length === 0) throw new Error(`macOS application has no .framework bundles: ${app}`);
  if (frameworkSymlinks.length === 0) throw new Error(`macOS application has no framework symlinks to verify: ${app}`);

  const executablePaths = new Set();
  for (const nestedApp of nestedApps) {
    const macosDirectory = path.join(nestedApp, 'Contents', 'MacOS');
    assertDirectory(macosDirectory, `MacOS executable directory for ${path.relative(app, nestedApp) || path.basename(app)}`);
    const entries = fs.readdirSync(macosDirectory, { withFileTypes: true });
    const executables = entries
      .filter(entry => entry.isFile() || entry.isSymbolicLink())
      .map(entry => path.join(macosDirectory, entry.name))
      .filter(candidate => fs.statSync(candidate).isFile());
    if (executables.length === 0) throw new Error(`Application bundle has no executable in ${macosDirectory}.`);
    for (const executable of executables) assertExecutable(executable, app, executablePaths);
  }

  for (const frameworkRoot of frameworkRoots) {
    const frameworkName = path.basename(frameworkRoot, '.framework');
    const candidates = [path.join(frameworkRoot, frameworkName)];
    const versionsDirectory = path.join(frameworkRoot, 'Versions');
    if (fs.existsSync(versionsDirectory) && fs.statSync(versionsDirectory).isDirectory()) {
      for (const entry of fs.readdirSync(versionsDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        candidates.push(path.join(versionsDirectory, entry.name, frameworkName));
      }
    }
    const binaries = candidates.filter(candidate => {
      try {
        return fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
    if (binaries.length === 0) throw new Error(`Framework bundle has no executable binary: ${path.relative(app, frameworkRoot)}.`);
    for (const executable of binaries) assertExecutable(executable, app, executablePaths);
  }

  return {
    frameworkSymlinks: [...new Set(frameworkSymlinks)].sort(),
    executablePaths: [...executablePaths].sort()
  };
}

function compareFrameworkSymlinks(source, mounted) {
  assert.deepEqual(
    mounted.frameworkSymlinks,
    source.frameworkSymlinks,
    'Framework symlink layout changed between the promoted app and the app inside the DMG.'
  );
}

function main(argv = process.argv.slice(2)) {
  if (process.platform !== 'darwin') throw new Error('macOS release verification must run on a macOS host.');
  const unpackedValue = valueAfter(argv, '--unpacked');
  const dmgValue = valueAfter(argv, '--dmg');
  if (!unpackedValue || !dmgValue) throw new Error('Use --unpacked <directory> --dmg <file>.');

  const architecture = normalizeElectronArch(process.env.REL_AI_TARGET_ARCH || process.arch);
  const spec = electronPlatformSpec('darwin', architecture);
  const unpacked = path.resolve(root, unpackedValue);
  const dmg = path.resolve(root, dmgValue);
  assertDirectory(unpacked, 'promoted macOS unpacked directory');
  assertFile(dmg, 'macOS DMG');

  const appRelative = spec.executableName.split('/Contents/MacOS/')[0];
  const sourceApp = path.join(unpacked, appRelative);
  const sourceStructure = assertMacBundleStructure(sourceApp);
  verifyCodeSignature(sourceApp, 'promoted macOS app');

  runExecutable('DMG structural verification', '/usr/bin/hdiutil', ['verify', dmg]);

  const mountpoint = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-ai-mcp-dmg-'));
  let mounted = false;
  try {
    runExecutable('DMG mount', '/usr/bin/hdiutil', [
      'attach', dmg,
      '-readonly',
      '-nobrowse',
      '-noautoopen',
      '-mountpoint', mountpoint
    ]);
    mounted = true;

    const mountedApp = path.join(mountpoint, path.basename(sourceApp));
    const mountedStructure = assertMacBundleStructure(mountedApp);
    compareFrameworkSymlinks(sourceStructure, mountedStructure);
    verifyCodeSignature(mountedApp, 'app mounted from DMG');

    const mountedExecutable = path.join(mountpoint, spec.executableName);
    const environment = {
      ...process.env,
      REL_AI_TARGET_PLATFORM: 'darwin',
      REL_AI_TARGET_ARCH: architecture
    };
    runNode('mounted packaged application verification', path.join(root, 'scripts', 'verify-packaged-wrapper.mjs'), [
      '--platform', 'darwin', '--dir', mountpoint
    ], environment);
    runNode('mounted packaged MCP acceptance', path.join(root, 'scripts', 'packaged-connector-acceptance.mjs'), [
      '--dir', mountpoint
    ], environment);
    runNode('mounted Electron fuse verification', path.join(root, 'scripts', 'verify-fuses.mjs'), [
      mountedExecutable, '--platform', 'darwin'
    ], environment);
  } finally {
    if (mounted) runExecutable('DMG detach', '/usr/bin/hdiutil', ['detach', mountpoint]);
    fs.rmSync(mountpoint, { recursive: true, force: true });
  }

  console.log(`macOS ${architecture} DMG, ad-hoc signature, framework symlinks, executables, fuses, layout, and packaged MCP acceptance verified.`);
}

function verifyCodeSignature(appBundle, label) {
  runExecutable(`${label} code-signature verification`, '/usr/bin/codesign', [
    '--verify', '--deep', '--strict', '--verbose=2', appBundle
  ]);
  const display = runExecutable(`${label} ad-hoc signature inspection`, '/usr/bin/codesign', [
    '--display', '--verbose=4', appBundle
  ], { capture: true });
  if (!/Signature=adhoc/i.test(display)) {
    throw new Error(`${label} is not ad-hoc signed as required by the no-Developer-ID release policy.`);
  }
}

function walk(directory, visitor) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      visitor({ kind: 'symlink', path: entryPath });
      continue;
    }
    if (entry.isDirectory()) {
      visitor({ kind: 'directory', path: entryPath });
      walk(entryPath, visitor);
      continue;
    }
    if (entry.isFile()) visitor({ kind: 'file', path: entryPath });
  }
}

function containingFramework(appBundle, candidate) {
  let current = path.dirname(candidate);
  while (current !== appBundle && current.startsWith(`${appBundle}${path.sep}`)) {
    if (current.endsWith('.framework')) return current;
    current = path.dirname(current);
  }
  return null;
}

function assertExecutable(executable, appBundle, executablePaths) {
  const stat = fs.statSync(executable);
  if ((stat.mode & 0o111) === 0) throw new Error(`Nested macOS executable lost execute permission: ${path.relative(appBundle, executable)}.`);
  executablePaths.add(normalizeRelative(appBundle, executable));
}

function assertContained(parent, child, message) {
  const relative = path.relative(parent, child);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(message);
}

function assertDirectory(candidate, label) {
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) throw new Error(`Missing ${label}: ${candidate}`);
}

function assertFile(candidate, label) {
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error(`Missing ${label}: ${candidate}`);
}

function normalizeRelative(rootDirectory, candidate) {
  return path.relative(rootDirectory, candidate).split(path.sep).join('/');
}

function valueAfter(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return '';
  const value = String(argv[index + 1] || '');
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function runNode(label, script, args, environment) {
  runExecutable(label, process.execPath, [script, ...args], { env: environment });
}

function runExecutable(label, executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    env: options.env || process.env,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? 'pipe' : 'inherit',
    windowsHide: true,
    shell: false
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`, { cause: result.error });
  if (result.signal) throw new Error(`${label} was terminated by ${result.signal}.`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status || 1}.`);
  return options.capture ? `${result.stdout || ''}\n${result.stderr || ''}` : '';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  }
}

export { assertMacBundleStructure, compareFrameworkSymlinks };
