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

await assert.doesNotReject(() => validateToolOutput({}, 'relai_worktree', {
  action: 'create',
  work_id: 'work_output',
  name: 'feature'
}, {
  ok: true,
  work_id: 'work_output',
  id: 'wt_123',
  alias: 'repo--feature',
  sourceAlias: 'repo',
  sourcePath: 'C:/repo',
  path: 'C:/state/worktrees/repo/feature',
  branch: 'relai/feature',
  base: 'main',
  owningTaskId: 'work_output',
  createdAt: '2026-08-08T00:00:00.000Z',
  git: { exitCode: 0 }
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
    case 'relai_exec:default': return { command: 'npm test' };
    case 'relai_process:start': return { command: 'npm run dev', kind: 'service', purpose: 'Validate.' };
    case 'relai_process:read':
    case 'relai_process:stop': return { processId: 'proc_output' };
    case 'relai_process:write': return { processId: 'proc_output', input: 'status\n' };
    case 'relai_worktree:create': return { name: 'feature' };
    case 'relai_worktree:remove': return { alias: 'repo--feature' };
    case 'relai_validate:http': return { route: '/health' };
    case 'relai_changes:restore': return { paths: ['README.md'] };
    case 'relai_changes:reset': return { confirmation: 'RESET' };
    case 'relai_changes:tidy_run': return { planId: 'tidy_abcdefghijklmnopqrst' };
    case 'relai_publish:commit': return { message: 'Validate output' };
    default: return {};
  }
}
