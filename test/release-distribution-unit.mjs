import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertInstalledElectronDependencies } from '../scripts/electron-package-dependencies.mjs';
import { RELEASE_CHANGE_FILES, VERSION_JSON_FILES } from '../scripts/release-surfaces.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

verifyDependencyGuard();
verifyReleaseSurfaces();
verifyReleaseMetadataSynchronization();
verifyReleaseWorkflowPreflight();

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

function writeInstalledPackage(electronRoot, name, version) {
  const directory = path.join(electronRoot, 'node_modules', ...name.split('/'));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({ name, version })}\n`);
}
