import assert from 'node:assert/strict';
import { buildToolManifest, canonicalValue } from '../src/mcp/toolManifest.js';
import { renderCloudContract } from '../scripts/generate-cloud-contract.mjs';
import { validateSchemaEvolution } from '../scripts/verify-cloud-contract.mjs';

const manifest = buildToolManifest({});
const rendered = renderCloudContract(manifest);
assert.ok(rendered.endsWith('\n'), 'generated public cloud contract must end with a newline');
const artifact = JSON.parse(rendered);
assert.deepEqual(artifact.schemaVersion, canonicalValue(manifest).schemaVersion);
assert.equal(artifact.schemaVersion, 6);
assert.deepEqual(artifact.tools, canonicalValue(manifest).tools);
assert.equal(artifact.hash, manifest.hash);
assert.equal(artifact.version, manifest.version);
assert.deepEqual(artifact.serverInfo, { name: 'rel-ai-mcp', version: '0.25.0' });
assert.ok(artifact.tools.every(tool => tool.outputSchema?.additionalProperties === false), 'public cloud tools must publish strict output schemas');
assert.equal(renderCloudContract(manifest), rendered, 'manifest rendering must be deterministic');

assert.equal(validateSchemaEvolution(
  { schemaVersion: 3, version: 'same' },
  { schemaVersion: 3, manifestHash: 'same' }
).ok, true);
assert.equal(validateSchemaEvolution(
  { schemaVersion: 3, version: 'new' },
  { schemaVersion: 2, manifestHash: 'old' }
).ok, true);
assert.equal(validateSchemaEvolution(
  { schemaVersion: 2, version: 'new' },
  { schemaVersion: 2, manifestHash: 'old' }
).ok, false);
assert.equal(validateSchemaEvolution(
  { schemaVersion: 1, version: 'same' },
  { schemaVersion: 2, manifestHash: 'same' }
).ok, false);

console.log('Public cloud contract generation and MCP schema evolution tests passed.');
