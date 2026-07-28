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
  'src/version.js',
  'scripts/release-check.mjs',
  'scripts/release-bump.mjs',
  '.github/workflows/release.yml'
]) copyFile(file);

const seedPath = path.join(tmp, 'vendor', 'ngrok', 'win32', 'ngrok.exe');
fs.mkdirSync(path.dirname(seedPath), { recursive: true });
fs.writeFileSync(seedPath, Buffer.alloc(5 * 1024 * 1024));

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
const electronPackage = readJson('electron/package.json');
const rootPackage = readJson('package.json');
assert.equal(rootPackage.productName, 'Rel.AI MCP');
assert.deepEqual(rootPackage.author, { name: 'Kyne', url: 'https://github.com/Kyne0328' });
assert.deepEqual(electronPackage.author, { name: 'Kyne', url: 'https://github.com/Kyne0328' });
assert.equal(electronPackage.dependencies['electron-updater'], '6.8.9');
assert.equal(electronPackage.devDependencies.electron, '43.2.0');
assert.equal(electronPackage.devDependencies['electron-builder'], '26.15.7');
assert.equal(electronPackage.devDependencies['@electron/fuses'], '2.1.3');
assert.match(rootPackage.scripts['electron:build'], /--publish never/);
assert.match(rootPackage.scripts['electron:dist'], /--publish never/);
assert.equal(rootPackage.scripts['verify:packaged'], 'node scripts/verify-packaged-app.mjs');
assert.equal(rootPackage.scripts['test:connector-acceptance'], 'node scripts/packaged-connector-acceptance.mjs');
assert.equal(rootPackage.scripts['test:installed'], undefined);
assert.match(rootPackage.scripts['build:css'], /--minify/);
assert.equal(
  rootPackage.scripts['electron:size'],
  'node scripts/electron-package-size.mjs --dir dist --baseline scripts/electron-size-baseline.json --warn-only'
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
const rootModulesResource = electronPackage.build.extraResources.find(resource => resource.to === 'node_modules');
assert.deepEqual(rootModulesResource?.filter, [
  '@modelcontextprotocol/core/**',
  '@modelcontextprotocol/node/**',
  '@modelcontextprotocol/server/**',
  '@hono/node-server/**',
  'hono/**',
  'zod/**',
  '!**/*.map'
]);
assert.deepEqual(electronPackage.build.nsis, {
  oneClick: false,
  perMachine: false,
  allowElevation: true,
  allowToChangeInstallationDirectory: true,
  createDesktopShortcut: true,
  createStartMenuShortcut: true,
  shortcutName: 'Rel.AI MCP',
  runAfterFinish: true
});

const statusHtml = fs.readFileSync(path.join(tmp, 'electron/renderer/status.html'), 'utf8');
assert.match(statusHtml, /id="appVersion">v0\.99\.0<\/span>/);

const changelog = fs.readFileSync(path.join(tmp, 'CHANGELOG.md'), 'utf8');
assert.match(changelog, /^## \[0\.99\.0\] — 2099-01-02/m);
assert.match(changelog, /Bump root\/electron\/status UI\/lockfiles to 0\.99\.0\./);
assert.doesNotMatch(changelog.split('## [0.15.7]')[0], /TODO|placeholder/i);

const releaseWorkflow = fs.readFileSync(path.join(tmp, '.github/workflows/release.yml'), 'utf8');
const fetchSeedIndex = releaseWorkflow.indexOf('- name: Fetch bundled ngrok seed binary');
const runTestsIndex = releaseWorkflow.indexOf('- name: Run tests');
const buildIndex = releaseWorkflow.indexOf('- name: Build Windows executables');
assert.ok(fetchSeedIndex >= 0, 'release workflow must fetch the bundled ngrok seed');
assert.ok(fetchSeedIndex < runTestsIndex, 'ngrok seed must be fetched before release consistency tests');
assert.ok(fetchSeedIndex < buildIndex, 'ngrok seed must be fetched before packaging');
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
assert.match(releaseWorkflow, /dist\/latest\.yml|dist\\latest\.yml|Join-Path[^\n]*latest\.yml/);
assert.match(releaseWorkflow, /\*\.blockmap/);
assert.match(releaseWorkflow, /\$executables\.Count -lt 2/);
assert.match(releaseWorkflow, /installed and portable Windows executables/);
assert.match(releaseWorkflow, /release-assets\.txt/);
assert.match(releaseWorkflow, /SHA256SUMS\.txt/);
assert.match(releaseWorkflow, /Get-FileHash/);
assert.match(releaseWorkflow, /-Algorithm SHA256/);
assert.match(releaseWorkflow, /sha512:/);
assert.match(releaseWorkflow, /does not contain SHA-512 update metadata/);
assert.match(releaseWorkflow, /Verify packaged application layout/);
assert.match(releaseWorkflow, /npm run verify:packaged -- --dir dist\/win-unpacked/);
assert.match(releaseWorkflow, /npm run test:connector-acceptance -- --dir dist\/win-unpacked/);
assert.doesNotMatch(releaseWorkflow, /test:installed|REL_AI_SMOKE_INSTALLER|REL_AI_RELEASE_EVIDENCE_DIR|release-evidence-check\.mjs|release-readiness\.json|release-usability-evidence\.zip/);
assert.match(releaseWorkflow, /node-version:\s*24/);
assert.doesNotMatch(releaseWorkflow, /actions\/(?:checkout|setup-node|upload-artifact|attest-build-provenance|attest-sbom)@v\d+/);
assert.match(releaseWorkflow, /Verify hardened Electron fuses/);
assert.match(releaseWorkflow, /Require Windows signing credentials/);
assert.match(releaseWorkflow, /WINDOWS_CSC_LINK is required for release publication/);
assert.match(releaseWorkflow, /WINDOWS_CSC_KEY_PASSWORD is required for release publication/);
assert.match(releaseWorkflow, /Verify Windows signatures/);
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

fs.rmSync(seedPath, { force: true });
const missingSeed = runWithEnv('release-check.mjs', { REL_AI_TARGET_PLATFORM: 'win32' });
assert.notEqual(missingSeed.status, 0, 'release consistency must fail when the target ngrok seed is missing');
assert.match(`${missingSeed.stdout}\n${missingSeed.stderr}`, /bundled ngrok seed is missing for win32/i);

console.log('Release workflow smoke test passed.');
