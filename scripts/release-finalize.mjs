import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.REL_AI_RELEASE_ROOT || path.join(__dirname, '..'));
const args = process.argv.slice(2);
const explicitVersion = args.find((arg) => !arg.startsWith('--')) || '';
const push = args.includes('--push');
const skipTests = args.includes('--skip-tests');
const allowExtraChanges = args.includes('--allow-extra-changes');
const remote = valueAfter('--remote') || 'origin';
const branch = valueAfter('--branch') || 'main';

const releaseFiles = new Set([
  'CHANGELOG.md',
  'package.json',
  'package-lock.json',
  'electron/package.json',
  'electron/package-lock.json',
  'electron/renderer/status.html'
]);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index !== -1) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : '';
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    shell: false,
    env: { ...process.env, REL_AI_RELEASE_ROOT: root }
  });
  if (options.check !== false && result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit ${result.status}`);
  }
  return result;
}

function die(message) {
  console.error(`release:finalize: ${message}`);
  process.exit(1);
}

function normalizeStatusPath(line) {
  const raw = line.slice(3).trim();
  if (raw.includes(' -> ')) return raw.split(' -> ').pop().trim();
  return raw;
}

function gitStatusEntries() {
  const result = run('git', ['status', '--porcelain'], { check: true });
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => ({ line, path: normalizeStatusPath(line) }));
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

try {
  const pkgVersion = readJson('package.json').version;
  const version = explicitVersion || pkgVersion;
  if (explicitVersion && explicitVersion !== pkgVersion) die(`requested version ${explicitVersion} does not match package.json version ${pkgVersion}`);

  const currentBranch = run('git', ['branch', '--show-current'], { check: true }).stdout.trim();
  if (currentBranch !== branch) die(`must be on ${branch}; current branch is ${currentBranch || '(detached)'}`);

  run('git', ['fetch', remote, branch], { stdio: 'inherit' });
  const aheadBehind = run('git', ['rev-list', '--left-right', '--count', `HEAD...${remote}/${branch}`], { check: true }).stdout.trim().split(/\s+/).map(Number);
  const behind = aheadBehind[1] || 0;
  if (behind > 0) die(`${branch} is behind ${remote}/${branch} by ${behind}; pull/rebase before finalizing`);

  run(process.execPath, [path.join(root, 'scripts', 'release-check.mjs')], { stdio: 'inherit' });
  if (!skipTests) run('npm', ['test'], { stdio: 'inherit' });

  const entries = gitStatusEntries();
  if (!entries.length) die('no release changes to commit');
  const unexpected = entries.filter((entry) => !releaseFiles.has(entry.path));
  if (unexpected.length && !allowExtraChanges) {
    die(`unexpected changed files: ${unexpected.map((entry) => entry.path).join(', ')}. Pass --allow-extra-changes only when intentionally finalizing a larger patch.`);
  }

  const pathsToAdd = allowExtraChanges ? entries.map((entry) => entry.path) : entries.filter((entry) => releaseFiles.has(entry.path)).map((entry) => entry.path);
  run('git', ['add', '--', ...pathsToAdd], { stdio: 'inherit' });
  run('git', ['commit', '-m', `Release ${version}`], { stdio: 'inherit' });

  if (push) run('git', ['push', remote, branch], { stdio: 'inherit' });

  console.log(`Release ${version} finalized${push ? ' and pushed' : ''}.`);
} catch (error) {
  die(error.message || String(error));
}
