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
  'release-manifest.json',
  'electron/package.json',
  'electron/package-lock.json',
  'electron/renderer/status.html',
  'src/packageMetadata.js',
  'src/version.js',
  'scripts/release-check.mjs',
  'scripts/release-bump.mjs',
  'scripts/electron-package.mjs',
  'scripts/release-artifacts.mjs',
  'scripts/prepare-release-assets.mjs',
  'scripts/verify-updater-artifacts.mjs',
  'scripts/current-unpacked.mjs',
  'scripts/active-controller-guard.mjs',
  '.github/workflows/release.yml'
]) copyFile(file);

const ngrokManifestPath = path.join(tmp, 'vendor', 'ngrok', 'manifest.json');
fs.mkdirSync(path.dirname(ngrokManifestPath), { recursive: true });
const acquisitionManifest = {
  schemaVersion: 2,
  version: '3.39.10',
  delivery: 'verified-first-run-download',
  platforms: {
    win32: {
      architecture: 'x64',
      archive: {
        format: 'zip',
        url: 'https://bin.ngrok.com/a/reviewed/ngrok-v3-3.39.10-windows-amd64.zip',
        size: 123456,
        sha256: 'a'.repeat(64)
      },
      executable: {
        file: 'ngrok.exe',
        size: 654321,
        sha256: 'b'.repeat(64)
      },
      authenticode: { publisher: 'ngrok, Inc.', issuer: 'DigiCert' }
    }
  }
};
fs.writeFileSync(ngrokManifestPath, `${JSON.stringify(acquisitionManifest, null, 2)}\n`);

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

function runWithEnv(script, env = {}) {
  return spawnSync(process.execPath, [path.join(tmp, 'scripts', script)], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...process.env, REL_AI_RELEASE_ROOT: tmp, ...env }
  });
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(tmp, relativePath), 'utf8'));
}

