import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronRoot = path.join(root, 'electron');
const restartDelayMs = 450;
const watchRoots = Object.freeze(['electron', 'src', 'public', 'bin']);
const electronNestedWatchRoots = Object.freeze(['renderer', 'scripts']);

function defaultDevUserDataPath(homeDir = os.homedir()) {
  return path.join(homeDir, '.rel-ai-mcp-dev', 'electron-user-data');
}

function shouldRestartForPath(rootName, fileName) {
  const relative = `${String(rootName || '').replaceAll('\\', '/')}/${String(fileName || '').replaceAll('\\', '/')}`
    .replace(/^\/+/, '');
  if (!relative || relative.endsWith('/')) return false;
  if (relative.startsWith('electron/node_modules/')) return false;
  if (relative.startsWith('electron/dist/') || relative.startsWith('dist/')) return false;
  if (relative === 'public/dashboard.css') return false;
  const extension = path.posix.extname(relative).toLowerCase();
  return ['.js', '.mjs', '.cjs', '.html', '.css', '.json'].includes(extension);
}

function electronPackageRoot() {
  return path.join(electronRoot, 'node_modules', 'electron');
}

function electronExecutable(packageRoot = electronPackageRoot(), platform = process.platform) {
  const name = platform === 'win32' ? 'electron.exe' : 'electron';
  return path.join(packageRoot, 'dist', name);
}

function missingElectronRuntimeFiles(packageRoot = electronPackageRoot(), platform = process.platform) {
  const required = [
    path.join(packageRoot, 'package.json'),
    path.join(packageRoot, 'path.txt'),
    electronExecutable(packageRoot, platform),
    path.join(packageRoot, 'dist', 'icudtl.dat'),
    path.join(packageRoot, 'dist', 'resources', 'default_app.asar')
  ];
  return required.filter(file => !fs.existsSync(file));
}

function assertElectronRuntimeReady(packageRoot = electronPackageRoot(), platform = process.platform) {
  const missing = missingElectronRuntimeFiles(packageRoot, platform);
  if (!missing.length) return;
  const relative = missing.map(file => path.relative(electronRoot, file).replaceAll('\\', '/'));
  throw new Error(`Electron runtime is incomplete (${relative.join(', ')}). Stop the dev watcher and run npm ci --prefix electron before starting it again.`);
}

function sourceWatchTargets(baseRoot = root) {
  const targets = [
    { rootName: 'electron', directory: path.join(baseRoot, 'electron'), recursive: false, prefix: '' },
    ...electronNestedWatchRoots.map(prefix => ({
      rootName: 'electron',
      directory: path.join(baseRoot, 'electron', prefix),
      recursive: true,
      prefix: `${prefix}/`
    })),
    ...watchRoots.filter(rootName => rootName !== 'electron').map(rootName => ({
      rootName,
      directory: path.join(baseRoot, rootName),
      recursive: true,
      prefix: ''
    }))
  ];
  return targets.filter(target => fs.existsSync(target.directory));
}

function packageBin(packageRoot, binName) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
  if (!relative) throw new Error(`${manifest.name || packageRoot} does not declare ${binName}.`);
  return path.resolve(packageRoot, relative);
}

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${path.basename(script)} was terminated by ${result.signal}.`);
  if (result.status !== 0) throw new Error(`${path.basename(script)} failed with exit code ${result.status || 1}.`);
}

function terminateProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { child.kill('SIGTERM'); } catch {}
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log([
      'Usage: npm run electron:dev:watch',
      '',
      'Runs Rel.AI Electron directly from source, watches desktop/runtime files,',
      'rebuilds CSS continuously, and restarts Electron after relevant changes.',
      '',
      'Default: reuses the normal Rel.AI profile. Fully close the installed app first.',
      'Use --isolated for a separate persistent Electron/ChatGPT dev profile.'
    ].join('\n'));
    return;
  }

  const isolated = argv.includes('--isolated');
  assertElectronRuntimeReady();
  const binary = electronExecutable();

  const generateColorTokens = path.join(root, 'scripts', 'generate-color-tokens.mjs');
  const tailwindCli = packageBin(path.join(root, 'node_modules', '@tailwindcss', 'cli'), 'tailwindcss');
  runNode(generateColorTokens);

  const cssWatcher = spawn(process.execPath, [
    tailwindCli,
    '-i', path.join(root, 'src', 'ui', 'styles', 'app.css'),
    '-o', path.join(root, 'public', 'dashboard.css'),
    '--minify',
    '--watch'
  ], { cwd: root, stdio: 'inherit', windowsHide: true });

  let electronChild = null;
  let restartTimer = null;
  let restartChain = Promise.resolve();
  let shuttingDown = false;
  const watchers = [];

  function launchElectron(reason = 'initial launch') {
    if (shuttingDown) return;
    const env = { ...process.env, REL_AI_ELECTRON_DEV: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
    if (isolated) {
      env.REL_AI_ELECTRON_DEV_USER_DATA = process.env.REL_AI_ELECTRON_DEV_USER_DATA || defaultDevUserDataPath();
      fs.mkdirSync(env.REL_AI_ELECTRON_DEV_USER_DATA, { recursive: true });
    }
    console.log(`[electron-dev] ${reason}; launching source Electron${isolated ? ' with isolated profile' : ''}.`);
    electronChild = spawn(binary, [electronRoot], { cwd: root, env, stdio: 'inherit', windowsHide: false });
    electronChild.once('exit', (code, signal) => {
      if (shuttingDown || electronChild === null) return;
      electronChild = null;
      console.log(`[electron-dev] Electron exited (${signal || code || 'unknown'}). Waiting for the next source change.`);
      if (!isolated) console.log('[electron-dev] If the installed Rel.AI app is open, close it before using the shared-profile dev loop.');
    });
  }

  async function restartElectron(reason) {
    if (shuttingDown) return;
    const previous = electronChild;
    electronChild = null;
    terminateProcess(previous);
    await new Promise(resolve => setTimeout(resolve, 120));
    launchElectron(`changed ${reason}`);
  }

  function scheduleRestart(reason) {
    if (shuttingDown) return;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      restartChain = restartChain.then(() => restartElectron(reason), () => restartElectron(reason));
    }, restartDelayMs);
  }

  for (const target of sourceWatchTargets()) {
    const watcher = fs.watch(target.directory, { recursive: target.recursive }, (_eventType, fileName) => {
      if (!fileName) return;
      const relative = `${target.prefix}${String(fileName).replaceAll('\\', '/')}`;
      if (!shouldRestartForPath(target.rootName, relative)) return;
      scheduleRestart(`${target.rootName}/${relative}`);
    });
    watchers.push(watcher);
  }

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    if (restartTimer) clearTimeout(restartTimer);
    for (const watcher of watchers) watcher.close();
    terminateProcess(electronChild);
    terminateProcess(cssWatcher);
    await restartChain.catch(() => {});
  }

  process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)); });
  process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)); });
  cssWatcher.once('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[electron-dev] CSS watcher exited unexpectedly (${signal || code || 'unknown'}).`);
    void shutdown().finally(() => process.exit(1));
  });

  launchElectron();
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch(error => {
    console.error(`[electron-dev] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export { assertElectronRuntimeReady, defaultDevUserDataPath, electronExecutable, main, missingElectronRuntimeFiles, shouldRestartForPath, sourceWatchTargets, watchRoots };
