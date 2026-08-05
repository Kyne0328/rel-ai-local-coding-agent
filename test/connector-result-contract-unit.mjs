import assert from 'node:assert/strict';
import { serializeConnectorResult } from '../src/tools/connector.js';

const cases = [
  fixture('relai_work:begin', 'relai_work', 'begin', 'relai_begin_work', 'work_begin', {
    ok: true, workspace: 'repo', work_id: 'work_begin', status: 'planning', identity: 'work_session',
    workspaceBinding: { alias: 'repo' }, title: 'Contract work', objective: 'Characterize results.', nextAction: 'Use bootstrap.'
  }, {
    ok: true, workspace: 'repo', work_id: 'work_begin', status: 'planning', identity: 'work_session',
    title: 'Contract work', objective: 'Characterize results.'
  }),
  fixture('relai_work:status', 'relai_work', 'status', 'relai_status', 'work_status', {
    ok: true, version: '0.24.0', runtime: 'node', tools: ['relai_read'],
    toolSurface: { schemaVersion: 5, toolSurfaceVersion: 32, toolCount: 12, tools: [{ name: 'relai_read' }], deprecations: [], compatibilityAliases: {} },
    workspaceCount: 1, workspaceAliases: ['repo']
  }, {
    ok: true, version: '0.24.0', runtime: 'node', toolSurface: { schemaVersion: 5, toolSurfaceVersion: 32, toolCount: 12 },
    workspaceCount: 1, workspaceAliases: ['repo'], work_id: 'work_status'
  }),
  fixture('relai_read', 'relai_read', '', 'relai_read', 'work_read', {
    ok: true, workspace: 'repo', items: [{ type: 'file', path: 'README.md', bytes: 12, content: '# Project\n', cacheHit: false, writeGuidance: { recommendedMode: 'direct-write' } }], skipped: []
  }, {
    ok: true, workspace: 'repo', items: [{ type: 'file', path: 'README.md', bytes: 12, content: '# Project\n' }], work_id: 'work_read'
  }, { guidanceMode: 'none' }),
  fixture('relai_exec', 'relai_exec', '', 'relai_exec', 'work_exec', {
    ok: false, workspace: 'repo', command: 'npm test', commandSummary: 'npm test', cwd: '.', shell: 'PowerShell 7', exitCode: 1,
    durationMs: 120, stdout: 'running', stderr: 'failed', stdoutBytes: 7, stderrBytes: 6, stdoutTruncated: false,
    stderrTruncated: false, timedOut: false, environmentKeys: ['CI'], changedFiles: ['package-lock.json'], changedFilesTruncated: false, mutationTracking: 'git'
  }, {
    ok: false, workspace: 'repo', command: 'npm test', exitCode: 1, durationMs: 120, stdout: 'running', stderr: 'failed', stdoutBytes: 7,
    stderrBytes: 6, environmentKeys: ['CI'], changedFiles: ['package-lock.json'], mutationTracking: 'git', work_id: 'work_exec'
  }),
  fixture('relai_process:read', 'relai_process', 'read', 'relai_process_read', 'work_process', {
    ok: true, processId: 'proc_1', pid: 123, workspace: 'repo', workspaceId: 'repo', label: 'Server', kind: 'service', purpose: 'Serve.',
    commandSummary: 'npm run dev', cwd: '.', status: 'running', metadataRevision: 'rev_1', startedAt: '2026-08-05T00:00:00.000Z',
    stdoutBytes: 10, stderrBytes: 0, stdout: { text: 'ready\n', nextOffset: 10 }, stderr: { text: '', nextOffset: 0 }
  }, {
    ok: true, processId: 'proc_1', pid: 123, workspace: 'repo', label: 'Server', kind: 'service', purpose: 'Serve.', status: 'running',
    metadataRevision: 'rev_1', startedAt: '2026-08-05T00:00:00.000Z', stdoutBytes: 10,
    stdout: { text: 'ready\n', nextOffset: 10 }, stderr: { text: '', nextOffset: 0 }, work_id: 'work_process'
  }),
  fixture('relai_validate:checks', 'relai_validate', 'checks', 'relai_run_checks', 'work_checks', {
    ok: true, workspace: 'repo', level: 'standard', checks: ['npm test'], commands: ['npm test'],
    results: [{ command: 'npm test', ok: true, exitCode: 0, durationMs: 40, stdout: 'noise', stderr: '', stdoutBytes: 5, stderrBytes: 0 }],
    validated: true, validationStatus: 'passed', completionKnown: true, endReason: 'explicit_completion', completionSource: 'relai_run_checks',
    summary: 'Validated.', validationAt: '2026-08-05T00:00:00.000Z', changedFiles: ['src/index.js'], message: 'Validation passed.'
  }, {
    ok: true, workspace: 'repo', level: 'standard', checks: ['npm test'],
    results: [{ command: 'npm test', ok: true, exitCode: 0, durationMs: 40, stdoutBytes: 5 }],
    validated: true, validationStatus: 'passed', completionKnown: true, endReason: 'explicit_completion', completionSource: 'relai_run_checks',
    summary: 'Validated.', validationAt: '2026-08-05T00:00:00.000Z', changedFiles: ['src/index.js'], message: 'Validation passed.', work_id: 'work_checks'
  }),
  fixture('relai_changes:diff', 'relai_changes', 'diff', 'relai_diff', 'work_diff', {
    ok: true, workspace: 'repo', branch: 'main', status: ' M src/index.js\n', changedFiles: ['src/index.js'], untrackedFiles: [],
    statusEntries: [{ path: 'src/index.js' }], staged: false, path: 'src/index.js', diff: 'diff --git a/src/index.js b/src/index.js'
  }, {
    ok: true, workspace: 'repo', branch: 'main', status: ' M src/index.js\n', changedFiles: ['src/index.js'], staged: false,
    path: 'src/index.js', diff: 'diff --git a/src/index.js b/src/index.js', work_id: 'work_diff'
  }),
  fixture('relai_publish:commit', 'relai_publish', 'commit', 'relai_git_commit', 'work_commit', {
    ok: true, workspace: 'repo', commit: 'abc123', message: 'Committed.', changedFiles: []
  }, { ok: true, workspace: 'repo', commit: 'abc123', message: 'Committed.', work_id: 'work_commit' }),
  fixture('relai_publish:push', 'relai_publish', 'push', 'relai_git_push', 'work_push', {
    ok: true, workspace: 'repo', remote: 'origin', branch: 'main', pushed: true
  }, { ok: true, workspace: 'repo', remote: 'origin', branch: 'main', pushed: true, work_id: 'work_push' })
];

for (const item of cases) {
  const before = structuredClone(item.internal);
  const external = serializeConnectorResult({
    publicName: item.publicTool,
    action: item.action,
    operationName: item.operation,
    value: item.internal,
    args: item.args,
    workId: item.workId
  });
  assert.deepEqual(item.internal, before, `${item.name} serialization mutated the internal result`);
  assert.deepEqual(external, item.expected, `${item.name} connector contract changed`);
}
console.log(`${cases.length} internal-to-connector result contracts passed.`);

function fixture(name, publicTool, action, operation, workId, internal, expected, args = {}) {
  return { name, publicTool, action, operation, workId, internal, expected, args };
}
