import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const manifest = JSON.parse(read('test/fixtures/desktop-usability-scenarios.json'));
const installedSmoke = read('scripts/installed-app-smoke.mjs');
const packagedSmoke = read('electron/installed-smoke.js');
const evidence = read('scripts/release-evidence.mjs');
const evidenceCheck = read('scripts/release-evidence-check.mjs');
const windowSmoke = read('electron/window-smoke.js');
const smokeEvidence = read('electron/smoke-evidence.js');
const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release.yml');
const docs = read('docs/USABILITY_ACCEPTANCE.md');

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.automated.length, 11);
assert.equal(manifest.manual.length, 4);
const allIds = [...manifest.automated, ...manifest.manual].map(item => item.id);
assert.equal(new Set(allIds).size, allIds.length, 'usability scenario IDs must be unique');
assert.deepEqual(
  manifest.automated.filter(item => item.screenshot === true).map(item => item.id),
  ['setup-renderer', 'recovery-renderer', 'dashboard-overview', 'session-to-activity-detail']
);
assert.deepEqual(manifest.manual.map(item => item.id), [
  'clean-first-run-tunnel',
  'chatgpt-oauth-connection',
  'approval-token-rotation-live',
  'update-from-previous-release'
]);
assert.ok(manifest.manual.every(item => item.reason));

assert.match(installedSmoke, /REL_AI_SMOKE_INSTALLER/);
assert.match(installedSmoke, /REL_AI_RELEASE_EVIDENCE_DIR/);
assert.match(installedSmoke, /buildReleaseEvidence/);
assert.match(installedSmoke, /validateReleaseEvidence/);
assert.match(installedSmoke, /release-readiness\.json/);
assert.match(packagedSmoke, /<title>Overview · Rel\.AI MCP<\/title>/);
assert.match(packagedSmoke, /id=\"initialDashboardData\"/);
assert.match(packagedSmoke, /type=\"module\" src=\"\/public\/dashboard\.js\"/);
assert.doesNotMatch(packagedSmoke, /Rel\.AI MCP Dashboard/);
assert.match(windowSmoke, /captureWindow/);
assert.match(windowSmoke, /writeWindowSmokeResult/);
assert.match(windowSmoke, /dashboard-overview\.png/);
assert.match(windowSmoke, /session-to-activity-detail\.png/);
assert.match(smokeEvidence, /capturePage/);
assert.match(smokeEvidence, /sha256/);
assert.match(evidence, /automated_passed_manual_required/);
assert.match(evidence, /status: 'not_recorded'/);
assert.match(evidence, /must not claim the manual check ran/);
assert.match(evidence, /Required screenshot evidence is missing/);
assert.match(evidenceCheck, /Release usability evidence passed/);

assert.match(ci, /installed-app-usability-evidence/);
assert.match(ci, /if-no-files-found: error/);
assert.match(release, /Smoke exact release installer/);
assert.match(release, /REL_AI_SMOKE_INSTALLER/);
assert.match(release, /release-readiness\.json/);
assert.match(release, /release-usability-evidence\.zip/);
assert.match(release, /release-evidence-check\.mjs/);
assert.match(release, /Upload release usability evidence/);
assert.match(docs, /Automated acceptance does not replace the external checks/);
assert.match(docs, /automated_passed_manual_required/);
assert.match(docs, /Real ngrok publication/);
assert.match(docs, /ChatGPT OAuth/);
assert.match(docs, /previous published release/);

console.log('Usability acceptance and release evidence smoke passed.');
