import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUsabilityManifest, validateReleaseEvidence } from './release-evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const evidenceArgument = args.find(argument => !argument.startsWith('--')) || process.env.REL_AI_RELEASE_EVIDENCE || '';
const installerIndex = args.indexOf('--installer');
const installerPath = installerIndex >= 0 ? args[installerIndex + 1] : '';

if (!evidenceArgument) {
  console.error('Usage: node scripts/release-evidence-check.mjs <release-readiness.json> [--installer <setup.exe>]');
  process.exit(1);
}

const evidencePath = path.resolve(evidenceArgument);
if (!fs.existsSync(evidencePath)) {
  console.error(`Release evidence does not exist: ${evidencePath}`);
  process.exit(1);
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const manifest = readUsabilityManifest(root);
const errors = validateReleaseEvidence(evidence, manifest, { evidencePath, installerPath });
if (errors.length) {
  console.error('Release usability evidence failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Release usability evidence passed for ${evidence.version}: ${evidence.automated.scenarios.length} automated scenarios; ${evidence.manual.checks.length} manual checks remain required.`);
