import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-release-workflow-'));

try {
  copyFixture();
  verifyReleaseBump();
  verifyPackageContracts();
  verifyWorkflowContracts();
  verifyTunnelClientTamperDetection();
  console.log('Cross-platform release workflow smoke test passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function copyFixture() {
  for (const relativePath of [
    'package.json',
    'package-lock.json',
    'CHANGELOG.md',
    'release-manifest.json',
    '.codex-plugin/plugin.json',
    'electron/package.json',
    'electron/package-lock.json',
    'electron/renderer/status.html',
    'electron/scripts/verify-fuses.js',
    'src/packageMetadata.js',
    'src/version.js',
    'scripts/release-check.mjs',
    'scripts/release-bump.mjs',
    'scripts/check-generated.mjs',
    'scripts/electron-package.mjs',
    'scripts/electron-platform.mjs',
    'scripts/release-artifacts.mjs',
    'scripts/prepare-release-assets.mjs',
    'scripts/verify-updater-artifacts.mjs',
    'scripts/verify-fuses.mjs',
    'scripts/current-unpacked.mjs',
    'scripts/active-controller-guard.mjs',
    '.github/workflows/release.yml'
  ]) {
    const source = path.join(root, relativePath);
    const destination = path.join(tmp, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  const seedPath = path.join(tmp, 'vendor', 'tunnel-client', 'win32', 'tunnel-client.exe');
  const seedBytes = Buffer.alloc(5 * 1024 * 1024);
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });
  fs.writeFileSync(seedPath, seedBytes);
  fs.writeFileSync(path.join(tmp, 'vendor', 'tunnel-client', 'manifest.json'), `${JSON.stringify({
    version: 'test',
    license: 'Apache-2.0',
    source: 'https://github.com/openai/tunnel-client',
    platforms: {
      win32: {
        file: 'tunnel-client.exe',
        size: seedBytes.length,
        sha256: crypto.createHash('sha256').update(seedBytes).digest('hex')
      }
    }
  }, null, 2)}\n`);
}

function verifyReleaseBump() {
  run('release-check.mjs');
  const changelogPath = path.join(tmp, 'CHANGELOG.md');
  fs.writeFileSync(changelogPath, fs.readFileSync(changelogPath, 'utf8').replace(/\r?\n/g, '\r\n'));
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
  assert.equal(readJson('.codex-plugin/plugin.json').version, '0.99.0');
  assert.equal(readJson('release-manifest.json').applicationVersion, '0.99.0');
  assert.match(fs.readFileSync(changelogPath, 'utf8'), /^## \[0\.99\.0\] — 2099-01-02/m);
}

function verifyPackageContracts() {
  const rootPackage = readJson('package.json');
  const electronPackage = readJson('electron/package.json');
  const electronLockRoot = readJson('electron/package-lock.json').packages?.[''] || {};
  assert.equal(rootPackage.productName, 'Rel.AI MCP');
  assert.deepEqual(rootPackage.author, { name: 'Kyne', url: 'https://github.com/Kyne0328' });
  assert.deepEqual(electronPackage.author, {
    name: 'Kyne',
    email: 'Kyne0328@users.noreply.github.com',
    url: 'https://github.com/Kyne0328'
  });
  assert.equal(electronPackage.homepage, 'https://github.com/Kyne0328/rel-ai-mcp');
  assert.deepEqual(electronLockRoot.dependencies || {}, electronPackage.dependencies || {}, 'Electron runtime dependencies must stay synchronized with the lockfile');
  assert.deepEqual(electronLockRoot.devDependencies || {}, electronPackage.devDependencies || {}, 'Electron development dependencies must stay synchronized with the lockfile');

  assert.equal(rootPackage.scripts['electron:build'], 'node scripts/electron-package.mjs --mode unpacked --platform win32');
  assert.equal(rootPackage.scripts['electron:build:linux'], 'node scripts/electron-package.mjs --mode unpacked --platform linux');
  assert.equal(rootPackage.scripts['electron:build:mac'], 'node scripts/electron-package.mjs --mode unpacked --platform darwin');
  assert.equal(rootPackage.scripts['electron:dist'], 'node scripts/electron-package.mjs --mode release --platform win32');
  assert.equal(rootPackage.scripts['electron:dist:linux'], 'node scripts/electron-package.mjs --mode release --platform linux');
  assert.equal(rootPackage.scripts['electron:dist:mac'], 'node scripts/electron-package.mjs --mode release --platform darwin');
  assert.equal(rootPackage.scripts['electron:size'], 'node scripts/electron-package-size.mjs --dir dist --platform win32 --baseline scripts/electron-size-baseline.json --strict');
  assert.equal(rootPackage.scripts['electron:size:linux'], 'node scripts/electron-package-size.mjs --dir dist --platform linux --baseline scripts/electron-size-baseline-linux.json --strict');
  assert.equal(rootPackage.scripts['test:installed'], undefined);

  assert.equal(electronPackage.build.electronUpdaterCompatibility, '>=2.16');
  assert.deepEqual(electronPackage.build.electronLanguages, ['en-US']);
  assert.deepEqual(electronPackage.build.win.target, ['nsis', 'portable']);
  assert.deepEqual(electronPackage.build.linux.target, ['AppImage', 'deb']);
  assert.deepEqual(electronPackage.build.mac.target, ['dmg']);
  assert.equal(electronPackage.build.mac.identity, null);
  assert.equal(electronPackage.build.dmg.artifactName, 'Rel.AI-MCP-${version}-mac-${arch}.${ext}');
  assert.equal(electronPackage.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(electronPackage.build.linux.maintainer, 'Kyne <Kyne0328@users.noreply.github.com>');
  assert.equal(electronPackage.build.linux.executableName, 'rel-ai-mcp');
  assert.equal(electronPackage.build.appImage.artifactName, 'Rel.AI-MCP-${version}-linux-x64.${ext}');
  assert.equal(electronPackage.build.deb.artifactName, 'Rel.AI-MCP-${version}-linux-x64.${ext}');
  assert.deepEqual(
    electronPackage.build.win.extraResources.find(resource => resource.to === 'bin/tunnel-client')?.filter,
    ['manifest.json', 'win32/**']
  );
  assert.deepEqual(
    electronPackage.build.linux.extraResources.find(resource => resource.to === 'bin/tunnel-client')?.filter,
    ['manifest.json', 'linux/**']
  );

  const wrapper = fs.readFileSync(path.join(tmp, 'scripts', 'electron-package.mjs'), 'utf8');
  for (const pattern of [
    /assertSafeControllerOperation/,
    /assertSupportedBuildHost/,
    /packageWindowsRelease/,
    /packageLinuxRelease/,
    /packageMacRelease/,
    /Electron Windows release staging/,
    /Electron Linux release staging/,
    /Electron macOS release staging/,
    /DMG artifact packaging/,
    /NSIS artifact packaging/,
    /portable artifact packaging/,
    /AppImage and DEB artifact packaging/,
    /canonical\.linuxAppImage/,
    /canonical\.linuxDeb/,
    /canonical\.linuxMetadata/,
    /function isBuilderDiagnosticArtifact/,
    /Ignored electron-builder diagnostics/,
    /filter\(entry => requiredArtifacts\.includes\(entry\.name\)\)/,
    /!isBuilderDiagnosticArtifact\(name\)/,
    /spec\.markerName/,
    /await Promise\.all/,
    /--prepackaged', prepackaged/,
    /ELECTRON_BUILDER_COMPRESSION_LEVEL: RELEASE_ARCHIVE_COMPRESSION_LEVEL/
  ]) assert.match(wrapper, pattern);
  assert.doesNotMatch(wrapper, /npmCommand|npxCommand|npm\.cmd|npx\.cmd|shell:\s*true/i);
  assert.doesNotMatch(wrapper, /'--win',\s*'nsis',\s*'portable'/);
  assert.doesNotMatch(wrapper, /quitAndInstall|Setup.*\.exe|uninstall/i);

  const generatedCheck = fs.readFileSync(path.join(tmp, 'scripts', 'check-generated.mjs'), 'utf8');
  assert.match(generatedCheck, /public\/dashboard\.css/, 'generated asset verification must track public/dashboard.css');
  assert.match(generatedCheck, /runNpm\(\['run', 'build:css'\]/, 'generated asset verification must rebuild dashboard CSS');
  assert.match(generatedCheck, /dashboardCssBefore\.equals\(dashboardCssAfter\)/, 'generated asset verification must compare dashboard CSS before and after regeneration');
}

function verifyWorkflowContracts() {
  const workflow = fs.readFileSync(path.join(tmp, '.github', 'workflows', 'release.yml'), 'utf8');
  const productionAuditIndex = workflow.indexOf('- name: Audit production dependencies');
  const packagingAuditIndex = workflow.indexOf('- name: Audit packaging dependencies');
  const windowsBuildIndex = workflow.indexOf('- name: Build Windows release');
  const fetchWindowsSeedIndex = workflow.indexOf('TUNNEL_CLIENT_PLATFORMS: win32');
  const testsIndex = workflow.indexOf('- name: Run tests');

  assert.ok(productionAuditIndex >= 0);
  assert.ok(packagingAuditIndex > productionAuditIndex);
  assert.ok(packagingAuditIndex < windowsBuildIndex);
  assert.doesNotMatch(workflow, /Install gateway test dependencies|gateway\/package\.json/i, 'public release workflow must not depend on the private gateway workspace');
  assert.ok(fetchWindowsSeedIndex >= 0 && fetchWindowsSeedIndex < testsIndex && fetchWindowsSeedIndex < windowsBuildIndex);

  for (const pattern of [
    /workflow_dispatch:/,
    /preflight:/,
    /windows:/,
    /linux:/,
    /mac:/,
    /publish:/,
    /needs:\s+preflight/,
    /needs:[\s\S]*- windows[\s\S]*- linux/,
    /publish=true/,
    /publish=false/,
    /GitHub API returned HTTP \$http_status/,
    /curl --silent --show-error/,
    /Build Windows release/,
    /npm run electron:dist:windows/,
    /Build Linux release/,
    /npm run electron:dist:linux/,
    /Build macOS release/,
    /runs-on: \$\{\{ matrix\.runner \}\}/,
    /runner: macos-15-intel/,
    /runner: macos-15/,
    /npm run electron:dist:mac/,
    /TUNNEL_CLIENT_PLATFORMS: darwin/,
    /REL_AI_TARGET_ARCH: \$\{\{ matrix\.arch \}\}/,
    /TUNNEL_CLIENT_PLATFORMS: win32/,
    /TUNNEL_CLIENT_PLATFORMS: linux/,
    /npm run verify:packaged -- --platform win32/,
    /npm run verify:packaged -- --platform linux/,
    /npm run verify:fuses -- --platform win32/,
    /npm run verify:fuses -- --platform linux/,
    /Smoke-test Linux desktop startup under Xvfb/,
    /sudo chown root:root "\$sandbox_helper"/,
    /sudo chmod 4755 "\$sandbox_helper"/,
    /stat -c '%u:%g:%a'/,
    /xvfb-run --auto-servernum/,
    /Rel\.AI-MCP-Setup-\$\{\{ needs\.preflight\.outputs\.version \}\}\.exe/,
    /Rel\.AI-MCP-Portable-\$\{\{ needs\.preflight\.outputs\.version \}\}\.exe/,
    /Rel\.AI-MCP-\$\{\{ needs\.preflight\.outputs\.version \}\}-linux-x64\.AppImage/,
    /Rel\.AI-MCP-\$\{\{ needs\.preflight\.outputs\.version \}\}-linux-x64\.deb/,
    /Rel\.AI-MCP-\$\{\{ needs\.preflight\.outputs\.version \}\}-mac-\$\{\{ matrix\.arch \}\}\.dmg/,
    /latest-linux\.yml/,
    /electron-size-report-linux\.json/,
    /Download Windows release bundle/,
    /Download Linux release bundle/,
    /Download macOS release bundles/,
    /merge-multiple: true/,
    /npm run prepare:release-assets/,
    /release-assets\.txt/,
    /SHA256SUMS\.txt/,
    /Attest release artifact provenance/,
    /Attest release SBOM/,
    /dist\/\*\.AppImage/,
    /dist\/\*\.deb/,
    /dist\/\*\.dmg/,
    /CSC_IDENTITY_AUTO_DISCOVERY:\s*'false'/,
    /Verify bundled OpenAI tunnel-client/,
    /verify-tunnel-client\.mjs/,
    /npm run benchmark:observability/,
    /npm run test:observability-browser/,
    /npm run test:native-tasks-release-gate/
  ]) assert.match(workflow, pattern);

  assert.doesNotMatch(workflow, /test:installed|REL_AI_SMOKE_INSTALLER|release-evidence-check|uninstall/i);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node|upload-artifact|download-artifact|attest-build-provenance|attest-sbom)@v\d+/);

  const fuseWrapper = fs.readFileSync(path.join(tmp, 'scripts', 'verify-fuses.mjs'), 'utf8');
  assert.match(fuseWrapper, /process\.argv\.slice\(2\)/);
  assert.match(fuseWrapper, /allowBuildCheck: true, platform/);
}

function verifyTunnelClientTamperDetection() {
  const seedPath = path.join(tmp, 'vendor', 'tunnel-client', 'win32', 'tunnel-client.exe');
  const original = fs.readFileSync(seedPath);
  const tamperedBytes = Buffer.from(original);
  tamperedBytes[0] = 1;
  fs.writeFileSync(seedPath, tamperedBytes);
  const tampered = runWithEnv('release-check.mjs', { REL_AI_TARGET_PLATFORM: 'win32' });
  assert.notEqual(tampered.status, 0);
  assert.match(`${tampered.stdout}\n${tampered.stderr}`, /bundled OpenAI tunnel-client SHA-256 for win32/i);

  fs.writeFileSync(seedPath, original);
  fs.rmSync(seedPath, { force: true });
  const missing = runWithEnv('release-check.mjs', { REL_AI_TARGET_PLATFORM: 'win32' });
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stdout}\n${missing.stderr}`, /bundled OpenAI tunnel-client is missing for win32/i);

  // A normal source consistency check must not require ignored build-time binaries.
  // Packaging supplies REL_AI_TARGET_PLATFORM and performs the strict artifact check.
  run('release-check.mjs');
}

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
