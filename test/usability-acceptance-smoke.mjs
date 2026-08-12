import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const rootPackage = JSON.parse(read('package.json'));
const electronPackage = JSON.parse(read('electron/package.json'));
const verifier = read('scripts/verify-packaged-app.mjs');
const electronPlatform = read('scripts/electron-platform.mjs');
const electronMain = read('electron/main.js');
const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release.yml');
const docs = read('docs/USABILITY_ACCEPTANCE.md');

assert.equal(rootPackage.scripts['test:installed'], undefined);
assert.equal(rootPackage.scripts['release:evidence:check'], undefined);
assert.equal(rootPackage.scripts['verify:packaged'], 'node scripts/verify-packaged-wrapper.mjs');
assert.equal(rootPackage.scripts['test:connector-acceptance'], 'node scripts/packaged-connector-acceptance.mjs');
assert.equal(rootPackage.scripts['verify:tunnel-client'], 'node scripts/verify-tunnel-client.mjs');

for (const removedPath of ['scripts/installed-app-smoke.mjs', 'scripts/release-evidence.mjs', 'scripts/release-evidence-check.mjs', 'electron/installed-smoke.js', 'electron/window-smoke.js', 'electron/smoke-evidence.js']) {
  assert.equal(fs.existsSync(path.join(root, removedPath)), false, `${removedPath} must remain removed.`);
}
for (const removedFile of ['installed-smoke.js', 'window-smoke.js', 'smoke-evidence.js']) assert.equal(electronPackage.build.files.includes(removedFile), false);
assert.doesNotMatch(electronMain, /--installed-smoke|--window-smoke|smokeWindowRoles|getSmokeWindowRole/);

for (const required of ['spec.executableName', 'resources/app.asar', 'resources/src/httpServer.js', 'resources/src/tools/actionCatalog.js', 'resources/public/dashboard.js', 'spec.tunnelClientDirectory', 'spec.tunnelClientFile']) {
  assert.ok(verifier.includes(required), `Packaged verifier must check ${required}.`);
}
assert.match(electronPlatform, /tunnelClientDirectory: 'win32'/);
assert.match(electronPlatform, /tunnelClientFile: 'tunnel-client\.exe'/);
assert.doesNotMatch(verifier, /spawnSync\(executablePath|Start-Process|uninstall|quitAndInstall/i, 'Packaged verification must not launch the Electron application, installer, uninstaller, or updater install path.');
assert.match(verifier, /spawnSync\(binaryPath, \['-h'\]/, 'Packaged verification may execute the reviewed Zoekt binary only for a bounded help probe.');
assert.match(verifier, /resources\/bin\/ngrok/, 'Packaged verification must reject obsolete transport resources.');

assert.match(ci, /name: packaged Windows application/i);
assert.match(ci, /npm run electron:build/);
assert.match(ci, /npm run verify:packaged/);
assert.match(ci, /npm run test:connector-acceptance/);
assert.doesNotMatch(ci, /test:installed|installed-app-usability-evidence|REL_AI_RELEASE_EVIDENCE_DIR/);

assert.match(release, /Verify packaged application layout/);
assert.match(release, /Verify packaged bearer-authenticated MCP flow/);
assert.match(release, /Verify bundled OpenAI tunnel-client/);
assert.match(release, /npm run verify:packaged -- --platform win32/);
assert.match(release, /npm run verify:packaged -- --platform linux/);
assert.match(release, /npm run test:connector-acceptance/);
assert.doesNotMatch(release, /test:installed|REL_AI_SMOKE_INSTALLER|REL_AI_RELEASE_EVIDENCE_DIR/);

assert.match(docs, /non-destructive automated verification/i);
assert.match(docs, /`verify:packaged` is read-only/i);
assert.match(docs, /disposable Windows VM/i);
assert.match(docs, /Do not automate installer\/uninstaller execution/i);
assert.match(docs, /Real Secure MCP Tunnel/i);

console.log('Non-destructive tunnel packaging acceptance policy passed.');
