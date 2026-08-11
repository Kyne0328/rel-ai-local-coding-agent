import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readRecentWorkflowEvidence, readTaskHistorySession, recordTaskHistoryEvent, recordWorkflowEvidence } from '../src/taskHistoryStore.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-workflow-evidence-history-'));
const config = { stateDir: path.join(root, 'state') };
try {
  recordTaskHistoryEvent(config, { taskId: 'task-1', taskHistoryEligible: true, taskIdentityVersion: 2, taskIdExplicit: true, tool: 'relai_begin_work', workspace: 'repo', ok: true, ts: new Date().toISOString() });
  const receipt = { version: 1, key: 'check:a', kind: 'check', sourceTool: 'relai_exec', createdAt: new Date().toISOString(), commandId: 'npm:test', command: 'npm test', cwd: '.', outcome: 'passed', repositoryFingerprint: 'fp', mutationGeneration: 1, workspaceGeneration: 2, paths: [], metadata: { exitCode: 0 } };
  recordWorkflowEvidence(config, 'task-1', receipt);
  assert.deepEqual(readRecentWorkflowEvidence(config, 'task-1'), [receipt]);
  assert.equal(Object.hasOwn(readTaskHistorySession(config, 'task-1'), 'workflowEvidence'), false, 'public task history must not expose raw receipts');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Workflow evidence persists privately in task history.');