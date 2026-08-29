import assert from 'node:assert/strict';

import { summarizeDashboardTask } from '../src/http/dashboardData.js';
import { buildTaskSemanticProgress, classifyTaskChangedFiles, semanticMilestoneForEvent } from '../src/taskSemanticProgress.js';

const files = classifyTaskChangedFiles([
  'tools/apktool.jar',
  'decoded/smali/com/example/PremiumGate.smali',
  '.relai/cache/native-index.bin'
]);
assert.deepEqual(files.productFiles, ['decoded/smali/com/example/PremiumGate.smali']);
assert.deepEqual(files.supportArtifacts, ['tools/apktool.jar', '.relai/cache/native-index.bin']);

const nativeInspection = semanticMilestoneForEvent({
  timestamp: '2026-08-29T12:00:00.000Z',
  status: 'succeeded',
  tool: { name: 'exec' },
  summary: 'Ran powershell.exe -NoProfile -Command "$b=[IO.File]::ReadAllBytes(\'C:\\\\Dev\\\\instaprime-bypass\\\\decoded\\\\lib\\\\arm64-v8a\\\\libprimemods.so\'); $s=[Text.Encoding]::ASCII.GetString($b)". Exit code 0.'
});
assert.equal(nativeInspection?.label, 'Inspected native binary');
assert.equal(nativeInspection?.detail, 'libprimemods.so');
assert.doesNotMatch(nativeInspection?.label || '', /powershell/i);

const task = buildTaskSemanticProgress({
  status: 'planning',
  activeCalls: 0,
  currentStage: 'Planning next step',
  currentActivity: 'Waiting for the next task step',
  changedFiles: ['tools/apktool.jar'],
  events: [
    {
      timestamp: '2026-08-29T11:55:00.000Z',
      status: 'succeeded',
      tool: { name: 'snapshot' },
      summary: 'Read repository and workspace status.'
    },
    {
      timestamp: '2026-08-29T11:57:00.000Z',
      status: 'succeeded',
      tool: { name: 'exec' },
      summary: 'Ran java -jar tools/apktool.jar d "InstaPrime V7.2 64bit UnClone.apk" -o decoded. Exit code 0.'
    },
    {
      timestamp: '2026-08-29T12:00:00.000Z',
      status: 'succeeded',
      tool: { name: 'exec' },
      summary: 'Ran powershell.exe -NoProfile -Command "$b=[IO.File]::ReadAllBytes(\'C:\\\\Dev\\\\instaprime-bypass\\\\decoded\\\\lib\\\\arm64-v8a\\\\libprimemods.so\')". Exit code 0.'
    },
    {
      timestamp: '2026-08-29T12:01:00.000Z',
      status: 'succeeded',
      tool: { name: 'work.status' },
      summary: 'Reading workspace and repository status for instaprime-bypass.'
    }
  ]
});

assert.equal(task.currentStage, 'Latest meaningful progress');
assert.equal(task.currentActivity, 'Inspected native binary · libprimemods.so');
assert.equal(task.productChangedFileCount, 0);
assert.equal(task.supportArtifactCount, 1);
assert.deepEqual(task.milestones.map(item => item.label), [
  'Inventoried project structure',
  'Decompiled application artifact',
  'Inspected native binary'
]);
assert.equal(task.milestones.some(item => /repository status|powershell/i.test(`${item.label} ${item.detail || ''}`)), false);

const projected = summarizeDashboardTask({
  taskId: 'task-semantic',
  status: 'planning',
  activeCalls: 0,
  currentStage: 'Planning next step',
  currentActivity: 'Waiting for the next task step',
  changedFiles: ['tools/apktool.jar'],
  events: [{
    timestamp: '2026-08-29T12:00:00.000Z',
    status: 'succeeded',
    tool: { name: 'exec' },
    summary: 'Ran powershell.exe -NoProfile -Command "$b=[IO.File]::ReadAllBytes(\'C:\\\\Dev\\\\instaprime-bypass\\\\decoded\\\\lib\\\\arm64-v8a\\\\libprimemods.so\')". Exit code 0.'
  }]
});
assert.equal(Object.hasOwn(projected, 'events'), false, 'dashboard summaries must stay compact and omit raw event timelines');
assert.equal(projected.semanticProgress.currentActivity, 'Inspected native binary · libprimemods.so');
assert.equal(projected.semanticProgress.productChangedFileCount, 0);
assert.equal(projected.semanticProgress.supportArtifactCount, 1);

console.log('Semantic task progress promotes meaningful work and keeps raw tool telemetry out of the task card.');
