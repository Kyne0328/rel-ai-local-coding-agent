import assert from 'node:assert/strict';

import { compactForConnector, policySentence } from "../src/tools.js";

const idleStatus = compactForConnector('relai_status', {
  ok: true,
  version: '0.17.1',
  toolSurface: {
    schemaVersion: 1,
    toolSurfaceVersion: 12,
    toolCount: 20,
    tools: [{ name: 'relai_read', state: 'active' }],
    deprecations: [],
    compatibilityAliases: {}
  },
  tools: ['relai_read', 'relai_edit'],
  toolGroups: { workspace: [], git: [], audit: [], cleanup: [], internal: ['relai_set_policy'] },
  scripts: ['start', 'test', 'build', 'lint'],
  ci: { ok: true, files: 2, missing: [] },
  workspace: {
    alias: 'app', root: '/repo', commandKeys: [], testCommandKeys: ['test'],
    policy: { trusted: true, sessionActive: false, baselineDirty: [], source: 'default' },
    repository: {
      ok: true, workspace: 'app', branch: 'main', status: ' M src/app.js\n?? generated.txt\n',
      statusEntries: [{ path: 'src/app.js', owner: 'unknown', raw: ' M src/app.js' }],
      changedFiles: ['src/app.js', 'generated.txt'], untrackedFiles: ['generated.txt'],
      sessionChangedFiles: [], baselineChangedFiles: []
    }
  },
  workspaceCount: 2,
  workspaceAliases: ['app', 'worker']
}, {});
assert.equal(idleStatus.toolGroups, undefined, 'toolGroups must be dropped');
assert.equal(idleStatus.scripts, undefined, 'server scripts must be dropped');
assert.equal(idleStatus.ci, undefined, 'server CI scan must be dropped');
assert.equal(idleStatus.tools, undefined, 'tools list must be dropped');
assert.equal(idleStatus.workspace.policy, undefined, 'raw policy object must be dropped');
assert.equal(idleStatus.workspace.root, undefined, 'connector status must not expose the absolute workspace root');
assert.equal(idleStatus.state, undefined, 'idle workspace must have no state line');
assert.equal(idleStatus.workspace.commandKeys, undefined, 'empty arrays pruned');
assert.deepEqual(idleStatus.workspace.testCommandKeys, ['test']);
assert.equal(idleStatus.workspace.repository.branch, 'main');
assert.equal(idleStatus.workspace.repository.status, ' M src/app.js\n?? generated.txt\n');
assert.deepEqual(idleStatus.workspace.repository.changedFiles, ['src/app.js', 'generated.txt']);
assert.deepEqual(idleStatus.workspace.repository.untrackedFiles, ['generated.txt']);
assert.equal(idleStatus.workspace.repository.statusEntries, undefined, 'nested repository status must drop raw entries');
assert.equal(idleStatus.version, '0.17.1');
assert.equal(idleStatus.toolSurface.toolSurfaceVersion, 12);
assert.equal(idleStatus.toolSurface.toolCount, 20);
assert.deepEqual(idleStatus.toolSurface.deprecations, []);
assert.deepEqual(idleStatus.toolSurface.compatibilityAliases, {});
assert.equal(idleStatus.toolSurface.tools, undefined, 'compact status must not duplicate the full per-tool manifest');
assert.equal(idleStatus.workspaceCount, 2);
assert.deepEqual(idleStatus.workspaceAliases, ['app', 'worker'], 'compact status must retain configured aliases');
console.log('1. idle relai_status compacted: OK');

const activeStatus = compactForConnector('relai_status', {
  ok: true, version: '0.17.1', workspaceCount: 2, workspaceAliases: ['app', 'worker'],
  workspace: {
    alias: 'app', root: '/repo',
    policy: { trusted: true, sessionActive: true, taskHint: 'add login', baselineDirty: ['a.txt'], source: 'session_file' }
  }
}, {});
assert.match(activeStatus.state, /Session active: add login/);
assert.match(activeStatus.state, /1 pre-existing dirty file/);
assert.deepEqual(activeStatus.workspaceAliases, ['app', 'worker']);
console.log('2. active relai_status compacted: OK');

assert.equal(policySentence(null), null);
assert.equal(policySentence({ sessionActive: false }), null);
assert.equal(policySentence({ sessionActive: true }), 'Session active.');
console.log('3. policy sentence: OK');

