import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildWorkflowSnapshot } from '../src/workflow/runtime.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-workflow-runtime-'));
try {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const app = true;\n');
  let gitStatusCalls = 0;
  const snapshot = await buildWorkflowSnapshot({
    workspace: { alias: 'app', path: root },
    taskId: 'task-1',
    taskIntegrity: {
      taskOwnedChangedFiles: [], mutationGeneration: 0, latestValidatedMutationGeneration: 0,
      validationResult: 'not_run', hasPassedValidation: false, externalChangedFiles: []
    },
    recentEvidence: [],
    currentResult: { ok: true, items: [{ path: 'src/app.js', sha256: 'abc' }] },
    processes: [],
    hardCompletion: { hardReady: true, blockers: [] },
    hooks: { gitStatus: () => { gitStatusCalls += 1; return []; } }
  });
  assert.equal(gitStatusCalls, 0, 'ordinary post-read workflow assembly must not spawn a fresh Git status process');
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.intent, 'investigation');
  assert.equal(snapshot.stage, 'complete');
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 8192);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Runtime workflow snapshot assembly tests passed.');