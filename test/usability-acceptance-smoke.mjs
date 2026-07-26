import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const rootPackage = JSON.parse(read('package.json'));
const electronPackage = JSON.parse(read('electron/package.json'));
const verifier = read('scripts/verify-packaged-app.mjs');
const electronMain = read('electron/main.js');
const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release.yml');
const docs = read('docs/USABILITY_ACCEPTANCE.md');

assert.equal(rootPackage.scripts['test:installed'], undefined);
assert.equal(rootPackage.scripts['release:evidence:check'], undefined);
assert.equal(rootPackage.scripts['verify:packaged'], 'node scripts/verify-packaged-app.mjs');

for (const removedPath of [
  'scripts/installed-app-smoke.mjs',
  'scripts/release-evidence.mjs',
  'scripts/release-evidence-check.mjs',
  'electron/installed-smoke.js',
  'electron/window-smoke.js',
  'electron/smoke-evidence.js',
  'test/fixtures/desktop-usability-scenarios.json'
]) {
  assert.equal(fs.existsSync(path.join(root, removedPath)), false, `${removedPath} must remain removed`);
}

for (const removedFile of ['installed-smoke.js', 'window-smoke.js', 'smoke-evidence.js']) {
  assert.equal(electronPackage.build.files.includes(removedFile), false, `${removedFile} must not ship in the application`);
}
assert.doesNotMatch(electronMain, /--installed-smoke|--window-smoke|smokeWindowRoles|getSmokeWindowRole/);

for (const required of [
  'Rel.AI MCP.exe',
  'resources/app.asar',
  'resources/src/httpServer.js',
  'resources/src/tools/registry.js',
  'resources/public/dashboard.js',
  'resources/bin/ngrok/win32/ngrok.exe'
]) assert.ok(verifier.includes(required), `packaged verifier must check ${required}`);
assert.doesNotMatch(verifier, /spawn|execFile|execSync|Start-Process|uninstall/i, 'packaged verification must remain read-only');

assert.match(ci, /name: packaged Windows application/);
assert.match(ci, /npm run electron:build/);
assert.match(ci, /npm run verify:packaged/);
assert.doesNotMatch(ci, /test:installed|installed-app-usability-evidence|REL_AI_RELEASE_EVIDENCE_DIR/);

assert.match(release, /Verify packaged application layout/);
assert.match(release, /npm run verify:packaged -- --dir dist\/win-unpacked/);
assert.doesNotMatch(release, /test:installed|REL_AI_SMOKE_INSTALLER|REL_AI_RELEASE_EVIDENCE_DIR|release-readiness\.json|release-usability-evidence\.zip/);

assert.match(docs, /does not run an installer or executable/);
assert.match(docs, /only reads files/);
assert.match(docs, /disposable Windows VM/);
assert.match(docs, /must never install, launch, or uninstall|Do not automate installer or uninstaller execution/);

console.log('Non-destructive packaged application acceptance policy passed.');
