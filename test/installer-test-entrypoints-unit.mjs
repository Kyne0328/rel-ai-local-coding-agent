import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release.yml');
const testRunner = read('test/run-tests.mjs');
const electronPackage = JSON.parse(read('electron/package.json'));

for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  if (name === 'electron:dist') continue;
  assert.doesNotMatch(command, /installed-app-smoke|test:installed|\/S\b|--uninstall|uninstall/i,
    `${name} must not invoke installer or uninstaller lifecycle behavior`);
}

assert.equal(packageJson.scripts.test, 'npm run test:all');
assert.match(packageJson.scripts['test:all'], /test\/run-tests\.mjs/);
assert.doesNotMatch(packageJson.scripts['test:all'], /electron:dist|electron-builder|installer|uninstall/i);
assert.doesNotMatch(testRunner, /scripts\/installed-app-smoke|electron-builder|installer|uninstall/i);
assert.equal(fs.existsSync(path.join(root, 'scripts', 'installed-app-smoke.mjs')), false,
  'the host-destructive installed-app harness must remain removed');

assert.match(ci, /Build unpacked Windows application/);
assert.match(ci, /Verify packaged application layout/);
assert.doesNotMatch(ci, /test:installed|REL_AI_SMOKE_INSTALLER|uninstall|Setup.*\.exe/i);
assert.match(release, /Verify packaged application layout/);
assert.doesNotMatch(release, /test:installed|REL_AI_SMOKE_INSTALLER|release-evidence-check|uninstall/i);

assert.equal(electronPackage.build.appId, 'com.relai.mcp');
assert.equal(electronPackage.build.productName, 'Rel.AI MCP');
assert.ok(!Object.keys(packageJson.scripts).some(name => /installer|installed/.test(name)),
  'installer lifecycle tests must not be exposed through ordinary package scripts');

console.log('Installer entry-point isolation regression tests passed.');
