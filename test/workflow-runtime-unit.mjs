import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildWorkflowSnapshot } from '../src/workflow/runtime.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-workflow-runtime-'));
try {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  fs.writeFileSync(path.join(root, 'README.md'), '# docs\n');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const app = true;\n');

  const readOnly = await snapshotFor([], { mutationGeneration: 0 });
  assert.equal(readOnly.completion.hardReady, true, 'read-only work must be completion-ready without validation');

  const docs = await snapshotFor(['README.md']);
  assert.equal(docs.completion.hardReady, true, 'low-risk documentation changes must not invent a validation blocker');

  const docsFailed = await snapshotFor(['README.md'], { validationResult: 'failed' });
  assert.equal(docsFailed.completion.hardReady, false, 'an explicit failed check remains authoritative even for low-risk docs');

  const sourceUnvalidated = await snapshotFor(['src/app.js']);
  assert.equal(sourceUnvalidated.completion.hardReady, false, 'behavior-changing source mutations require current validation');

  const sourcePassed = await snapshotFor(['src/app.js'], {
    validationResult: 'passed', hasPassedValidation: true, latestValidatedMutationGeneration: 1
  });
  assert.equal(sourcePassed.completion.hardReady, true, 'current-generation source validation must satisfy workflow readiness');

  const sourceChangedAfterPass = await snapshotFor(['src/app.js'], {
    mutationGeneration: 2, validationResult: 'passed', hasPassedValidation: true, latestValidatedMutationGeneration: 1
  });
  assert.equal(sourceChangedAfterPass.completion.hardReady, false, 'source changes after validation must require revalidation');
  assert.match(sourceChangedAfterPass.completion.blockers.join(' '), /changed after|no passed/i);

  const explicit = await buildWorkflowSnapshot({
    workspace: { alias: 'app', path: root },
    taskId: 'task-explicit',
    taskIntegrity: baseIntegrity(['src/app.js']),
    currentResult: { ok: true, items: [{ path: 'src/app.js', sha256: 'abc' }] },
    hardCompletion: { hardReady: true, blockers: [] }
  });
  assert.equal(explicit.completion.hardReady, true, 'authoritative completion supplied by the caller must still win over derived guidance');
  assert.ok(Buffer.byteLength(JSON.stringify(explicit)) <= 8192);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

async function snapshotFor(changedFiles, overrides = {}) {
  return buildWorkflowSnapshot({
    workspace: { alias: 'app', path: root },
    taskId: 'task-1',
    taskIntegrity: { ...baseIntegrity(changedFiles), ...overrides },
    recentEvidence: [],
    currentResult: { ok: true },
    processes: []
  });
}

function baseIntegrity(changedFiles) {
  return {
    taskOwnedChangedFiles: changedFiles,
    mutationGeneration: changedFiles.length ? 1 : 0,
    latestValidatedMutationGeneration: 0,
    validationResult: 'not_run',
    hasPassedValidation: false,
    externalChangedFiles: []
  };
}

console.log('Runtime workflow completion readiness matches authoritative risk-based validation policy.');
