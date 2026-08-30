import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultDevUserDataPath, shouldRestartForPath, watchRoots } from '../scripts/electron-dev-watch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');

assert.equal(manifest.scripts['electron:dev:watch'], 'node scripts/electron-dev-watch.mjs');
assert.equal(manifest.scripts['electron:dev:watch:isolated'], 'node scripts/electron-dev-watch.mjs --isolated');
assert.deepEqual([...watchRoots], ['electron', 'src', 'public', 'bin']);
assert.equal(shouldRestartForPath('electron', 'codex-bridge.js'), true);
assert.equal(shouldRestartForPath('src', 'ui/features/settings/application.js'), true);
assert.equal(shouldRestartForPath('src', 'ui/styles/app.css'), true);
assert.equal(shouldRestartForPath('public', 'app.js'), true);
assert.equal(shouldRestartForPath('public', 'dashboard.css'), false, 'generated CSS must not cause a second restart after its source CSS already triggered one');
assert.equal(shouldRestartForPath('electron', 'node_modules/electron/index.js'), false);
assert.match(defaultDevUserDataPath('/tmp/home').replaceAll('\\', '/'), /\/tmp\/home\/\.rel-ai-mcp-dev\/electron-user-data$/);
assert.match(mainSource, /REL_AI_ELECTRON_DEV_USER_DATA/);
assert.match(mainSource, /app\.setPath\('userData'/);

const help = spawnSync(process.execPath, [path.join(root, 'scripts', 'electron-dev-watch.mjs'), '--help'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true
});
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /Runs Rel\.AI Electron directly from source/);
assert.doesNotMatch(help.stdout, /dist|electron-builder/i, 'the fast dev loop must not imply packaging');

console.log('Electron source dev watcher contracts passed.');
