import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-release-workflow-'));

function copyFile(relativePath) {
  const src = path.join(root, relativePath);
  const dst = path.join(tmp, relativePath);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

for (const file of [
  'package.json',
  'package-lock.json',
  'CHANGELOG.md',
  'electron/package.json',
  'electron/package-lock.json',
  'electron/renderer/status.html',
  'public/extensions/chrome-auto-approve/manifest.json',
  'src/version.js',
  'scripts/release-check.mjs',
  'scripts/release-bump.mjs'
]) copyFile(file);

function run(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(tmp, 'scripts', script), ...args], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...process.env, REL_AI_RELEASE_ROOT: tmp }
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
  }
  assert.equal(result.status, 0, `${script} ${args.join(' ')} should pass`);
  return result;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(tmp, relativePath), 'utf8'));
}

run('release-check.mjs');
run('release-bump.mjs', [
  '0.99.0',
  '--date', '2099-01-02',
  '--headline', 'Release workflow automation',
  '--note', 'Version files update together',
  '--note', 'Release consistency checks pass after the bump'
]);
run('release-check.mjs');

assert.equal(readJson('package.json').version, '0.99.0');
assert.equal(readJson('package-lock.json').packages[''].version, '0.99.0');
assert.equal(readJson('electron/package.json').version, '0.99.0');
assert.equal(readJson('electron/package-lock.json').packages[''].version, '0.99.0');
assert.equal(readJson('public/extensions/chrome-auto-approve/manifest.json').version, '0.99.0');

const statusHtml = fs.readFileSync(path.join(tmp, 'electron/renderer/status.html'), 'utf8');
assert.match(statusHtml, /id="appVersion">v0\.99\.0<\/span>/);

const changelog = fs.readFileSync(path.join(tmp, 'CHANGELOG.md'), 'utf8');
assert.match(changelog, /^## \[0\.99\.0\] — 2099-01-02/m);
assert.match(changelog, /Bump root\/electron\/extension\/status UI\/lockfiles to 0\.99\.0\./);
assert.doesNotMatch(changelog.split('## [0.15.7]')[0], /TODO|placeholder/i);

console.log('Release workflow smoke test passed.');
