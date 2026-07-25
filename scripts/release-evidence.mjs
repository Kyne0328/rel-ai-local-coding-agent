import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function readUsabilityManifest(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'desktop-usability-scenarios.json'), 'utf8'));
}

export function passedScenario(id, title, details = {}) {
  return { id, title, status: 'passed', ...details };
}

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function buildReleaseEvidence(options) {
  const {
    version,
    installerPath,
    installedResult,
    windowResult,
    manifest,
    generatedAt = new Date().toISOString(),
    platform = process.platform,
    architecture = process.arch
  } = options;
  const automatedScenarios = [
    passedScenario('packaged-resources', 'Packaged resources are complete', {
      resourcesChecked: Object.keys(installedResult.resourceChecks || {}).length
    }),
    passedScenario('local-health', 'Installed local service reaches health'),
    passedScenario('dashboard-http', 'Installed dashboard loads', {
      statusCode: installedResult.dashboardStatus
    }),
    passedScenario('public-tool-surface', 'Installed public tool surface matches the registry', {
      toolCount: installedResult.publicToolCount
    }),
    ...(windowResult.scenarios || [])
  ];
  return {
    schemaVersion: 1,
    product: 'Rel.AI MCP',
    version,
    generatedAt,
    overallStatus: 'automated_passed_manual_required',
    platform: { os: platform, architecture },
    installer: {
      file: path.basename(installerPath),
      sha256: sha256File(installerPath)
    },
    automated: {
      status: 'passed',
      scenarios: automatedScenarios,
      screenshots: windowResult.screenshots || []
    },
    manual: {
      status: 'required',
      checks: (manifest.manual || []).map(check => ({ ...check, status: 'not_recorded' }))
    },
    limitations: [
      'Automated smoke uses isolated local configuration and synthetic workspace data.',
      'Real ngrok publication, ChatGPT OAuth, live token rotation, and production update delivery remain manual release checks.'
    ]
  };
}

export function validateReleaseEvidence(evidence, manifest, options = {}) {
  const errors = [];
  if (evidence?.schemaVersion !== 1) errors.push('Evidence schemaVersion must be 1.');
  if (!/^\d+\.\d+\.\d+$/.test(String(evidence?.version || ''))) errors.push('Evidence version must be a stable semantic version.');
  if (evidence?.overallStatus !== 'automated_passed_manual_required') errors.push('Evidence must distinguish automated success from required manual checks.');
  if (evidence?.automated?.status !== 'passed') errors.push('Automated acceptance status must be passed.');
  if (evidence?.manual?.status !== 'required') errors.push('Manual acceptance status must remain required.');
  if (!/^[a-f0-9]{64}$/.test(String(evidence?.installer?.sha256 || ''))) errors.push('Installer SHA-256 is missing or invalid.');

  const scenarios = new Map((evidence?.automated?.scenarios || []).map(item => [item.id, item]));
  for (const required of manifest.automated || []) {
    const actual = scenarios.get(required.id);
    if (!actual) errors.push(`Required automated scenario is missing: ${required.id}.`);
    else if (actual.status !== 'passed') errors.push(`Automated scenario did not pass: ${required.id}.`);
  }

  const manual = new Map((evidence?.manual?.checks || []).map(item => [item.id, item]));
  for (const required of manifest.manual || []) {
    const actual = manual.get(required.id);
    if (!actual) errors.push(`Required manual check is missing: ${required.id}.`);
    else if (actual.status !== 'not_recorded') errors.push(`Automated evidence must not claim the manual check ran: ${required.id}.`);
  }

  const evidencePath = options.evidencePath ? path.resolve(options.evidencePath) : '';
  const evidenceDirectory = evidencePath ? path.dirname(evidencePath) : '';
  const screenshots = evidence?.automated?.screenshots || [];
  const screenshotScenarioIds = new Set(screenshots.map(item => item.scenarioId));
  for (const required of manifest.automated || []) {
    if (required.screenshot === true && !screenshotScenarioIds.has(required.id)) {
      errors.push(`Required screenshot evidence is missing: ${required.id}.`);
    }
  }
  for (const screenshot of screenshots) {
    if (!screenshot.file || path.isAbsolute(screenshot.file) || screenshot.file.includes('..')) {
      errors.push(`Screenshot path must be a safe relative path: ${screenshot.file || '(missing)'}.`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(String(screenshot.sha256 || ''))) errors.push(`Screenshot SHA-256 is invalid: ${screenshot.file}.`);
    if (evidenceDirectory) {
      const screenshotPath = path.resolve(evidenceDirectory, screenshot.file);
      if (!screenshotPath.startsWith(`${evidenceDirectory}${path.sep}`)) errors.push(`Screenshot escapes the evidence directory: ${screenshot.file}.`);
      else if (!fs.existsSync(screenshotPath)) errors.push(`Screenshot file is missing: ${screenshot.file}.`);
      else if (sha256File(screenshotPath) !== screenshot.sha256) errors.push(`Screenshot checksum does not match: ${screenshot.file}.`);
    }
  }

  if (options.installerPath) {
    const installerPath = path.resolve(options.installerPath);
    if (!fs.existsSync(installerPath)) errors.push('Installer supplied for evidence verification does not exist.');
    else {
      if (path.basename(installerPath) !== evidence?.installer?.file) errors.push('Evidence installer filename does not match the supplied installer.');
      if (sha256File(installerPath) !== evidence?.installer?.sha256) errors.push('Evidence installer checksum does not match the supplied installer.');
    }
  }
  return errors;
}

export function writeReleaseEvidence(target, evidence) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}
