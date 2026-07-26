import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PRODUCTION_APP_ID,
  TEST_APP_ID_PREFIX,
  assertOwnedTestRoot,
  assertPathInside,
  assertSafeTestRoot,
  createInstallerTestContext,
  detectProductionInstallation,
  removeOwnedTestRoot
} from '../scripts/installer-test-safety.mjs';

assert.throws(() => createInstallerTestContext({}, { runId: 'abcdef' }), /REL_AI_INSTALLER_TEST_ISOLATED/);
assert.throws(() => assertSafeTestRoot(''), /empty/);
assert.throws(() => assertSafeTestRoot(path.parse(process.cwd()).root), /Filesystem roots/);
assert.throws(() => assertSafeTestRoot(os.homedir()), /home directory/);
assert.throws(() => assertPathInside(process.cwd(), process.cwd()), /must be a child/);
assert.throws(() => assertPathInside(path.dirname(process.cwd()), process.cwd()), /must be a child/);

const fakeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-production-detection-'));
const fakeLocalAppData = path.join(fakeProfile, 'LocalAppData');
const fakeProductionInstall = path.join(fakeLocalAppData, 'Programs', 'Rel.AI MCP');
fs.mkdirSync(fakeProductionInstall, { recursive: true });
const productionDetection = detectProductionInstallation({ LOCALAPPDATA: fakeLocalAppData });
assert.equal(productionDetection.installed, true);
assert.ok(productionDetection.existingPaths.includes(path.resolve(fakeProductionInstall)));
assert.throws(() => createInstallerTestContext({
  REL_AI_INSTALLER_TEST_ISOLATED: '1',
  LOCALAPPDATA: fakeLocalAppData
}, { runId: 'prod5678', testRoot: path.join(fakeProfile, 'test-root') }), /Production Rel\.AI MCP installation detected/);
fs.rmSync(fakeProfile, { recursive: true, force: true });

const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-installer-safety-unit-'));
const rootA = path.join(parent, 'run-a');
const rootB = path.join(parent, 'run-b');
const contextA = createInstallerTestContext({ REL_AI_INSTALLER_TEST_ISOLATED: '1' }, { runId: 'runa1234', testRoot: rootA });
const contextB = createInstallerTestContext({ REL_AI_INSTALLER_TEST_ISOLATED: '1' }, { runId: 'runb1234', testRoot: rootB });

assert.notEqual(contextA.appId, PRODUCTION_APP_ID);
assert.ok(contextA.appId.startsWith(TEST_APP_ID_PREFIX));
assert.notEqual(contextA.appId, contextB.appId);
assertOwnedTestRoot(rootA, contextA.runId);
assert.throws(() => assertOwnedTestRoot(rootA, contextB.runId), /another run/);
assert.throws(() => createInstallerTestContext({
  REL_AI_INSTALLER_TEST_ISOLATED: '1',
  REL_AI_ALLOW_PRODUCTION_INSTALLER_TEST: '1'
}, { runId: 'prod1234', testRoot: path.join(parent, 'prod') }), /GitHub Actions/);

removeOwnedTestRoot(rootA, contextA.runId);
assert.equal(fs.existsSync(rootA), false);
assert.equal(fs.existsSync(rootB), true, 'cleanup from one run must not remove another run');
removeOwnedTestRoot(rootB, contextB.runId);
fs.rmSync(parent, { recursive: true, force: true });

console.log('Installer test safety unit tests passed.');
