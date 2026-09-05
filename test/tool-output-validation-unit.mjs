import assert from 'node:assert/strict';
import { getToolActionCatalog } from '../src/tools/actionCatalog.js';
import { validateToolOutput } from '../src/tools/outputValidation.js';

const actionCatalog = getToolActionCatalog();

for (const entry of actionCatalog) {
  const args = entry.action === 'default' ? {} : { action: entry.action };
  if (entry.behavior.taskScope === 'required') args.work_id = 'work_output';
  Object.assign(args, requiredArgs(entry));
  await assert.doesNotReject(() => validateToolOutput({}, entry.publicTool, args, {
    ok: false,
    error: 'Expected failure.'
  }));
}

await assert.doesNotReject(() => validateToolOutput({}, 'relai_search', {
  action: 'text',
  work_id: 'work_output',
  pattern: 'needle'
}, {
  ok: true,
  workspace: 'repo',
  work_id: 'work_output',
  pattern: 'needle',
  mode: 'auto',
  effectiveMode: 'context',
  autoTier: 'focused',
  selectionStrategy: 'path-and-match-density',
  matchCount: 1,
  files: []
}));

await assert.doesNotReject(() => validateToolOutput({}, 'relai_search', {
  action: 'semantic',
  work_id: 'work_output',
  query: 'needle'
}, {
  ok: true,
  workspace: 'repo',
  work_id: 'work_output',
  query: 'needle',
  strategy: 'hybrid',
  neuralEmbeddings: true,
  results: [],
  resultCount: 0,
  truncated: false
}));

await assert.doesNotReject(() => validateToolOutput({}, 'relai_snapshot', {
  work_id: 'work_output'
}, {
  ok: true,
  workspace: 'repo',
  work_id: 'work_output',
  fileCount: 700,
  files: ['src/index.js'],
  returnedFileCount: 1,
  omittedFiles: 699,
  truncated: true,
  next: 'Use relai_search or targeted relai_read calls for omitted repository paths.'
}));

await assert.doesNotReject(() => validateToolOutput({}, 'relai_process', {
  action: 'list',
  workspace: 'repo'
}, {
  ok: true,
  processes: [],
  count: 0
}));
await assert.doesNotReject(() => validateToolOutput({}, 'relai_process', {
  action: 'read',
  workspace: 'repo',
  processId: 'proc_abcdefghijklmnopqrst'
}, {
  ok: true,
  processId: 'proc_abcdefghijklmnopqrst',
  status: 'running',
  stdout: { text: '', nextOffset: 0 },
  stderr: { text: '', nextOffset: 0 }
}));
await assert.doesNotReject(() => validateToolOutput({}, 'relai_process', {
  action: 'stop',
  workspace: 'repo',
  processId: 'proc_abcdefghijklmnopqrst'
}, {
  ok: true,
  processId: 'proc_abcdefghijklmnopqrst',
  status: 'stopped',
  duplicate: false
}));

await assert.doesNotReject(() => validateToolOutput({}, 'relai_inspect', {
  action: 'diagnostics',
  work_id: 'work_output'
}, {
  ok: true,
  workspace: 'repo',
  work_id: 'work_output',
  action: 'diagnostics',
  index: {},
  languages: { javascript: 12 },
  diagnosticCommands: [],
  discoveryWarnings: [{ source: 'package.json', message: 'Invalid JSON.' }],
  validationCommands: { quick: [], standard: [], release: [] },
  configuredTestCommands: []
}));
await assert.doesNotReject(() => validateToolOutput({}, 'relai_inspect', {
  action: 'architecture',
  work_id: 'work_output'
}, {
  ok: true,
  workspace: 'repo',
  work_id: 'work_output',
  action: 'architecture',
  modules: [],
  entryPoints: [],
  hotspots: [],
  layers: [],
  cycles: [{ modules: ['src/a.js', 'src/b.js'], size: 2 }],
  communities: [],
  summary: { files: 2, analyzedFiles: 2, edges: 2, modules: 2, cycles: 1, communities: 0, entryPoints: 0, hotspots: 0 },
  truncated: false,
  next: 'Use cycles to review dependency boundaries.'
}));
await assert.doesNotReject(() => validateToolOutput({}, 'relai_work', {
  action: 'begin',
  workspace: 'repo'
}, {
  ok: true,
  workspace: 'repo',
  work_id: 'work_output',
  status: 'planning',
  identity: 'work_session',
  title: 'Investigate output contract',
  objective: 'Preserve first-class workflow intent.',
  intent: 'investigation'
}));
await assert.doesNotReject(() => validateToolOutput({}, 'relai_work', {
  action: 'cancel',
  work_id: 'work_output'
}, {
  ok: true,
  work_id: 'work_output',
  status: 'cancelled',
  duplicate: true,
  endReason: 'explicit_cancellation',
  terminalReason: 'Work session cancelled.',
  endedAt: '2026-08-08T00:00:00.000Z',
  cancelledAt: '2026-08-08T00:00:00.000Z',
  progress: { mode: 'indeterminate', label: 'Cancelled' }
}));
await assert.doesNotReject(() => validateToolOutput({}, 'relai_exec', {
  work_id: 'work_output',
  command: 'npm test'
}, {
  ok: true,
  workspace: 'repo',
  work_id: 'work_output',
  executed: true,
  commandSucceeded: true,
  exitCode: 0,
  durationMs: 1
}));

