import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildToolManifest } from '../src/mcp/toolManifest.js';
import { outputPath, renderCloudContract } from './generate-cloud-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function validateSchemaEvolution(current, base) {
  const currentSchemaVersion = Number(current?.schemaVersion || 0);
  const baseSchemaVersion = Number(base?.schemaVersion || 0);
  if (currentSchemaVersion < baseSchemaVersion) return { ok: false, reason: 'schema_version_regressed', currentSchemaVersion, baseSchemaVersion };
  const changed = String(current?.version || '') !== String(base?.manifestHash || '');
  if (changed && currentSchemaVersion <= baseSchemaVersion) return { ok: false, reason: 'schema_version_not_incremented', currentSchemaVersion, baseSchemaVersion };
  return { ok: true, changed, currentSchemaVersion, baseSchemaVersion };
}
function readBaseReleaseManifest(baseRef = process.env.REL_AI_SCHEMA_BASE_REF || 'HEAD') {
  const result = spawnSync('git', ['show', `${baseRef}:release-manifest.json`], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Could not read release-manifest.json from ${baseRef}: ${String(result.stderr || result.stdout || '').trim()}`);
  return JSON.parse(result.stdout);
}
function verifyCloudContract(options = {}) {
  const current = options.current || buildToolManifest({});
  const base = options.base || readBaseReleaseManifest(options.baseRef);
  const evolution = validateSchemaEvolution(current, base);
  if (!evolution.ok) return { ok: false, error: evolution.reason === 'schema_version_regressed' ? `MCP schema version regressed from ${evolution.baseSchemaVersion} to ${evolution.currentSchemaVersion}.` : `MCP public contract changed without incrementing schemaVersion above ${evolution.baseSchemaVersion}.`, ...evolution };
  const expected = renderCloudContract(current);
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== expected) return { ok: false, error: 'Public Rel.AI Cloud contract does not match the canonical MCP contract.' };
  return { ok: true, ...evolution };
}
function runCloudContractVerification() {
  try {
    const result = verifyCloudContract();
    if (!result.ok) { console.error(result.error); return 1; }
    console.log(`MCP schema verification passed (schema ${result.currentSchemaVersion}, contract ${result.changed ? 'changed' : 'unchanged'} from base).`);
    return 0;
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); return 1; }
}
function isMainModule() { return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url; }
if (isMainModule()) process.exitCode = runCloudContractVerification();
export { readBaseReleaseManifest, runCloudContractVerification, validateSchemaEvolution, verifyCloudContract };
