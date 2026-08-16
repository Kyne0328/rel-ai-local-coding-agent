import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const testRunner = read('test/run-tests.mjs');
const electronPackage = JSON.parse(read('electron/package.json'));
const electronPackageLock = JSON.parse(read('electron/package-lock.json'));

for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  assert.doesNotMatch(command, /installed-app-smoke|test:installed|\/S\b|--uninstall|uninstall/i,
    `${name} must not invoke installer or uninstaller lifecycle behavior`);
}

for (const [name, mode, platform] of [
  ['electron:build', 'unpacked', 'win32'],
  ['electron:build:linux', 'unpacked', 'linux'],
  ['electron:build:mac', 'unpacked', 'darwin'],
  ['electron:dist', 'release', 'win32'],
  ['electron:dist:linux', 'release', 'linux'],
  ['electron:dist:mac', 'release', 'darwin']
]) {
  const command = String(packageJson.scripts[name] || '');
  assert.match(command, /scripts\/electron-package\.mjs/, `${name} must use the shared packaging entry point`);
  assert.match(command, new RegExp(`--mode\\s+${mode}\\b`), `${name} must select ${mode} packaging`);
  assert.match(command, new RegExp(`--platform\\s+${platform}\\b`), `${name} must select ${platform}`);
}
const packageWrapper = read('scripts/electron-package.mjs');
const cleanScript = read('scripts/clean.mjs');
assert.match(packageWrapper, /assertSafeControllerOperation/, 'packaging must keep the destructive-operation safety guard');
assert.match(cleanScript, /assertSafeControllerOperation/, 'cleanup must keep the destructive-operation safety guard');
assert.doesNotMatch(packageWrapper, /npmCommand|npxCommand|npm\.cmd|npx\.cmd|shell:\s*true/i,
  'packaging must not introduce shell-mediated dependency execution');
assert.doesNotMatch(packageWrapper, /Setup.*\.exe|quitAndInstall|uninstall/i,
  'build orchestration must never execute installer lifecycle behavior');

assert.equal(packageJson.scripts.test, 'npm run test:all');
assert.match(packageJson.scripts['test:all'], /test\/run-tests\.mjs/);
assert.doesNotMatch(packageJson.scripts['test:all'], /release-check\.mjs/, 'normal development tests must not require finalized release metadata');
assert.doesNotMatch(packageJson.scripts['test:all'], /electron:dist|electron-builder|installer|uninstall/i);
assert.doesNotMatch(testRunner, /scripts\/installed-app-smoke|electron-builder|installer|uninstall/i);
assert.equal(fs.existsSync(path.join(root, 'scripts', 'installed-app-smoke.mjs')), false,
  'the host-destructive installed-app harness must remain removed');

assert.match(packageJson.scripts['release:check'], /release-check\.mjs/, 'release validation must still enforce finalized release metadata');

assert.match(String(electronPackage.scripts?.postinstall || ''), /electron\/install\.js/,
  'clean Electron installs must always provision the pinned runtime binary');
assert.match(electronPackage.devDependencies.electron, /^\d+\.\d+\.\d+$/,
  'Electron runtime provisioning must use an exact package version');
assert.equal(electronPackageLock.packages?.['']?.devDependencies?.electron, electronPackage.devDependencies.electron,
  'Electron runtime provisioning must remain pinned to the package version under test');
assert.deepEqual(electronPackage.build.linux.target, ['AppImage', 'deb']);
assert.deepEqual(electronPackage.build.mac.target, ['dmg']);
assert.equal(electronPackage.build.mac.identity, null, 'macOS builds remain unsigned until signing is implemented as a separate release improvement');
assert.match(electronPackage.build.dmg.artifactName, /\$\{version\}[\s\S]*\$\{arch\}[\s\S]*\$\{ext\}/);
assert.equal(electronPackage.build.nsis.deleteAppDataOnUninstall, false,
  'normal uninstall must not enable electron-builder app-data deletion');
assert.equal(electronPackage.homepage, 'https://github.com/Kyne0328/rel-ai-mcp');
assert.equal(electronPackage.build.linux.maintainer, 'Kyne <Kyne0328@users.noreply.github.com>');
assert.match(electronPackage.build.appImage.artifactName, /\$\{version\}[\s\S]*\$\{ext\}/);
assert.match(electronPackage.build.deb.artifactName, /\$\{version\}[\s\S]*\$\{ext\}/);
assert.equal(electronPackage.build.deb.packageName, 'rel-ai-mcp-launcher',
  'DEB releases must keep the historical package identity so newer versions upgrade existing installations');

assert.equal(electronPackage.build.appId, 'com.relai.mcp');
assert.equal(electronPackage.build.productName, 'Rel.AI MCP');
assert.ok(!Object.keys(packageJson.scripts).some(name => /installer|installed/.test(name)),
  'installer lifecycle tests must not be exposed through ordinary package scripts');
const installedReleaseValidation = read('scripts/validate-installed-release.mjs');
assert.match(installedReleaseValidation, /GITHUB_ACTIONS/,
  'installed release validation must remain restricted to disposable CI runners');
assert.match(installedReleaseValidation, /REL_AI_RELEASE_INSTALL_TEST/,
  'installed release validation must require an explicit release-only opt in');
assert.match(installedReleaseValidation, /createInstallerTestContext/,
  'Windows production-identity validation must retain the installer safety guard');

console.log('Cross-platform packaging entry-point isolation regression tests passed.');
