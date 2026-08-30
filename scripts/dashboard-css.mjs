import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptRoot = path.resolve(path.dirname(scriptPath), '..');
const root = path.resolve(process.env.REL_AI_RELEASE_ROOT || scriptRoot);

function resolveTailwindCli(baseRoot = root) {
  const require = createRequire(path.join(baseRoot, 'package.json'));
  const manifestPath = require.resolve('@tailwindcss/cli/package.json');
  const packageRoot = path.dirname(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.tailwindcss;
  if (!relative) throw new Error('@tailwindcss/cli does not declare the tailwindcss binary.');
  return path.resolve(packageRoot, relative);
}

function dashboardCssArgs({ baseRoot = root, output = path.join(baseRoot, 'public', 'dashboard.css'), watch = false } = {}) {
  const args = [
    '-i', path.join(baseRoot, 'src', 'ui', 'styles', 'app.css'),
    '-o', output,
    '--minify'
  ];
  if (watch) args.push('--watch');
  return args;
}

function runNode(script, args = [], options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd || root,
    stdio: options.stdio || 'inherit',
    windowsHide: true,
    env: { ...process.env, REL_AI_RELEASE_ROOT: options.root || root }
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${path.basename(script)} was terminated by ${result.signal}.`);
  if (result.status !== 0) throw new Error(`${path.basename(script)} failed with exit code ${result.status || 1}.`);
  return result;
}

function runColorTokens({ baseRoot = root, check = false } = {}) {
  const generator = path.join(baseRoot, 'scripts', 'generate-color-tokens.mjs');
  return runNode(generator, check ? ['--check'] : [], { cwd: baseRoot, root: baseRoot });
}

function runTailwind({ baseRoot = root, output, watch = false, stdio = 'inherit' } = {}) {
  const cli = resolveTailwindCli(baseRoot);
  return runNode(cli, dashboardCssArgs({ baseRoot, output, watch }), { cwd: baseRoot, root: baseRoot, stdio });
}

function buildDashboardCss({ baseRoot = root, watch = false } = {}) {
  runColorTokens({ baseRoot });
  runTailwind({ baseRoot, watch });
}

function verifyGeneratedAssets({ baseRoot = root } = {}) {
  runColorTokens({ baseRoot, check: true });
  const tracked = path.join(baseRoot, 'public', 'dashboard.css');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-dashboard-css-'));
  const generated = path.join(tempDir, 'dashboard.css');
  try {
    runTailwind({ baseRoot, output: generated });
    const currentBytes = fs.existsSync(tracked) ? fs.readFileSync(tracked) : Buffer.alloc(0);
    const generatedBytes = fs.readFileSync(generated);
    if (!currentBytes.equals(generatedBytes)) {
      throw new Error('Generated dashboard CSS is stale. Run npm run build:css and keep public/dashboard.css with the source change.');
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log('Generated assets are current.');
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const watch = argv.includes('--watch');
  if (check && watch) throw new Error('--check and --watch cannot be used together.');
  if (check) verifyGeneratedAssets();
  else buildDashboardCss({ watch });
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (isEntrypoint) {
  try { main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export { buildDashboardCss, dashboardCssArgs, main, resolveTailwindCli, verifyGeneratedAssets };
