import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { connectorInstructions } from '../src/mcpServer.js';
import { compactForConnector } from '../src/tools/connector.js';
import { getPublicToolSchemas } from '../src/tools/schema.js';
import { slimCompactPublicResult } from '../src/tools/compactResult.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = Object.freeze({ publicTools: 30, discoverySchemaBytes: 30524, estimatedDiscoveryTokens: 7631, globalInstructionBytes: 1471 });

function measure() {
  const config = { workspaces: {} };
  const tools = getPublicToolSchemas(config);
  const discoverySchemaBytes = bytes({ tools });
  return {
    publicTools: tools.length,
    discoverySchemaBytes,
    estimatedDiscoveryTokens: Math.ceil(discoverySchemaBytes / 4),
    globalInstructionBytes: bytes(connectorInstructions(config))
  };
}

const surface = measure();
const representativeResult = {
  ok: true, workspace: 'repo', work_id: '00000000-0000-4000-8000-000000000000', status: 'planning',
  identity: 'work_session', workspaceBinding: { alias: 'repo' }, title: 'Unified plugin',
  objective: 'Implement the unified MCP surface.', nextAction: 'Use the bootstrap context.',
  bootstrap: { mode: 'compact', files: ['README.md', 'src/index.js'], hints: [], skipped: [] }
};
const representativeCompactResult = slimCompactPublicResult('relai_work', 'begin', representativeResult);
const execSuccess = compactForConnector('relai_exec', {
  ok: true, workspace: 'repo', command: 'node --check src/index.js', cwd: '.', shell: 'PowerShell 7',
  exitCode: 0, durationMs: 50, stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0,
  stdoutTruncated: false, stderrTruncated: false, timedOut: false, changedFiles: [], changedFilesTruncated: false
});
const snapshot = compactForConnector('relai_repo_snapshot', {
  ok: true, workspace: 'repo', fileCount: 2000,
  files: Array.from({ length: 2000 }, (_, index) => `src/generated/path-${String(index).padStart(4, '0')}.js`),
  manifests: ['package.json'], recommendedFlow: ['relai_search', 'relai_read']
});
const skillMetrics = skillMeasurements();
const report = {
  baseline,
  surface,
  resultBudgets: {
    workBeginBefore: bytes(representativeResult),
    workBeginAfter: bytes(representativeCompactResult),
    execSuccess: bytes(execSuccess),
    boundedSnapshot: bytes(snapshot)
  },
  skills: skillMetrics,
  change: {
    discoveryReductionPercent: reduction(surface.discoverySchemaBytes)
  }
};

if (surface.publicTools !== 12) throw new Error(`Unified surface exposes ${surface.publicTools} tools; expected exactly 12.`);
if (surface.discoverySchemaBytes >= 40_000) throw new Error(`Unified discovery is ${surface.discoverySchemaBytes} bytes; limit is 39999.`);
if (surface.globalInstructionBytes >= 512) throw new Error('Global connector instructions exceed 511 bytes.');
if (report.resultBudgets.workBeginAfter >= report.resultBudgets.workBeginBefore) throw new Error('Compact work begin result did not shrink.');
if (report.resultBudgets.execSuccess >= 1000) throw new Error(`Exec success envelope is ${report.resultBudgets.execSuccess} bytes; limit is 999.`);
if (report.resultBudgets.boundedSnapshot >= 16_000) throw new Error(`Snapshot result is ${report.resultBudgets.boundedSnapshot} bytes; limit is 15999.`);
if (skillMetrics.totalBytes >= 25_000) throw new Error(`Skill package is ${skillMetrics.totalBytes} bytes; initial budget is 24999.`);

console.log(JSON.stringify(report, null, 2));

function skillMeasurements() {
  const skillRoot = path.join(root, 'skills');
  const files = [];
  for (const directory of fs.readdirSync(skillRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    for (const relative of ['SKILL.md', path.join('agents', 'openai.yaml')]) {
      const file = path.join(skillRoot, directory.name, relative);
      if (fs.existsSync(file)) files.push({ path: path.relative(root, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size });
    }
  }
  return { files, totalBytes: files.reduce((total, item) => total + item.bytes, 0) };
}
function reduction(current) { return Number(((1 - current / baseline.discoverySchemaBytes) * 100).toFixed(2)); }
function bytes(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }

export { baseline, measure };