await assert.doesNotReject(() => validateToolOutput({}, 'relai_publish', {
  action: 'commit',
  work_id: 'work_output',
  message: 'Validate output',
  dryRun: true
}, {
  ok: true,
  workspace: 'repo',
  work_id: 'work_output',
  dryRun: true,
  message: 'Validate output',
  addAll: false,
  paths: ['CHANGELOG.md'],
  statusBefore: { branch: 'main' }
}));

await assert.doesNotReject(() => validateToolOutput({}, 'relai_publish', {
  action: 'push',
  work_id: 'work_output',
  dryRun: true
}, {
  ok: true,
  workspace: 'repo',
  work_id: 'work_output',
  remote: 'origin',
  branch: 'main',
  dryRun: true,
  setUpstream: false,
  push: { exitCode: 0 }
}));

await assert.rejects(() => validateToolOutput({}, 'relai_publish', {
  action: 'push',
  work_id: 'work_output'
}, {
  ok: true,
  workspace: 'repo',
  work_id: 'work_output',
  unexpected: true
}), /Unexpected fields: unexpected/);

console.log(`Catalog-backed output validation passed for all ${actionCatalog.length} actions.`);

function requiredArgs(entry) {
  const key = `${entry.publicTool}:${entry.action}`;
  switch (key) {
    case 'relai_work:begin': return { workspace: 'repo' };
    case 'relai_work:finish': return { summary: 'Done.' };
    case 'relai_search:text': return { pattern: 'needle' };
    case 'relai_search:semantic': return { query: 'needle' };
    case 'relai_inspect:symbol':
    case 'relai_inspect:references':
    case 'relai_inspect:trace': return { symbol: 'target' };
    case 'relai_inspect:related': return { query: 'target' };
    case 'relai_inspect:impact': return { paths: ['src/index.js'] };
    case 'relai_skill:create':
    case 'relai_skill:edit': return { name: 'output-skill', content: 'skill content' };
    case 'relai_skill:patch': return { name: 'output-skill', oldText: 'old', newText: 'new' };
    case 'relai_skill:delete': return { name: 'output-skill' };
    case 'relai_exec:default': return { command: 'npm test' };
    case 'relai_process:start': return { command: 'npm run dev', kind: 'service', purpose: 'Validate.' };
    case 'relai_ui:start': return { port: 3000 };
    case 'relai_ui:navigate': return { sessionId: 'ui_abcdefghijklmnopqrst', route: '/' };
    case 'relai_ui:interact': return { sessionId: 'ui_abcdefghijklmnopqrst', interaction: 'click', target: { by: 'text', value: 'Save' } };
    case 'relai_ui:viewport': return { sessionId: 'ui_abcdefghijklmnopqrst', width: 1280, height: 720 };
    case 'relai_ui:snapshot':
    case 'relai_ui:screenshot':
    case 'relai_ui:console':
    case 'relai_ui:network':
    case 'relai_ui:reload':
    case 'relai_ui:stop': return { sessionId: 'ui_abcdefghijklmnopqrst' };
    case 'relai_computer:move':
    case 'relai_computer:click':
    case 'relai_computer:double_click':
    case 'relai_computer:right_click': return { x: 10, y: 20 };
    case 'relai_computer:drag': return { x: 10, y: 20, toX: 30, toY: 40 };
    case 'relai_computer:scroll': return { direction: 'down' };
    case 'relai_computer:type': return { text: 'hello' };
    case 'relai_computer:key': return { key: 'enter' };
    case 'relai_computer:hotkey': return { keys: ['ctrl', 's'] };
    case 'relai_process:read':
    case 'relai_process:stop': return { processId: 'proc_output' };
    case 'relai_process:write': return { processId: 'proc_output', input: 'status\n' };
    case 'relai_validate:http': return { route: '/health' };
    case 'relai_changes:restore': return { paths: ['README.md'] };
    case 'relai_changes:reset': return {};
    case 'relai_changes:replay': return { checkpointId: 'review_abcdefghijklmnopqrstuvwx' };
    case 'relai_changes:tidy_run': return { planId: 'tidy_abcdefghijklmnopqrst' };
    case 'relai_publish:commit': return { message: 'Validate output' };
    default: return {};
  }
}