run('release-check.mjs');
const copiedChangelogPath = path.join(tmp, 'CHANGELOG.md');
fs.writeFileSync(copiedChangelogPath, fs.readFileSync(copiedChangelogPath, 'utf8').replace(/\r?\n/g, '\r\n'));
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
assert.equal(readJson('release-manifest.json').applicationVersion, '0.99.0');
const electronPackage = readJson('electron/package.json');
const rootPackage = readJson('package.json');
assert.equal(rootPackage.productName, 'Rel.AI MCP');
assert.deepEqual(rootPackage.author, { name: 'Kyne', url: 'https://github.com/Kyne0328' });
assert.deepEqual(electronPackage.author, { name: 'Kyne', url: 'https://github.com/Kyne0328' });
assert.equal(electronPackage.dependencies['electron-updater'], '6.8.9');
assert.equal(electronPackage.devDependencies.electron, '43.2.0');
assert.equal(electronPackage.devDependencies['electron-builder'], '26.15.3');
assert.equal(electronPackage.devDependencies['@electron/fuses'], '2.1.3');
assert.equal(rootPackage.scripts['electron:build'], 'node scripts/electron-package.mjs --mode unpacked');
assert.equal(rootPackage.scripts['electron:dist'], 'node scripts/electron-package.mjs --mode release');
const electronPackageWrapper = fs.readFileSync(path.join(tmp, 'scripts', 'electron-package.mjs'), 'utf8');
assert.match(electronPackageWrapper, /assertSafeControllerOperation/);
assert.match(electronPackageWrapper, /'--publish', 'never'/);
assert.match(electronPackageWrapper, /packageBin\(path\.join\(electronRoot, 'node_modules', 'electron-builder'\), 'electron-builder'\)/);
assert.doesNotMatch(electronPackageWrapper, /npmCommand|npxCommand|npm\.cmd|npx\.cmd|shell:\s*true/i);
assert.match(electronPackageWrapper, /Electron release staging/);
assert.match(electronPackageWrapper, /NSIS artifact packaging/);
assert.match(electronPackageWrapper, /portable artifact packaging/);
assert.match(electronPackageWrapper, /os\.tmpdir\(\)/);
assert.match(electronPackageWrapper, /promoteReleaseOutput\(stagingRoot, path\.join\(root, 'dist'\)\)/);
assert.match(electronPackageWrapper, /invalidateDerivedReleaseEvidence\(destinationRoot, version\)/);
assert.match(electronPackageWrapper, /current-unpacked\.json/);
assert.match(electronPackageWrapper, /--prepackaged', prepackaged/);
assert.doesNotMatch(electronPackageWrapper, /quitAndInstall|Setup.*\.exe|uninstall/i);
assert.equal(rootPackage.scripts['verify:packaged'], 'node scripts/verify-packaged-wrapper.mjs');
assert.equal(rootPackage.scripts['verify:updater-artifacts'], 'node scripts/verify-updater-artifacts.mjs');
assert.equal(rootPackage.scripts['prepare:release-assets'], 'node scripts/prepare-release-assets.mjs');
assert.equal(rootPackage.scripts['test:connector-acceptance'], 'node scripts/packaged-connector-acceptance.mjs');
assert.equal(rootPackage.scripts['test:installed'], undefined);
assert.match(rootPackage.scripts['build:css'], /--minify/);
assert.equal(
  rootPackage.scripts['electron:size'],
  'node scripts/electron-package-size.mjs --dir dist --baseline scripts/electron-size-baseline.json --strict'
);
assert.equal(electronPackage.build.electronUpdaterCompatibility, '>=2.16');
assert.deepEqual(electronPackage.build.electronLanguages, ['en-US']);
assert.deepEqual(electronPackage.build.publish[0], {
  provider: 'github',
  owner: 'Kyne0328',
  repo: 'rel-ai-mcp',
  releaseType: 'release'
});
assert.ok(electronPackage.build.files.includes('app-updater.js'));
assert.ok(electronPackage.build.files.includes('app-updater-state.js'));
assert.ok(electronPackage.build.files.includes('desktop-lifecycle.js'));
assert.ok(electronPackage.build.files.includes('window-security.js'));
assert.ok(electronPackage.build.files.includes('diagnostic-files.js'));
assert.equal(electronPackage.build.files.includes('installed-smoke.js'), false);
assert.equal(electronPackage.build.files.includes('window-smoke.js'), false);
assert.equal(electronPackage.build.files.includes('smoke-evidence.js'), false);
assert.ok(electronPackage.build.files.includes('!**/*.map'));
const sourceResource = electronPackage.build.extraResources.find(resource => resource.to === 'src');
assert.deepEqual(sourceResource?.filter, ['**/*.js']);
const ngrokResource = electronPackage.build.extraResources.find(resource => resource.to === 'bin/ngrok');
assert.deepEqual(ngrokResource?.filter, ['manifest.json']);
const rootModulesResource = electronPackage.build.extraResources.find(resource => resource.to === 'node_modules');
assert.deepEqual(rootModulesResource?.filter, [
  '@modelcontextprotocol/core/**',
  '@modelcontextprotocol/node/**',
  '@modelcontextprotocol/server/**',
  '@opentelemetry/**',
  '@hono/node-server/**',
  'hono/**',
  'zod/**',
  '!**/*.map',
  '!@modelcontextprotocol/*/src/**',
  '!@opentelemetry/*/src/**',
  '!@hono/*/src/**',
  '!hono/src/**',
  '!zod/src/**',
  '!**/test/**',
  '!**/tests/**',
  '!**/*.ts',
  '!**/*.cts',
  '!**/*.mts'
]);
assert.deepEqual(electronPackage.build.nsis, {
  artifactName: 'Rel.AI-MCP-Setup-${version}.${ext}',
  oneClick: false,
  perMachine: false,
  allowElevation: true,
  allowToChangeInstallationDirectory: true,
  createDesktopShortcut: true,
  createStartMenuShortcut: true,
  shortcutName: 'Rel.AI MCP',
  runAfterFinish: true
});
assert.deepEqual(electronPackage.build.portable, {
  artifactName: 'Rel.AI-MCP-Portable-${version}.${ext}'
});

const statusHtml = fs.readFileSync(path.join(tmp, 'electron/renderer/status.html'), 'utf8');
assert.match(statusHtml, /id="appVersion">v0\.99\.0<\/span>/);

const changelog = fs.readFileSync(path.join(tmp, 'CHANGELOG.md'), 'utf8');
assert.match(changelog, /^## \[0\.99\.0\] — 2099-01-02/m);
assert.match(changelog, /Bump root\/electron\/status UI\/lockfiles to 0\.99\.0\./);
assert.doesNotMatch(changelog.split('## [0.15.7]')[0], /TODO|placeholder/i);

const releaseWorkflow = fs.readFileSync(path.join(tmp, '.github/workflows/release.yml'), 'utf8');
const productionAuditIndex = releaseWorkflow.indexOf('- name: Audit production dependencies');
const packagingAuditIndex = releaseWorkflow.indexOf('- name: Audit packaging dependencies');
const verifyAcquisitionIndex = releaseWorkflow.indexOf('- name: Verify official ngrok acquisition end to end');
const runTestsIndex = releaseWorkflow.indexOf('- name: Run tests');
const buildIndex = releaseWorkflow.indexOf('- name: Build Windows executables');
assert.ok(productionAuditIndex >= 0, 'release workflow must audit production dependencies');
assert.ok(packagingAuditIndex > productionAuditIndex, 'packaging audit must follow production audit');
assert.ok(packagingAuditIndex < buildIndex, 'packaging audit must block packaging');
assert.ok(verifyAcquisitionIndex >= 0, 'release workflow must exercise the official ngrok acquisition path');
assert.ok(verifyAcquisitionIndex < runTestsIndex, 'ngrok acquisition verification must run before release tests');
assert.ok(verifyAcquisitionIndex < buildIndex, 'ngrok acquisition verification must block packaging');
assert.match(releaseWorkflow, /workflow_dispatch:/);
assert.match(releaseWorkflow, /\.github\/workflows\/release\.yml/);
assert.match(releaseWorkflow, /Release workflow changed while package version remains/);
assert.match(releaseWorkflow, /id:\s+preflight/);
assert.match(releaseWorkflow, /publish=true/);
assert.match(releaseWorkflow, /publish=false/);
assert.match(releaseWorkflow, /steps\.preflight\.outputs\.publish == 'true'/);
assert.match(releaseWorkflow, /Invoke-WebRequest[^\n]*-SkipHttpErrorCheck/);
assert.match(releaseWorkflow, /\$releaseStatus\s*=\s*\[int\]\$response\.StatusCode/);
assert.match(releaseWorkflow, /if \(\$releaseStatus -eq 200\)/);
assert.match(releaseWorkflow, /if \(\$releaseStatus -ne 404\)/);
assert.doesNotMatch(releaseWorkflow, /gh release view/, 'Release existence checks must not depend on gh CLI exit-code conventions.');
assert.match(releaseWorkflow, /Rel\.AI-MCP-Setup-\$env:VERSION\.exe/);
assert.match(releaseWorkflow, /Rel\.AI-MCP-Portable-\$env:VERSION\.exe/);
assert.match(releaseWorkflow, /Rel\.AI-MCP-Setup-\$env:VERSION\.exe\.blockmap/);
assert.match(releaseWorkflow, /release-assets\.txt/);
assert.match(releaseWorkflow, /SHA256SUMS\.txt/);
assert.match(releaseWorkflow, /npm run prepare:release-assets/);
assert.match(releaseWorkflow, /exact updater contract/);
assert.match(releaseWorkflow, /npm run benchmark:observability/);
assert.match(releaseWorkflow, /npm run test:observability-browser/);
assert.match(releaseWorkflow, /Verify packaged application layout/);
assert.match(releaseWorkflow, /Resolve current unpacked application/);
assert.match(releaseWorkflow, /node scripts\/current-unpacked\.mjs/);
assert.match(releaseWorkflow, /npm run verify:packaged -- --dir '\$\{\{ steps\.unpacked\.outputs\.path \}\}'/);
assert.match(releaseWorkflow, /npm run test:connector-acceptance -- --dir '\$\{\{ steps\.unpacked\.outputs\.path \}\}'/);
assert.match(releaseWorkflow, /npm run audit:production/);
assert.match(releaseWorkflow, /npm run audit:packaging/);
assert.doesNotMatch(releaseWorkflow, /test:installed|REL_AI_SMOKE_INSTALLER|REL_AI_RELEASE_EVIDENCE_DIR|release-evidence-check\.mjs|release-readiness\.json|release-usability-evidence\.zip/);
assert.match(releaseWorkflow, /node-version:\s*24/);
assert.doesNotMatch(releaseWorkflow, /actions\/(?:checkout|setup-node|upload-artifact|attest-build-provenance|attest-sbom)@v\d+/);
assert.match(releaseWorkflow, /Verify hardened Electron fuses/);
assert.match(releaseWorkflow, /Require Windows signing credentials/);
assert.match(releaseWorkflow, /WINDOWS_CSC_LINK is required for release publication/);
assert.match(releaseWorkflow, /WINDOWS_CSC_KEY_PASSWORD is required for release publication/);
assert.match(releaseWorkflow, /--config\.forceCodeSigning=true/);
assert.match(releaseWorkflow, /Verify Windows signatures and ngrok acquisition boundary/);
assert.match(releaseWorkflow, /steps\.unpacked\.outputs\.path/);
assert.match(releaseWorkflow, /Join-Path \$packageDirectory 'Rel\.AI MCP\.exe'/);
assert.match(releaseWorkflow, /npm run verify:ngrok -- --download/);
assert.match(releaseWorkflow, /resources\/bin\/ngrok\/manifest\.json/);
assert.match(releaseWorkflow, /release package embeds ngrok\.exe/);
assert.doesNotMatch(releaseWorkflow, /Packaged ngrok SHA-256 mismatch|Packaged ngrok Authenticode signature is not valid/);
assert.doesNotMatch(releaseWorkflow, /artifacts will be unsigned|SIGNING_CONFIGURED/);
assert.match(releaseWorkflow, /Generate CycloneDX SBOM/);
assert.match(releaseWorkflow, /sbom\.cdx\.json/);
assert.match(releaseWorkflow, /Attest release artifact provenance/);
assert.match(releaseWorkflow, /Attest release SBOM/);
assert.match(releaseWorkflow, /Report Electron package size/);
assert.match(releaseWorkflow, /npm run electron:size -- --json dist\/electron-size-report\.json/);
assert.match(releaseWorkflow, /Upload Electron package-size report/);
assert.match(releaseWorkflow, /electron-size-report\.json/);
assert.match(releaseWorkflow, /if-no-files-found: error/);
assert.doesNotMatch(releaseWorkflow, /Upload release usability evidence|exact-installer usability evidence JSON is missing|release usability screenshot archive is missing/);

const tamperedManifest = structuredClone(acquisitionManifest);
tamperedManifest.platforms.win32.archive.sha256 = 'invalid';
fs.writeFileSync(ngrokManifestPath, `${JSON.stringify(tamperedManifest, null, 2)}\n`);
const tampered = runWithEnv('release-check.mjs');
assert.notEqual(tampered.status, 0, 'release consistency must fail when the ngrok archive hash is invalid');
assert.match(`${tampered.stdout}\n${tampered.stderr}`, /archive SHA-256 must be exact/i);
fs.writeFileSync(ngrokManifestPath, `${JSON.stringify(acquisitionManifest, null, 2)}\n`);

fs.rmSync(ngrokManifestPath, { force: true });
const missingManifest = runWithEnv('release-check.mjs');
assert.notEqual(missingManifest.status, 0, 'release consistency must fail when the ngrok acquisition manifest is missing');
assert.match(`${missingManifest.stdout}\n${missingManifest.stderr}`, /ngrok acquisition manifest is missing/i);

console.log('Release workflow smoke test passed.');
