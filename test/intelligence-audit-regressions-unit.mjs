import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { rankMatchGroups } from '../src/bridge/searchPlanner.js';
import { analyzeArchitecture } from '../src/repository/intelligence/architecture.js';
import { configuredPeers, peerHasStrongRelationshipEvidence, relationshipKey } from '../src/repository/intelligence/crossWorkspace.js';
import { rankWithGraphDiffusion } from '../src/repository/intelligence/graphDiffusion.js';
import { repositoryFreshness } from '../src/repository/intelligence/state.js';
import { parseSourceFile } from '../src/repository/intelligence/treeSitter.js';
import { OPERATION_IDS as OP } from '../src/tools/operationIds.js';
import { buildWorkflowEvidenceReceipt, repeatFailureCount } from '../src/workflow/evidence.js';
import { classifyTaskIntent } from '../src/workflow/intent.js';
import { buildWorkflowSnapshot } from '../src/workflow/runtime.js';
import { classifyWorkflowRisk } from '../src/workflow/risk.js';
import { clearTopologyCache, discoverRepositoryTopology } from '../src/workflow/topology.js';

assert.equal(relationshipKey('EMITS', 'visibilitychange'), '', 'generic browser events must not become cross-workspace contracts');
assert.equal(relationshipKey('LISTENS_ON', 'event:message'), '', 'generic message events must not become cross-workspace contracts');
assert.equal(relationshipKey('EMITS', 'error'), '', 'generic EventEmitter events must not become cross-workspace contracts');
assert.equal(relationshipKey('LISTENS_ON', 'aborted'), '', 'generic Node runtime events must not become cross-workspace contracts');
assert.equal(relationshipKey('EMITS', 'relai:task-completed'), 'event:relai:task-completed');
assert.equal(relationshipKey('HTTP_CALLS', 'GET https://example.test/api/tasks?limit=1'), 'GET /api/tasks');
assert.equal(classifyTaskIntent('audit the intelligence for bugs, stale logic, and performance improvements'), 'review',
  'explicit audit intent must outrank incidental performance and bug keywords');
assert.equal(classifyTaskIntent('fix the performance regression in repository search'), 'bugfix');

const genericPeer = {
  packageInfo: { name: 'unrelated-app', dependencies: new Set() },
  hints: [{ type: 'LISTENS_ON', targetName: 'visibilitychange' }]
};
assert.equal(peerHasStrongRelationshipEvidence(
  { name: 'rel-ai-mcp', dependencies: new Set() },
  [{ type: 'EMITS', targetName: 'visibilitychange' }],
  genericPeer
), false, 'generic events must not make unrelated workspaces graph peers');

const httpPeer = {
  packageInfo: { name: 'api-service', dependencies: new Set() },
  hints: [{ type: 'HANDLES', targetName: 'POST /api/tasks' }]
};
assert.equal(peerHasStrongRelationshipEvidence(
  { name: 'rel-ai-mcp', dependencies: new Set() },
  [{ type: 'HTTP_CALLS', targetName: 'POST https://example.test/api/tasks' }],
  httpPeer
), true, 'matching HTTP boundaries are strong cross-workspace evidence');

const sandboxPeers = configuredPeers(
  { alias: '__relai_sandbox_task', path: 'C:/tmp/sandbox', taskSandbox: true, sourceAlias: 'rel-ai-mcp' },
  { workspaces: {
    'rel-ai-mcp': { path: 'C:/repos/rel-ai-mcp' },
    'other-app': { path: 'C:/repos/other-app' }
  } }
);
assert.deepEqual(sandboxPeers.map(peer => peer.alias), ['other-app'], 'a task sandbox must never cross-link to its own source workspace');

assert.equal(repositoryFreshness({ dirty: true, metadata: { generation: 5 } }, { id: 5 }), 'stale');
assert.equal(repositoryFreshness({ dirty: false, metadata: { generation: 5 } }, { id: 5 }), 'current');
assert.equal(repositoryFreshness({ dirty: false, metadata: null }, { id: 5 }), 'cached-unverified');
assert.equal(repositoryFreshness({ dirty: false, metadata: { generation: 4 } }, { id: 5 }), 'cached-unverified');
assert.equal(repositoryFreshness({ dirty: false, metadata: { generation: 5, freshness: 'partial', truncated: true } }, { id: 5 }), 'partial');
assert.equal(repositoryFreshness({ dirty: false, metadata: { generation: 5, freshness: 'runtime-stale' } }, { id: 5 }), 'stale');

assert.equal(repeatFailureCount([
  { outcome: 'failed', failureSignature: 'same', mutationGeneration: 4 },
  { outcome: 'failed', failureSignature: 'same', mutationGeneration: 4 }
]), 1, 'retries without a mutation must not be mistaken for repeated failed fixes');
assert.equal(repeatFailureCount([
  { outcome: 'failed', failureSignature: 'same', mutationGeneration: 4 },
  { outcome: 'failed', failureSignature: 'same', mutationGeneration: 5 }
]), 2, 'the same failure across distinct mutation generations must count as a repeated failed fix');

const topologyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-intelligence-topology-'));
try {
  fs.mkdirSync(path.join(topologyRoot, 'packages', 'api'), { recursive: true });
  fs.mkdirSync(path.join(topologyRoot, 'packages', 'web'), { recursive: true });
  fs.writeFileSync(path.join(topologyRoot, 'package.json'), JSON.stringify({ name: 'root' }));
  fs.writeFileSync(path.join(topologyRoot, 'packages', 'api', 'package.json'), JSON.stringify({ name: '@acme/api' }));
  fs.writeFileSync(path.join(topologyRoot, 'packages', 'web', 'package.json'), JSON.stringify({ name: '@acme/web', dependencies: { '@acme/api': 'workspace:*' } }));
  const topology = discoverRepositoryTopology(topologyRoot);
  assert.equal(topology.truncated, false);
  assert.ok(topology.manifestLimit >= 2000);
  assert.deepEqual(topology.packages.find(item => item.name === '@acme/web')?.workspaceDependencies, ['npm:packages/api']);
} finally {
  clearTopologyCache();
  fs.rmSync(topologyRoot, { recursive: true, force: true });
}

const toolSurfaceRisk = classifyWorkflowRisk({ changedFiles: ['src/tools/actionRegistry.js'], packageIds: ['npm:root'] });
assert.equal(toolSurfaceRisk.boundary.level, 'cross_package');
assert.equal(toolSurfaceRisk.risk.level, 'high');
assert.ok(toolSurfaceRisk.risk.reasons.includes('shared contract or public runtime surface changed'));

const structuralRisk = classifyWorkflowRisk({
  changedFiles: ['packages/a/src/index.js'],
  packageIds: ['npm:packages/a'],
  impactedPackageIds: ['npm:packages/a', 'npm:packages/b'],
  impactedPaths: ['packages/a/src/index.js', 'packages/b/src/consumer.js']
});
assert.equal(structuralRisk.boundary.level, 'cross_package');
assert.equal(structuralRisk.risk.level, 'high');
assert.ok(structuralRisk.risk.reasons.includes('structural impact crosses package boundaries'));

const workflow = await buildWorkflowSnapshot({
  workspace: { path: process.cwd() },
  taskIntegrity: {
    taskOwnedChangedFiles: ['src/example.js'],
    mutationGeneration: 2,
    latestValidatedMutationGeneration: 2,
    validationResult: 'passed',
    validatedRepositoryFingerprint: 'fingerprint-current'
  },
  recentEvidence: [
    {
      kind: 'check', outcome: 'passed', mutationGeneration: 2,
      commandId: 'test:unit', command: 'npm test', cwd: '.', repositoryFingerprint: 'fingerprint-stale'
    },
    {
      kind: 'check', outcome: 'passed', mutationGeneration: 2,
      commandId: 'test:unit', command: 'npm test', cwd: '.', repositoryFingerprint: 'fingerprint-current'
    }
  ]
});
assert.equal(workflow.evidence.fresh, 2);
assert.equal(workflow.evidence.reusable, 1, 'workflow reuse count must use the same strict fingerprint semantics as validation');

const failureA = buildWorkflowEvidenceReceipt({
  tool: OP.VALIDATE_CHECKS,
  args: { command: 'npm test' },
  result: { ok: false, exitCode: 1, diagnostics: [{ path: 'src/a.js', line: 4, column: 2, code: 'E_A', severity: 'error', message: 'alpha failed' }] },
  commandId: 'test:unit'
});
const failureB = buildWorkflowEvidenceReceipt({
  tool: OP.VALIDATE_CHECKS,
  args: { command: 'npm test' },
  result: { ok: false, exitCode: 1, diagnostics: [{ path: 'src/b.js', line: 8, column: 3, code: 'E_B', severity: 'error', message: 'beta failed' }] },
  commandId: 'test:unit'
});
assert.notEqual(failureA.failureSignature, failureB.failureSignature,
  'repeat-failure intelligence must distinguish different failures from the same command and exit code');

const rankedGroups = rankMatchGroups([
  { path: 'src/intelligence-audit.js', matches: [{ line: 1 }] },
  { path: 'src/other.js', matches: Array.from({ length: 20 }, (_, index) => ({ line: index + 1 })) }
], 'intelligence audit', { taskOwnedPaths: ['src/other.js'] });
assert.equal(rankedGroups[0].path, 'src/intelligence-audit.js',
  'task context must remain a secondary search signal and not overwhelm an exact path match');

