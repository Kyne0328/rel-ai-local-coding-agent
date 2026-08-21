import assert from 'node:assert/strict';

import { buildTaskBootstrap, contextDiagnostics } from '../../src/context/context-builder.js';

const snapshot = {
  manifests: ['package.json'],
  discoveredCommands: { test: 'npm test', lint: 'npm run lint' },
  projectInstructions: {
    sources: ['AGENTS.md'],
    content: 'Keep changes small.',
    truncated: false,
    totalBytes: 19,
    returnedBytes: 19,
    securityBoundary: 'Repeated global security text.'
  },
  fileCount: 500,
  files: ['src/a.js'],
  manifestContents: { 'package.json': '{"scripts":{"test":"node test.mjs"}}' },
  skipped: [{ path: 'asset.bin' }],
  truncated: false,
  hints: ['Node/JavaScript/TypeScript project'],
  git: { branch: 'main', dirtyFiles: 1, changedFiles: ['src/a.js'] },
  recommendedFlow: ['Use the minimum tool calls needed'],
  writeGuidance: { mode: 'exact' },
  operationJournal: { recent: ['raw historical event'] }
};

const compact = buildTaskBootstrap(snapshot, 'compact');
assert.equal(compact.mode, 'compact');
assert.deepEqual(compact.manifests, ['package.json']);
assert.equal(compact.fileCount, 500);
assert.deepEqual(compact.git.changedFiles, ['src/a.js']);
assert.equal(compact.projectInstructions.content, 'Keep changes small.');
for (const key of ['discoveredCommands', 'files', 'manifestContents', 'skipped', 'recommendedFlow', 'writeGuidance', 'operationJournal']) {
  assert.equal(Object.hasOwn(compact, key), false, `compact bootstrap must omit ${key}`);
}
assert.equal(Object.hasOwn(compact.projectInstructions, 'securityBoundary'), false, 'global security text must not be duplicated in repository context');
assert.equal(Object.hasOwn(compact.projectInstructions, 'totalBytes'), false, 'byte-accounting metadata belongs in diagnostics, not model context');

const full = buildTaskBootstrap(snapshot, 'full');
assert.deepEqual(full.discoveredCommands, snapshot.discoveredCommands, 'full bootstrap remains available on explicit request');
assert.deepEqual(full.files, snapshot.files);
assert.deepEqual(full.operationJournal, snapshot.operationJournal);

const diagnostics = contextDiagnostics({ static: 'abcd', repository: compact });
assert.equal(diagnostics.static.bytes, 4);
assert.ok(diagnostics.repository.bytes > 0);
assert.equal(diagnostics.total.bytes, diagnostics.static.bytes + diagnostics.repository.bytes);

console.log('Context builder keeps compact bootstrap task-local while preserving explicit full bootstrap.');
