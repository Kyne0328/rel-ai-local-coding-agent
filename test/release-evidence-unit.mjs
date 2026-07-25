import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildReleaseEvidence,
  readUsabilityManifest,
  sha256File,
  validateReleaseEvidence,
  writeReleaseEvidence
} from '../scripts/release-evidence.mjs';

const root = path.resolve('.');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-release-evidence-'));
try {
  const installer = path.join(temp, 'Rel.AI MCP Setup 1.2.3.exe');
  fs.writeFileSync(installer, 'installer bytes');
  const screenshots = path.join(temp, 'evidence', 'screenshots');
  fs.mkdirSync(screenshots, { recursive: true });
  const manifest = readUsabilityManifest(root);
  const screenshotEvidence = manifest.automated.filter(item => item.screenshot === true).map((item, index) => {
    const filename = `${item.id}.png`;
    const screenshot = path.join(screenshots, filename);
    fs.writeFileSync(screenshot, `png bytes ${index}`);
    return {
      scenarioId: item.id,
      file: `screenshots/${filename}`,
      width: 800,
      height: 600,
      sha256: sha256File(screenshot)
    };
  });
  const windowScenarios = manifest.automated.slice(4).map(item => ({ ...item, status: 'passed' }));
  const evidence = buildReleaseEvidence({
    version: '1.2.3',
    installerPath: installer,
    manifest,
    installedResult: {
      resourceChecks: { one: true, two: true },
      dashboardStatus: 200,
      publicToolCount: 18
    },
    windowResult: {
      scenarios: windowScenarios,
      screenshots: screenshotEvidence
    },
    generatedAt: '2026-07-25T00:00:00.000Z',
    platform: 'win32',
    architecture: 'x64'
  });
  const evidencePath = path.join(temp, 'evidence', 'release-readiness.json');
  writeReleaseEvidence(evidencePath, evidence);
  assert.equal(evidence.overallStatus, 'automated_passed_manual_required');
  assert.equal(evidence.manual.checks.every(check => check.status === 'not_recorded'), true);
  assert.deepEqual(validateReleaseEvidence(evidence, manifest, { evidencePath, installerPath: installer }), []);

  const missing = structuredClone(evidence);
  missing.automated.scenarios = missing.automated.scenarios.filter(item => item.id !== 'workspace-scope');
  assert.ok(validateReleaseEvidence(missing, manifest).some(error => error.includes('workspace-scope')));
  const missingScreenshot = structuredClone(evidence);
  missingScreenshot.automated.screenshots = missingScreenshot.automated.screenshots.filter(item => item.scenarioId !== 'dashboard-overview');
  assert.ok(validateReleaseEvidence(missingScreenshot, manifest).some(error => error.includes('dashboard-overview')));
  const dishonest = structuredClone(evidence);
  dishonest.manual.checks[0].status = 'passed';
  assert.ok(validateReleaseEvidence(dishonest, manifest).some(error => error.includes('must not claim')));
  const changedInstaller = path.join(temp, 'changed.exe');
  fs.writeFileSync(changedInstaller, 'different bytes');
  assert.ok(validateReleaseEvidence(evidence, manifest, { installerPath: changedInstaller }).some(error => error.includes('filename') || error.includes('checksum')));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Release usability evidence unit tests passed.');
