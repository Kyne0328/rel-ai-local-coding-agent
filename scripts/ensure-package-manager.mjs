import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = String(packageJson.packageManager || '').trim();
const match = declared.match(/^npm@(\d+\.\d+\.\d+)$/);
if (!match) throw new Error(`packageManager must declare an exact npm version; received ${declared || 'nothing'}.`);

const expectedVersion = match[1];
const currentVersion = npmVersion();
if (currentVersion === expectedVersion) {
  console.log(`Using declared npm ${expectedVersion}.`);
  process.exit(0);
}

console.log(`Switching npm from ${currentVersion || 'unknown'} to declared ${expectedVersion}.`);
const install = runNpm(['install', '--global', declared], { stdio: 'inherit' });
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status ?? 1);

const installedVersion = npmVersion();
if (installedVersion !== expectedVersion) {
  throw new Error(`Expected npm ${expectedVersion} after installation, received ${installedVersion || 'unknown'}.`);
}
console.log(`Using declared npm ${expectedVersion}.`);

function npmVersion() {
  const result = runNpm(['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function runNpm(args, options = {}) {
  const windows = process.platform === 'win32';
  return spawnSync(
    windows ? (process.env.ComSpec || 'cmd.exe') : 'npm',
    windows ? ['/d', '/s', '/c', 'npm', ...args] : args,
    { cwd: root, windowsHide: true, ...options }
  );
}
