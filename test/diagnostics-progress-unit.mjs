import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createToolActivityTracker, runWithToolActivity } from '../src/toolActivity.js';
import { relaiDiagnosticsRun } from '../src/bridge/diagnosticsRunner.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-diagnostics-progress-'));
const workspace = { alias: 'app', path: root, commands: {}, testCommands: {} };
const config = {};
const tracker = createToolActivityTracker({ idleMs: 60_000 });
const events = [];
tracker.onToolActivity(event => events.push(event));

try {
  const start = tracker.beginConnectorToolCall({ tool: 'relai_begin_work', workspace: 'app', createTask: true });
  const taskId = start.taskId;
  start({ ok: true });
  const finish = tracker.beginConnectorToolCall({ tool: 'relai_diagnostics_run', workspace: 'app', taskId });
  const result = await runWithToolActivity(finish, () => relaiDiagnosticsRun(workspace, config, {
    commands: ['node -e "process.exit(0)"', 'node -e "process.exit(1)"'],
    stopOnFailure: false
  }));
  finish({ ok: result.ok, activity: { progress: { mode: 'determinate', completedUnits: result.completedUnits, totalUnits: result.totalUnits, percentage: 99 } } });
  assert.equal(result.ok, false);
  assert.equal(result.completedUnits, 2);
  assert.equal(result.totalUnits, 2);
  const sequence = events
    .filter(event => event.phase === 'progress' && event.taskId === taskId && event.task?.progress?.mode === 'determinate')
    .map(event => `${event.task.progress.completedUnits}/${event.task.progress.totalUnits}`)
    .filter((value, index, values) => index === 0 || value !== values[index - 1]);
  assert.deepEqual(sequence, ['0/2', '1/2', '2/2']);
  const active = tracker.getToolActivity().tasks.find(task => task.taskId === taskId);
  assert.equal(active.progress.percentage, 99);
  tracker.cancelTask(taskId, { reason: 'Test cleanup' });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Diagnostics workflows report live determinate progress without claiming failed work is 100% successful.');