const checksCompact = compactForConnector('relai_run_checks', {
  ok: true, workspace: 'app', level: 'standard',
  checks: ['npm run check'], commands: ['npm run check'],
  results: [{ command: 'npm run check', ok: true, exitCode: 0, durationMs: 50, stdout: 'success noise', stderr: '', stdoutBytes: 13, stderrBytes: 0 }],
  validationLevel: 'focused', validationLevelReason: 'single source file',
  changedFiles: ['x.js'], policy: { trusted: true, sessionActive: false, baselineDirty: [], source: 'default' }
}, {});
assert.equal(checksCompact.commands, undefined, 'duplicate commands array dropped');
assert.equal(checksCompact.validationLevel, undefined, 'internal telemetry dropped');
assert.equal(checksCompact.changedFiles, undefined, 'changedFiles telemetry dropped');
assert.equal(checksCompact.policy, undefined, 'default policy dropped');
assert.deepEqual(checksCompact.checks, ['npm run check']);
assert.equal(checksCompact.results[0].stdout, undefined, 'successful check output must be omitted');
assert.equal(checksCompact.results[0].durationMs, 50);
const failedChecksCompact = compactForConnector('relai_run_checks', {
  ok: false,
  results: [{ command: 'npm test', ok: false, exitCode: 1, stderr: 'failure details', stderrBytes: 15 }]
}, {});
assert.equal(failedChecksCompact.results[0].stderr, 'failure details', 'failed check diagnostics must remain actionable');
const completedChecksCompact = compactForConnector('relai_run_checks', {
  ok: true, workspace: 'app', level: 'standard', checks: ['npm test'], results: [{ command: 'npm test', ok: true }],
  validated: true, validationStatus: 'passed', completionKnown: true, endReason: 'explicit_completion',
  completionSource: 'relai_run_checks', summary: 'Validated and completed.', validationAt: '2026-07-26T08:00:00.000Z',
  changedFiles: ['src/app.js'],
  message: 'Validation passed and task completion was accepted.', nextAction: 'No more calls.'
}, {});
assert.equal(completedChecksCompact.completionKnown, true);
assert.equal(completedChecksCompact.completionSource, 'relai_run_checks');
assert.equal(completedChecksCompact.summary, 'Validated and completed.');
assert.deepEqual(completedChecksCompact.changedFiles, ['src/app.js']);
console.log('4. relai_run_checks compacted: OK');

const execCompact = compactForConnector('relai_exec', {
  ok: false,
  workspace: 'app',
  command: 'npm test',
  commandSummary: 'npm test',
  cwd: '.',
  shell: 'PowerShell 7',
  exitCode: 2,
  durationMs: 500,
  stdout: 'test output',
  stderr: 'test failed',
  stdoutBytes: 11,
  stderrBytes: 11,
  stdoutTruncated: false,
  stderrTruncated: false,
  timedOut: false,
  environmentKeys: ['CI'],
  changedFiles: ['package-lock.json'],
  changedFilesTruncated: false,
  mutationTracking: 'git'
}, {});
assert.equal(execCompact.commandSummary, undefined, 'audit-only command summary must stay internal');
assert.equal(execCompact.exitCode, 2);
assert.equal(execCompact.stderr, 'test failed');
assert.deepEqual(execCompact.changedFiles, ['package-lock.json']);
assert.deepEqual(execCompact.environmentKeys, ['CI']);
const execSuccessCompact = compactForConnector('relai_exec', {
  ok: true,
  workspace: 'app',
  command: 'node --check src/index.js',
  cwd: '.',
  shell: 'PowerShell 7',
  exitCode: 0,
  durationMs: 40,
  stdout: '',
  stderr: '',
  stdoutBytes: 0,
  stderrBytes: 0,
  stdoutTruncated: false,
  stderrTruncated: false,
  timedOut: false,
  changedFiles: [],
  changedFilesTruncated: false,
  mutationTracking: 'git'
}, {});
assert.equal(execSuccessCompact.cwd, undefined);
assert.equal(execSuccessCompact.shell, undefined);
assert.equal(execSuccessCompact.stdout, undefined);
assert.equal(execSuccessCompact.changedFiles, undefined);
assert.ok(Buffer.byteLength(JSON.stringify(execSuccessCompact)) < 1000);
console.log('5. relai_exec compacted: OK');

