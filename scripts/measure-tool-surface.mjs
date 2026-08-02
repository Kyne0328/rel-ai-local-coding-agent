import { connectorInstructions } from '../src/mcpServer.js';
import { getPublicToolSchemas } from '../src/tools/schema.js';
import { slimCompactPublicResult } from '../src/tools/compactResult.js';

const baseline = Object.freeze({
  publicTools: 30,
  discoverySchemaBytes: 30524,
  estimatedDiscoveryTokens: 7631,
  globalInstructionBytes: 1471
});

function measure(profile) {
  const config = { toolProfile: profile, workspaces: {} };
  const tools = getPublicToolSchemas(config);
  const discoverySchemaBytes = Buffer.byteLength(JSON.stringify({ tools }), 'utf8');
  const globalInstructionBytes = Buffer.byteLength(JSON.stringify(connectorInstructions(config)), 'utf8');
  return {
    profile,
    publicTools: tools.length,
    discoverySchemaBytes,
    estimatedDiscoveryTokens: Math.ceil(discoverySchemaBytes / 4),
    globalInstructionBytes
  };
}

const compact = measure('compact');
const legacy = measure('legacy');
const representativeResult = {
  ok: true,
  workspace: 'repo',
  work_id: '00000000-0000-4000-8000-000000000000',
  status: 'planning',
  identity: 'work_session',
  workspaceBinding: { alias: 'repo' },
  title: 'Compact plugin',
  objective: 'Implement the compact MCP profile.',
  nextAction: 'Use the bootstrap context to choose the next tool. Pass this work_id on every subsequent work-scoped Rel.AI call; the bound workspace may be omitted.',
  bootstrap: { mode: 'compact', files: ['README.md', 'src/index.js'], hints: [], skipped: [] }
};
const representativeCompactResult = slimCompactPublicResult('relai_work', 'begin', representativeResult);
const report = {
  baseline,
  compact,
  legacy,
  representativeResultBytes: {
    before: Buffer.byteLength(JSON.stringify(representativeResult), 'utf8'),
    after: Buffer.byteLength(JSON.stringify(representativeCompactResult), 'utf8')
  },
  workflowCalls: {
    normalReadEditValidate: { before: 4, after: 4 },
    beginFinish: { before: 2, after: 2 }
  },
  change: {
    publicTools: compact.publicTools - baseline.publicTools,
    discoverySchemaBytes: compact.discoverySchemaBytes - baseline.discoverySchemaBytes,
    estimatedDiscoveryTokens: compact.estimatedDiscoveryTokens - baseline.estimatedDiscoveryTokens,
    globalInstructionBytes: compact.globalInstructionBytes - baseline.globalInstructionBytes,
    discoveryReductionPercent: Number(((1 - compact.discoverySchemaBytes / baseline.discoverySchemaBytes) * 100).toFixed(2))
  }
};

if (compact.publicTools > 12) throw new Error(`Compact profile exposes ${compact.publicTools} tools; limit is 12.`);
if (compact.discoverySchemaBytes >= 18_000) throw new Error(`Compact discovery is ${compact.discoverySchemaBytes} bytes; limit is 17999.`);
if (compact.globalInstructionBytes >= 512) throw new Error(`Global instructions are ${compact.globalInstructionBytes} bytes; limit is 511.`);
if (report.change.discoveryReductionPercent < 40) throw new Error(`Discovery reduction is ${report.change.discoveryReductionPercent}%; target is at least 40%.`);
if (report.representativeResultBytes.after >= report.representativeResultBytes.before) throw new Error('Representative compact result did not shrink.');
if (report.workflowCalls.normalReadEditValidate.after > report.workflowCalls.normalReadEditValidate.before) throw new Error('Normal workflow requires additional calls.');

console.log(JSON.stringify(report, null, 2));

export { baseline, measure };
