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
  assert.doesNotMatch(command, /installed-app-smoke|test:installed|\/S\b|--uninstall|uninstall/i,
    `${name} must not invoke installer or uninstaller lifecycle behavior`);
}

assert.equal(packageJson.scripts['electron:build'], 'node scripts/electron-package.mjs --mode unpacked');
assert.equal(packageJson.scripts['electron:dist'], 'node scripts/electron-package.mjs --mode release');
const packageWrapper = read('scripts/electron-package.mjs');
const cleanScript = read('scripts/clean.mjs');
assert.match(packageWrapper, /assertSafeControllerOperation/);
assert.match(packageWrapper, /--publish', 'never'/);
assert.match(packageWrapper, /packageBin\(path\.join\(electronRoot, 'node_modules', 'electron-builder'\), 'electron-builder'\)/);
assert.match(packageWrapper, /packageBin\(path\.join\(root, 'node_modules', '@tailwindcss', 'cli'\), 'tailwindcss'\)/);
assert.doesNotMatch(packageWrapper, /npmCommand|npxCommand|npm\.cmd|npx\.cmd|shell:\s*true/i);
assert.match(packageWrapper, /Electron release staging/);
assert.match(packageWrapper, /NSIS artifact packaging/);
assert.match(packageWrapper, /portable artifact packaging/);
assert.match(packageWrapper, /os\.tmpdir\(\)/);
assert.match(packageWrapper, /promoteReleaseOutput\(stagingRoot, path\.join\(root, 'dist'\)\)/);
assert.match(packageWrapper, /current-unpacked\.json/);
assert.match(packageWrapper, /removeObsoleteUnpackedBuilds/);
assert.match(packageWrapper, /Existing dist\/win-unpacked is locked and was preserved/);
assert.match(packageWrapper, /--prepackaged', prepackaged/);
assert.match(packageWrapper, /--prepackaged', portablePrepackaged/);
assert.match(packageWrapper, /await Promise\.all/);
assert.match(packageWrapper, /fs\.cpSync\(prepackaged, portablePrepackaged/);
assert.match(packageWrapper, /nsis-output/);
assert.match(packageWrapper, /portable-output/);
assert.match(packageWrapper, /collectArtifactFiles/);
assert.match(packageWrapper, /RELEASE_ARCHIVE_COMPRESSION_LEVEL = '5'/);
assert.match(packageWrapper, /ELECTRON_BUILDER_COMPRESSION_LEVEL: RELEASE_ARCHIVE_COMPRESSION_LEVEL/);
assert.match(packageWrapper, /assertPrepackagedApp\(prepackaged\)/);
assert.doesNotMatch(packageWrapper, /'--win',\s*'nsis',\s*'portable'/);
assert.doesNotMatch(packageWrapper, /color-token generation/);
assert.doesNotMatch(packageWrapper, /runNode\('release cleanup'/);
assert.doesNotMatch(packageWrapper, /Setup.*\.exe|quitAndInstall|uninstall/i);
assert.match(cleanScript, /assertSafeControllerOperation/);
assert.match(cleanScript, /maxRetries:\s*process\.platform === 'win32' \? 10 : 2/);
assert.match(cleanScript, /retryDelay:\s*250/);

assert.equal(packageJson.scripts.test, 'npm run test:all');
assert.match(packageJson.scripts['test:all'], /test\/run-tests\.mjs/);
assert.doesNotMatch(packageJson.scripts['test:all'], /electron:dist|electron-builder|installer|uninstall/i);
assert.doesNotMatch(testRunner, /scripts\/installed-app-smoke|electron-builder|installer|uninstall/i);
assert.equal(fs.existsSync(path.join(root, 'scripts', 'installed-app-smoke.mjs')), false,
  'the host-destructive installed-app harness must remain removed');

assert.equal(electronPackage.scripts?.postinstall, 'node node_modules/electron/install.js',
  'clean Electron installs must always provision the pinned runtime binary');
assert.equal(electronPackage.devDependencies.electron, '43.2.0',
  'Electron runtime provisioning must remain pinned to the package version under test');

assert.match(ci, /Build unpacked Windows application/);
assert.match(ci, /Verify packaged application layout/);
assert.match(ci, /Verify Electron test binary/);
assert.doesNotMatch(ci, /test:installed|REL_AI_SMOKE_INSTALLER|uninstall|Setup.*\.exe/i);
assert.match(release, /Verify packaged application layout/);
assert.match(release, /Verify Electron test binary/);
assert.doesNotMatch(release, /test:installed|REL_AI_SMOKE_INSTALLER|release-evidence-check|uninstall/i);

assert.equal(electronPackage.build.appId, 'com.relai.mcp');
assert.equal(electronPackage.build.productName, 'Rel.AI MCP');
assert.ok(!Object.keys(packageJson.scripts).some(name => /installer|installed/.test(name)),
  'installer lifecycle tests must not be exposed through ordinary package scripts');

console.log('Installer entry-point isolation regression tests passed.');