const snapshotCompact = compactForConnector('relai_repo_snapshot', {
  ok: true, workspace: 'app', root: '/repo',
  toolMode: 'chatgpt_local_repo', trustedLocalAgent: true,
  flow: { mode: 'standard', prepared: {} },
  manifests: ['package.json'],
  manifestContents: { 'package.json': '{"a":1}'.repeat(500) },
  discoveredCommands: { test: 'npm test' },
  projectInstructions: { sources: ['REL_AI.md'], content: 'Follow the repository rules.', truncated: false },
  fileCount: 10, files: ['a.js'], hints: ['Node'],
  effectiveMaxEntries: 1000, budgetMultiplied: false,
  recommendedFlow: ['relai_read'],
  operationJournal: { path: '/state/journal', recent: [] },
  writeGuidance: { flow: {}, modes: {} },
  skipped: [{ path: 'x.bin', reason: 'binary-looking file' }],
  git: { branch: 'main', aheadBehind: { ahead: 0, behind: 0 }, dirtyFiles: 1, changedFiles: ['src/app.js'] },
}, {});
assert.equal(snapshotCompact.manifestContents, undefined, 'manifest full text dropped');
assert.equal(snapshotCompact.root, undefined, 'connector snapshot must not expose the absolute workspace root');
assert.equal(snapshotCompact.toolMode, undefined, 'config constant dropped');
assert.equal(snapshotCompact.trustedLocalAgent, undefined, 'config constant dropped');
assert.equal(snapshotCompact.flow, undefined, 'prepared-workflow internals dropped');
assert.equal(snapshotCompact.operationJournal, undefined, 'journal dropped');
assert.equal(snapshotCompact.writeGuidance, undefined, 'static guidance blob dropped');
assert.deepEqual(snapshotCompact.manifests, ['package.json'], 'manifest names kept');
assert.deepEqual(snapshotCompact.hints, ['Node']);
assert.deepEqual(snapshotCompact.projectInstructions, { sources: ['REL_AI.md'], content: 'Follow the repository rules.', truncated: false });
assert.equal(snapshotCompact.skipped, undefined, 'skipped entry list dropped on connector');
assert.equal(snapshotCompact.skippedCount, 1, 'skipped list replaced by a count');
assert.deepEqual(snapshotCompact.git, { branch: 'main', aheadBehind: { ahead: 0, behind: 0 }, dirtyFiles: 1, changedFiles: ['src/app.js'] }, 'git summary passes through compaction');
const largeSnapshot = compactForConnector('relai_repo_snapshot', {
  ok: true,
  workspace: 'app',
  fileCount: 2000,
  files: Array.from({ length: 2000 }, (_, index) => `src/generated/path-${String(index).padStart(4, '0')}.js`)
}, {});
assert.equal(largeSnapshot.truncated, true);
assert.ok(largeSnapshot.omittedFiles > 0);
assert.ok(Buffer.byteLength(JSON.stringify(largeSnapshot)) < 16000);
console.log('6. repo snapshot compacted: OK');

const readCompact = compactForConnector('relai_read', {
  ok: true, workspace: 'app',
  items: [
    { type: 'file', path: 'small.js', bytes: 40, content: 'export const x = 1;', cacheHit: false,
      writeGuidance: { recommendedMode: 'direct-write', reasons: ['normal-sized file'], localizedEdit: {}, multiFileChange: {} } },
    { type: 'file', path: 'big.dart', bytes: 90000, content: '...',
      writeGuidance: { recommendedMode: 'exact-replace', reasons: ['file is 90000 bytes'], wholeFileReplacement: {}, multiFileChange: {} } }
  ],
  skipped: []
}, {});
assert.equal(readCompact.items[0].writeGuidance, undefined, 'nested guidance dropped');
assert.equal(readCompact.items[0].cacheHit, undefined, 'cacheHit debug field dropped');
assert.equal(readCompact.items[0].writeHint, undefined, 'normal file gets no hint');
assert.equal(readCompact.items[1].writeGuidance, undefined, 'nested guidance dropped on large file');
assert.match(readCompact.items[1].writeHint, /oldText\/newText/, 'large file gets a compact hint');
assert.equal(readCompact.items[1].content, '...', 'file content preserved');

const fullRead = compactForConnector('relai_read', {
  ok: true,
  items: [{ path: 'big.dart', cacheHit: true, writeGuidance: { recommendedMode: 'exact-replace' } }]
}, { guidanceMode: 'full' });
assert.equal(fullRead.items[0].cacheHit, undefined, 'cache metadata stays hidden in full guidance mode');
assert.deepEqual(fullRead.items[0].writeGuidance, { recommendedMode: 'exact-replace' });
console.log('7. relai_read compacted: OK');

const processList = compactForConnector('relai_process_list', {
  ok: true,
  count: 1,
  processes: [{
    ok: true,
    processId: 'proc_example',
    pid: 100,
    workspace: 'app',
    workspaceId: 'app',
    label: 'Development server',
    kind: 'service',
    purpose: 'Serve the frontend.',
    commandSummary: 'npm run dev',
    cwd: '.',
    status: 'running',
    lifecycle: 'persistent',
    metadataRevision: 'revision12345678',
    startedAt: '2026-08-02T00:00:00.000Z',
    stdoutBytes: 10,
    stderrBytes: 0,
    environmentKeys: []
  }]
}, {});
assert.equal(processList.processes[0].commandSummary, undefined);
assert.equal(processList.processes[0].workspaceId, undefined);
assert.equal(processList.processes[0].kind, 'service');
const processDelta = compactForConnector('relai_process_read', {
  ok: true,
  processId: 'proc_example',
  status: 'running',
  metadataRevision: 'revision12345678',
  stdout: { text: '', nextOffset: 10 },
  stderr: { text: '', nextOffset: 0 }
}, {});
assert.ok(Buffer.byteLength(JSON.stringify(processDelta)) < 500);
console.log('8. process results compacted: OK');

console.log('connector compaction unit tests passed.');
