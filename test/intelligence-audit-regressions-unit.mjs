import assert from 'node:assert/strict';

import { configuredPeers, peerHasStrongRelationshipEvidence, relationshipKey } from '../src/repository/intelligence/crossWorkspace.js';
import { repositoryFreshness } from '../src/repository/intelligence/state.js';
import { buildWorkflowSnapshot } from '../src/workflow/runtime.js';
import { classifyWorkflowRisk } from '../src/workflow/risk.js';

assert.equal(relationshipKey('EMITS', 'visibilitychange'), '', 'generic browser events must not become cross-workspace contracts');
assert.equal(relationshipKey('LISTENS_ON', 'event:message'), '', 'generic message events must not become cross-workspace contracts');
assert.equal(relationshipKey('EMITS', 'error'), '', 'generic EventEmitter events must not become cross-workspace contracts');
assert.equal(relationshipKey('LISTENS_ON', 'aborted'), '', 'generic Node runtime events must not become cross-workspace contracts');
assert.equal(relationshipKey('EMITS', 'relai:task-completed'), 'event:relai:task-completed');
assert.equal(relationshipKey('HTTP_CALLS', 'GET https://example.test/api/tasks?limit=1'), 'GET /api/tasks');

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

console.log('Intelligence audit regression tests passed.');
