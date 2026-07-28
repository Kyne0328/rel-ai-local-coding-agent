import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readTaskHistorySession, recordTaskActivityEvent, recordTaskHistoryEvent } from "../src/taskHistoryStore.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-history-live-'));
const config = { stateDir: sandbox, auditLogPath: path.join(sandbox, 'audit.jsonl') };
fs.writeFileSync(config.auditLogPath, '', 'utf8');

const baseTask = {
  id: 'task-live',
  taskId: 'task-live',
  sessionId: 'task-live',
  title: 'Inspect session activity model',
  objective: 'Trace and improve task activity persistence.',
  status: 'running',
  progress: { mode: 'indeterminate', label: 'Inspecting repository' },
  currentStage: 'Inspecting repository',
  currentActivity: 'Reading session storage code.',
  calls: 1,
  toolCallCount: 1,
  successfulToolCallCount: 0,
  failedToolCallCount: 0,
  failures: 0,
  workspace: 'repo',
  startedAt: Date.parse('2026-07-28T10:00:00.000Z'),
  startedAtIso: '2026-07-28T10:00:00.000Z',
  updatedAt: '2026-07-28T10:00:01.000Z',
  activeCalls: 1,
  currentOperations: []
};

const runningEvent = {
  eventId: 'operation-1',
  taskId: 'task-live',
  sessionId: 'task-live',
  sequence: 1,
  timestamp: '2026-07-28T10:00:01.000Z',
  category: 'tool',
  action: 'read',
  status: 'running',
  title: 'Read session storage code',
  summary: 'Reading 2 repository files.',
  startedAt: '2026-07-28T10:00:01.000Z',
  tool: { name: 'relai_read', operation: 'Read repository files', invocationId: 'operation-1' },
  metadata: { pathCount: 2 }
};

try {
  recordTaskActivityEvent(config, { taskId: 'task-live', task: baseTask, activityEvent: runningEvent });
  recordTaskHistoryEvent(config, {
    id: 'audit-1',
    ts: '2026-07-28T10:00:01.000Z',
    taskId: 'task-live',
    taskIdentityVersion: 2,
    taskIdExplicit: true,
    taskHistoryEligible: true,
    operationId: 'operation-1',
    tool: 'relai_read',
    workspace: 'repo',
    operation: 'Read repository files',
    ok: true,
    ms: 500
  });

  const completedEvent = {
    ...runningEvent,
    timestamp: '2026-07-28T10:00:02.000Z',
    status: 'succeeded',
    summary: 'Read 2 repository files.',
    completedAt: '2026-07-28T10:00:02.000Z',
    durationMs: 1000,
    result: { outcome: 'Read 2 items', affectedItemCount: 2 }
  };
  recordTaskActivityEvent(config, {
    taskId: 'task-live',
    task: {
      ...baseTask,
      status: 'planning',
      progress: { mode: 'indeterminate', label: 'Waiting for the next task step' },
      currentStage: 'Planning next step',
      currentActivity: 'Read 2 repository files.',
      successfulToolCallCount: 1,
      updatedAt: '2026-07-28T10:00:02.000Z',
      activeCalls: 0
    },
    activityEvent: completedEvent
  });

  let session = readTaskHistorySession(config, 'task-live');
  assert.equal(session.calls, 1, 'audit enrichment must not double-count a represented tool invocation');
  assert.equal(session.toolCallCount, 1);
  assert.equal(session.successfulToolCallCount, 1);
  assert.equal(session.events.length, 1, 'running and completed updates must upsert one lifecycle event');
  assert.equal(session.events[0].status, 'succeeded');
  assert.equal(session.events[0].durationMs, 1000);
  assert.equal(session.status, 'planning');

  recordTaskActivityEvent(config, {
    taskId: 'task-live',
    task: {
      ...baseTask,
      status: 'completed',
      completionKnown: true,
      progress: { mode: 'complete', percentage: 100, label: 'Task completed' },
      currentStage: 'Completed',
      currentActivity: 'Task completed successfully.',
      resultSummary: 'Task completed successfully.',
      successfulToolCallCount: 1,
      updatedAt: '2026-07-28T10:00:03.000Z',
      completedAtIso: '2026-07-28T10:00:03.000Z',
      activeCalls: 0
    }
  });
  recordTaskActivityEvent(config, {
    taskId: 'task-live',
    task: {
      ...baseTask,
      status: 'running',
      updatedAt: '2026-07-28T10:00:02.500Z'
    }
  });

  session = readTaskHistorySession(config, 'task-live');
  assert.equal(session.status, 'completed', 'a stale running update must not regress a terminal task');
  assert.equal(session.progress.mode, 'complete');
  assert.equal(session.progress.percentage, 100);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('Live task history is idempotent, lifecycle-aware, and terminal-state safe.');
