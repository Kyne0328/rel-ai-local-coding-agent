import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertInstalledElectronDependencies } from '../scripts/electron-package-dependencies.mjs';
import { platformReleaseArtifactNames, releaseArtifactNames } from '../scripts/release-artifacts.mjs';
import { nativeReleaseComponents } from '../scripts/generate-sbom.mjs';
import { assertDisposableReleaseRunner, findPreviousReleaseAsset, parseStableVersion, verifyDownloadedAssetBytes } from '../scripts/validate-installed-release.mjs';
import { RELEASE_CHANGE_FILES, VERSION_JSON_FILES } from '../scripts/release-surfaces.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

verifyDependencyGuard();
verifyReleaseSurfaces();
verifyReleaseMetadataSynchronization();
verifyReleaseWorkflowPreflight();
verifyArtifactResolution();
verifyNativeSbomCoverage();
await verifyInstalledReleaseSafety();

console.log('Release and distribution regression tests passed.');

function verifyDependencyGuard() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-electron-deps-'));
  try {
    const manifest = {
      dependencies: { 'runtime-package': '^1.0.0' },
      devDependencies: { '@scope/build-package': '~2.0.0' }
    };
    const lockfile = {
      packages: {
        '': {
          dependencies: { 'runtime-package': '^1.0.0' },
          devDependencies: { '@scope/build-package': '~2.0.0' }
        },
        'node_modules/runtime-package': { version: '1.4.2' },
        'node_modules/@scope/build-package': { version: '2.0.5' }
      }
    };

    writeInstalledPackage(temp, 'runtime-package', '1.4.2');
    writeInstalledPackage(temp, '@scope/build-package', '2.0.5');
    assert.deepEqual(assertInstalledElectronDependencies({ electronRoot: temp, manifest, lockfile }), { checked: 2 });

    writeInstalledPackage(temp, 'runtime-package', '1.4.1');
    assert.throws(
      () => assertInstalledElectronDependencies({ electronRoot: temp, manifest, lockfile }),
      /runtime-package: installed 1\.4\.1, lockfile resolves 1\.4\.2/
    );

    writeInstalledPackage(temp, 'runtime-package', '1.4.2');
    lockfile.packages[''].dependencies['runtime-package'] = '^9.0.0';
    assert.throws(
      () => assertInstalledElectronDependencies({ electronRoot: temp, manifest, lockfile }),
      /runtime-package: electron\/package\.json requests \^1\.0\.0, but electron\/package-lock\.json records \^9\.0\.0/
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function verifyReleaseSurfaces() {
  assert.ok(VERSION_JSON_FILES.includes('.codex-plugin/plugin.json'), 'plugin metadata must participate in release version checks');
  assert.ok(RELEASE_CHANGE_FILES.includes('release-manifest.json'), 'release finalization must accept generated release metadata');
  assert.ok(RELEASE_CHANGE_FILES.includes('CHANGELOG.md'), 'release finalization must accept changelog updates');
}

function verifyReleaseMetadataSynchronization() {
  const bump = read('scripts/release-bump.mjs');
  const check = read('scripts/release-check.mjs');
  const finalize = read('scripts/release-finalize.mjs');
  assert.match(bump, /runtimeMetadata\(\)/, 'release bump must derive compatibility metadata from the current runtime contract');
  assert.match(bump, /manifestHash/, 'release bump must synchronize the public tool-manifest hash');
  assert.match(check, /VERSION_JSON_FILES/, 'release consistency must use the canonical version surface list');
  assert.match(finalize, /isReleaseChangeFile/, 'release finalization must use the canonical release surface list');
}

function verifyReleaseWorkflowPreflight() {
  const workflow = read('.github/workflows/release.yml');
  const consistencyIndex = workflow.indexOf('npm run release:check');
  const firstPackageIndex = Math.min(
    ...['npm run electron:dist:windows', 'npm run electron:dist:linux', 'npm run electron:dist:mac']
      .map(command => workflow.indexOf(command))
      .filter(index => index >= 0)
  );
  assert.ok(consistencyIndex >= 0 && consistencyIndex < firstPackageIndex,
    'release consistency must fail before platform packaging starts');
  assert.match(workflow, /Recovering unpublished release from existing tag/,
    'an interrupted publish must be recoverable when the existing tag points to the same commit');
  assert.match(workflow, /git rev-list -n 1/);
  assert.match(workflow, /Existing tag \$VERSION points to \$tag_commit, not current release commit \$GITHUB_SHA/,
    'tag recovery must fail closed when the tag points at another commit');
}

function verifyArtifactResolution() {
  const electronPackage = JSON.parse(read('electron/package.json'));
  const customPackage = structuredClone(electronPackage);
  customPackage.build.nsis.artifactName = 'Setup-${version}.${ext}';
  customPackage.build.portable.artifactName = 'Portable-${version}.${ext}';
  customPackage.build.appImage.artifactName = 'Linux-${version}.${ext}';
  customPackage.build.deb.artifactName = 'Debian-${version}.${ext}';
  customPackage.build.dmg.artifactName = 'Mac-${version}-${arch}.${ext}';

  const names = releaseArtifactNames('9.8.7', { electronPackage: customPackage });
  assert.equal(names.installer, 'Setup-9.8.7.exe');
  assert.equal(names.portable, 'Portable-9.8.7.exe');
  assert.equal(names.linuxAppImage, 'Linux-9.8.7.AppImage');
  assert.equal(names.linuxDeb, 'Debian-9.8.7.deb');
  assert.equal(names.macDmgArm64, 'Mac-9.8.7-arm64.dmg');
  assert.deepEqual(platformReleaseArtifactNames('9.8.7', 'win32', 'x64', { electronPackage: customPackage }), [
    names.installer, names.portable, names.blockmap, names.metadata, names.sbom, names.sizeReport
  ]);
  assert.deepEqual(platformReleaseArtifactNames('9.8.7', 'linux', 'x64', { electronPackage: customPackage }), [
    names.linuxAppImage, names.linuxDeb, names.linuxMetadata, names.linuxSizeReport
  ]);
}

function verifyNativeSbomCoverage() {
  const tunnelManifest = JSON.parse(read('vendor/tunnel-client/manifest.json'));
  const zoektManifest = JSON.parse(read('vendor/zoekt/manifest.json'));
  const components = nativeReleaseComponents(tunnelManifest, zoektManifest);
  assert.equal(components.length, 12, 'SBOM must include every shipped tunnel-client and Zoekt platform artifact');
  assert.equal(new Set(components.map(component => component['bom-ref'])).size, components.length, 'native SBOM references must be unique');
  assert.equal(components.filter(component => component.name === 'OpenAI tunnel-client').length, 4);
  assert.equal(components.filter(component => component.name === 'Zoekt search').length, 4);
  assert.equal(components.filter(component => component.name === 'Zoekt index').length, 4);
  assert.ok(components.every(component => component.hashes?.[0]?.alg === 'SHA-256' && /^[a-f0-9]{64}$/.test(component.hashes[0].content)),
    'every pinned native release component must carry its manifest SHA-256');
}

async function verifyInstalledReleaseSafety() {
  assert.deepEqual(parseStableVersion('v1.2.3'), [1, 2, 3]);
  assert.equal(parseStableVersion('1.2.3-beta.1'), null);
  assert.throws(() => assertDisposableReleaseRunner({}), /disposable GitHub Actions runners/);

  await assert.rejects(() => findPreviousReleaseAsset({
    repository: 'owner/repo',
    currentVersion: '2.0.0',
    assetNameForVersion: version => `Setup-${version}.exe`,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: '2.0.0', draft: false, prerelease: false, assets: [{ name: 'Setup-2.0.0.exe', browser_download_url: 'current' }] },
        { tag_name: '1.9.0', draft: false, prerelease: false, assets: [{ name: 'wrong.exe', browser_download_url: 'wrong' }] },
        { tag_name: '1.8.0', draft: false, prerelease: false, assets: [{ name: 'Setup-1.8.0.exe', browser_download_url: 'older' }] }
      ]
    })
  }), /Previous release v1\.9\.0 is missing required upgrade artifact Setup-1\.9\.0\.exe/);

  const previous = await findPreviousReleaseAsset({
    repository: 'owner/repo',
    currentVersion: '2.0.0',
    assetNameForVersion: version => `Setup-${version}.exe`,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: '1.9.0', draft: false, prerelease: false, assets: [{ name: 'Setup-1.9.0.exe', browser_download_url: 'previous' }] }
      ]
    })
  });
  assert.equal(previous?.version, '1.9.0');
  assert.equal(previous?.asset?.browser_download_url, 'previous');

  const bytes = Buffer.from('release-asset');
  const digest = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  verifyDownloadedAssetBytes(bytes, { name: 'artifact.exe', size: bytes.length, digest });
  assert.throws(() => verifyDownloadedAssetBytes(bytes, { name: 'artifact.exe', size: bytes.length + 1, digest }), /size mismatch/);
  assert.throws(() => verifyDownloadedAssetBytes(bytes, { name: 'artifact.exe', size: bytes.length, digest: `sha256:${'0'.repeat(64)}` }), /SHA-256 mismatch/);
}

function writeInstalledPackage(electronRoot, name, version) {
  const directory = path.join(electronRoot, 'node_modules', ...name.split('/'));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({ name, version })}\n`);
}
