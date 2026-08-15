import assert from 'node:assert/strict';
import fs from 'node:fs';

const transportSource = fs.readFileSync(new URL('../src/http/mcpTransport.js', import.meta.url), 'utf8');
const policy = fs.readFileSync(new URL('../docs/MCP_PROTOCOL_POLICY.md', import.meta.url), 'utf8');

assert.match(transportSource, /async function handleLegacyMcpRequest\s*\(/, 'legacy HTTP compatibility must have one named adapter');
assert.match(
  transportSource,
  /if \(legacy\) \{\s*await handleLegacyMcpRequest\([\s\S]*?\);\s*return;\s*\}/,
  'the main HTTP dispatcher must delegate the legacy branch directly'
);
assert.match(transportSource, /async function observeRequestManifest\s*\(/, 'manifest observation must remain shared');
assert.match(transportSource, /function runMcpRequestSpan\s*\(/, 'request telemetry must remain shared');
assert.equal((transportSource.match(/getCoreNodeHandler\(\)\(ctx\.req, ctx\.res, message\)/g) || []).length, 2, 'modern and legacy SDK dispatch must each remain explicit');

assert.match(policy, /Modern MCP protocol:\s*`2026-07-28`/);
assert.match(policy, /Stateless ChatGPT HTTP compatibility:\s*`2025-11-25`/);
assert.match(policy, /stdio tests verify that stdio remains modern-only/i);
assert.match(policy, /Removal condition:/);

console.log('Legacy MCP compatibility is isolated behind one named adapter with shared security and observability boundaries.');
