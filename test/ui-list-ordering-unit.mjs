import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { orderToolsForCatalog } from '../src/ui/features/tools/index.js';
import { orderChangedFiles, orderSessionsForDisplay } from '../src/ui/features/sessions/index.js';
import { orderWorkspacesAlphabetically } from '../src/ui/components/workspace-menu.js';
import { buildAttention, orderOverviewTasks, orderOverviewWorkspaces } from '../src/ui/features/home/index.js';
import { sortEntries as orderActivityEntries } from '../src/ui/features/activity/index.js';

const require = createRequire(import.meta.url);
const { aliasConsistencyCheck, cautionSummary } = require('../src/productUx.js');

const orderedTools = orderToolsForCatalog([
  { name: 'relai_restore_paths', title: 'Restore Tracked Paths' },
  { name: 'relai_reset_workspace', title: 'Reset Workspace State' },
  { name: 'relai_status', title: 'Rel.AI Status' },
  { name: 'relai_read', title: 'Read Local Repo Paths' },
  { name: 'relai_code_inspect', title: 'Code Intelligence' },
  { name: 'relai_git_push', title: 'Publish Branch' },
  { name: 'relai_http_probe', title: 'HTTP Route Probe' },
  { name: 'relai_ui_check', title: 'Named UI Check' },
  { name: 'relai_edit', title: 'Unified Workspace Edit' },
  { name: 'relai_run_checks', title: 'Workspace Checks' }
]);
assert.deepEqual(orderedTools.map(tool => tool.name), [
  'relai_code_inspect',
  'relai_read',
  'relai_status',
  'relai_edit',
  'relai_http_probe',
  'relai_ui_check',
  'relai_run_checks',
  'relai_git_push',
  'relai_reset_workspace',
  'relai_restore_paths'
]);

const sessions = [
  { id: 'older', endedAt: '2026-07-25T10:00:00.000Z' },
  { id: 'invalid', endedAt: 'not-a-date' },
  { id: 'newer', completedAt: '2026-07-25T12:00:00.000Z' }
];
assert.deepEqual(orderSessionsForDisplay(sessions).map(session => session.id), ['newer', 'older', 'invalid']);
assert.deepEqual(orderSessionsForDisplay([
  { id: 'completed-newest', status: 'completed', completedAt: '2026-07-25T12:04:00.000Z' },
  { id: 'waiting-newer', status: 'waiting', lastActivityAt: '2026-07-25T12:02:00.000Z' },
  { id: 'working-older', status: 'working', lastActivityAt: '2026-07-25T12:01:00.000Z' },
  { id: 'attention-middle', status: 'attention', endedAt: '2026-07-25T12:03:00.000Z' },
  { id: 'inactive-oldest', status: 'inactive', endedAt: '2026-07-25T12:00:00.000Z' }
]).map(session => session.id), [
  'waiting-newer',
  'working-older',
  'completed-newest',
  'attention-middle',
  'inactive-oldest'
]);
assert.deepEqual(orderOverviewTasks(sessions).map(session => session.id), ['newer', 'older', 'invalid']);
assert.deepEqual(orderActivityEntries([
  { id: 'older', ts: '2026-07-25T10:00:00.000Z' },
  { id: 'invalid', ts: 'not-a-date' },
  { id: 'newer', ts: '2026-07-25T12:00:00.000Z' }
]).map(entry => entry.id), ['newer', 'older', 'invalid']);

assert.deepEqual(orderChangedFiles([
  'src/zeta.js',
  'src/file10.js',
  'src/file2.js',
  'src/zeta.js',
  ''
]), ['src/file2.js', 'src/file10.js', 'src/zeta.js']);

const workspaces = [{ alias: 'zeta' }, { alias: 'Alpha' }, { alias: 'repo10' }, { alias: 'repo2' }];
const expectedAliases = ['Alpha', 'repo2', 'repo10', 'zeta'];
assert.deepEqual(orderWorkspacesAlphabetically(workspaces).map(item => item.alias), expectedAliases);
assert.deepEqual(orderOverviewWorkspaces(workspaces).map(item => item.alias), expectedAliases);

const attention = buildAttention(
  [{ alias: 'repo', testCommandKeys: [], discoveredTestCommandKeys: [] }],
  [{ severity: 'error', code: 'workspace_unavailable' }],
  ''
);
assert.deepEqual(attention.map(item => item.title), [
  'Diagnostics need review',
  'ChatGPT endpoint unavailable',
  'Validation is incomplete'
]);
assert.equal(attention[0].tone, 'bad');
assert.equal(Object.hasOwn(attention[0], 'priority'), false);

const aliasReport = aliasConsistencyCheck({
  workspaces: {
    zeta: { path: '/missing-zeta', commands: { zebra: 'z', alpha: 'a' }, testCommands: {} },
    Alpha: { path: '/missing-alpha', commands: {}, testCommands: {} }
  }
});
assert.deepEqual(aliasReport.workspaces.map(item => item.alias), ['Alpha', 'zeta']);
assert.deepEqual(aliasReport.workspaces[1].configuredKeys, ['alpha', 'zebra']);
assert.deepEqual(aliasReport.workspaces[1].staleKeys, ['alpha', 'zebra']);

const now = new Date().toISOString();
const caution = cautionSummary({}, {
  entries: [
    { ts: now, cautionLevel: 'caution', workspace: 'zeta', tool: 'relai_edit' },
    { ts: now, cautionLevel: 'caution', workspace: 'Alpha', tool: 'relai_edit' }
  ]
});
assert.deepEqual(caution.workspaces.map(item => item.alias), ['Alpha', 'zeta']);

console.log('UI list ordering tests passed.');