const unsupported = await parseSourceFile({ relativePath: 'notes.txt', source: 'plain text' });
assert.equal(unsupported.structuralStatus, 'unsupported');
assert.equal(unsupported.parseError, false);

const graphDb = new DatabaseSync(':memory:');
try {
  graphDb.exec(`
    CREATE TABLE files(id INTEGER PRIMARY KEY, path TEXT NOT NULL, language TEXT NOT NULL, is_test INTEGER NOT NULL);
    CREATE TABLE edges(id INTEGER PRIMARY KEY, source_file_id INTEGER NOT NULL, target_file_id INTEGER, type TEXT NOT NULL, provider TEXT NOT NULL, confidence REAL NOT NULL);
  `);
  const insertFile = graphDb.prepare('INSERT INTO files(id, path, language, is_test) VALUES (?, ?, ?, 0)');
  const insertEdge = graphDb.prepare('INSERT INTO edges(source_file_id, target_file_id, type, provider, confidence) VALUES (?, ?, ?, ?, ?)');
  insertFile.run(1, 'seed-a.js', 'javascript');
  insertFile.run(2, 'seed-b.js', 'javascript');
  for (let index = 0; index < 101; index += 1) {
    const id = index + 3;
    insertFile.run(id, `a-target-${index}.js`, 'javascript');
    insertEdge.run(1, id, 'IMPORTS', 'tree-sitter', 0.95);
  }
  insertFile.run(104, 'b-target.js', 'javascript');
  insertEdge.run(2, 104, 'IMPORTS', 'tree-sitter', 0.95);
  const diffused = rankWithGraphDiffusion(graphDb, [
    { path: 'seed-a.js', snippets: [], reasons: [] },
    { path: 'seed-b.js', snippets: [], reasons: [] }
  ], { maxResults: 100, maxSeeds: 2, maxEdges: 100, query: 'seed' });
  assert.ok(diffused.results.some(item => item.path === 'b-target.js'),
    'graph edge budgets must give every seed a fair share instead of letting an early high-degree seed consume the budget');
} finally {
  graphDb.close();
}

const architectureDb = new DatabaseSync(':memory:');
try {
  architectureDb.exec(`
    CREATE TABLE files(id INTEGER PRIMARY KEY, path TEXT NOT NULL, language TEXT NOT NULL, is_test INTEGER NOT NULL);
    CREATE TABLE symbols(id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL);
    CREATE TABLE edges(id INTEGER PRIMARY KEY, source_file_id INTEGER NOT NULL, target_file_id INTEGER, type TEXT NOT NULL, target_name TEXT, confidence REAL NOT NULL);
  `);
  const insertFile = architectureDb.prepare('INSERT INTO files(id, path, language, is_test) VALUES (?, ?, ?, 0)');
  const insertEdge = architectureDb.prepare('INSERT INTO edges(source_file_id, target_file_id, type, target_name, confidence) VALUES (?, ?, ?, NULL, ?)');
  insertFile.run(1, 'packages/a/index.js', 'javascript');
  insertFile.run(2, 'packages/b/index.js', 'javascript');
  insertEdge.run(1, 2, 'IMPORTS', 0.95);
  insertEdge.run(2, 1, 'IMPORTS', 0.95);
  for (let index = 0; index < 100; index += 1) {
    const id = index + 3;
    insertFile.run(id, `src/low-${String(index).padStart(3, '0')}.js`, 'javascript');
  }
  insertFile.run(103, 'zz-hot.js', 'javascript');
  for (let index = 0; index < 30; index += 1) insertEdge.run(index + 3, 103, 'IMPORTS', 0.95);
  insertFile.run(104, 'src/repository/intelligence/core.js', 'javascript');
  insertFile.run(105, 'src/workflow/runtime.js', 'javascript');
  insertEdge.run(104, 105, 'IMPORTS', 0.95);
  insertFile.run(106, 'src/ui/app.css', 'css');
  insertEdge.run(106, 103, 'IMPORTS', 0.95);
  const architecture = analyzeArchitecture(architectureDb, { maxResults: 200, maxNodes: 100, maxEdges: 100 });
  assert.ok(architecture.cycles.some(item => item.modules.includes('packages/a') && item.modules.includes('packages/b')),
    'cyclic modules must be collapsed into a strongly connected component instead of receiving arbitrary dependency depth');
  assert.ok(architecture.hotspots.some(item => item.path === 'zz-hot.js'),
    'bounded architecture sampling must keep structurally important files even when they sort late alphabetically');
  assert.ok(architecture.modules.some(item => item.name === 'src/repository/intelligence'),
    'single-package src trees must expose meaningful subsystem modules rather than collapse entirely into src');
  assert.equal(architecture.entryPoints.some(item => item.path === 'src/ui/app.css'), false,
    'non-executable assets must never be ranked as runtime entry points');
} finally {
  architectureDb.close();
}

console.log('Intelligence audit regression tests passed.');
