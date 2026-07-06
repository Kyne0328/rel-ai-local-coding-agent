import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compactForConnector, policySentence } = require('../src/tools.js');

// 1. relai_status drops internal tool groups, server scripts/CI, and the raw
//    default policy object; an idle (no-session) workspace yields no `state` line.
{
  const full = {
    ok: true,
    version: '0.17.1',
    tools: ['relai_read', 'relai_edit'],
    toolGroups: { workspace: [], git: [], audit: [], cleanup: [], internal: ['relai_set_policy'] },
    scripts: ['start', 'test', 'build', 'lint'],
    ci: { ok: true, files: 2, missing: [] },
    workspace: {
      alias: 'app', root: '/repo', commandKeys: [], testCommandKeys: ['test'],
      policy: { trusted: true, sessionActive: false, baselineDirty: [], source: 'default' }
    },
    workspaceCount: 1
  };
  const compact = compactForConnector('relai_status', full, {});
  assert.equal(compact.toolGroups, undefined, 'toolGroups must be dropped');
  assert.equal(compact.scripts, undefined, 'server scripts must be dropped');
  assert.equal(compact.ci, undefined, 'server CI scan must be dropped');
  assert.equal(compact.tools, undefined, 'tools list must be dropped');
  assert.equal(compact.workspace.policy, undefined, 'raw policy object must be dropped');
  assert.equal(compact.state, undefined, 'idle workspace must have no state line');
  assert.equal(compact.workspace.commandKeys, undefined, 'empty arrays pruned');
  assert.deepEqual(compact.workspace.testCommandKeys, ['test']);
  assert.equal(compact.version, '0.17.1');
}

// 2. Active session renders as a single actionable line, including baseline note.
{
  const full = {
    ok: true, version: '0.17.1', workspaceCount: 1,
    workspace: {
      alias: 'app', root: '/repo',
      policy: { trusted: true, sessionActive: true, taskHint: 'add login', baselineDirty: ['a.txt'], source: 'session_file' }
    }
  };
  const compact = compactForConnector('relai_status', full, {});
  assert.match(compact.state, /Session active: add login/);
  assert.match(compact.state, /1 pre-existing dirty file/);
}

// 3. policySentence returns null for idle/default and missing policy.
{
  assert.equal(policySentence(null), null);
  assert.equal(policySentence({ sessionActive: false }), null);
  assert.equal(policySentence({ sessionActive: true }), 'Session active.');
}

// 4. relai_run_checks drops the duplicated commands array and internal telemetry.
{
  const full = {
    ok: true, workspace: 'app', level: 'standard',
    checks: ['npm run check'], commands: ['npm run check'],
    results: [{ command: 'npm run check', ok: true }],
    validationLevel: 'focused', validationLevelReason: 'single source file',
    changedFiles: ['x.js'], policy: { trusted: true, sessionActive: false, baselineDirty: [], source: 'default' }
  };
  const compact = compactForConnector('relai_run_checks', full, {});
  assert.equal(compact.commands, undefined, 'duplicate commands array dropped');
  assert.equal(compact.validationLevel, undefined, 'internal telemetry dropped');
  assert.equal(compact.changedFiles, undefined, 'changedFiles telemetry dropped');
  assert.equal(compact.policy, undefined, 'default policy dropped');
  assert.deepEqual(compact.checks, ['npm run check']);
}

// 5. relai_git_status without a baseline split drops the ownership arrays and raw
//    per-entry lines; keeps branch/status.
{
  const full = {
    ok: true, workspace: 'app', branch: 'main', aheadBehind: null,
    status: ' M a.txt\n?? b.txt\n',
    statusEntries: [{ path: 'a.txt', owner: 'unknown', raw: ' M a.txt' }],
    sessionChangedFiles: [], baselineChangedFiles: [],
    untrackedSessionFiles: [], untrackedBaselineFiles: []
  };
  const compact = compactForConnector('relai_git_status', full, {});
  assert.equal(compact.statusEntries, undefined, 'raw status entries dropped');
  assert.equal(compact.sessionChangedFiles, undefined, 'empty ownership split dropped');
  assert.equal(compact.baselineChangedFiles, undefined);
  assert.equal(compact.branch, 'main');
  assert.equal(compact.status, ' M a.txt\n?? b.txt\n');
}

// 6. relai_git_status WITH a real baseline split keeps both ownership arrays.
{
  const full = {
    ok: true, workspace: 'app', branch: 'main',
    status: ' M a.txt\n M b.txt\n',
    statusEntries: [],
    sessionChangedFiles: ['a.txt'], baselineChangedFiles: ['b.txt']
  };
  const compact = compactForConnector('relai_git_status', full, {});
  assert.deepEqual(compact.sessionChangedFiles, ['a.txt']);
  assert.deepEqual(compact.baselineChangedFiles, ['b.txt']);
}

// 7. relai_repo_snapshot drops manifest full-text, constants, flow, and journal.
{
  const full = {
    ok: true, workspace: 'app', root: '/repo',
    toolMode: 'chatgpt_local_repo', trustedLocalAgent: true,
    flow: { mode: 'standard', prepared: {} },
    manifests: ['package.json'],
    manifestContents: { 'package.json': '{"a":1}'.repeat(500) },
    discoveredCommands: { test: 'npm test' },
    fileCount: 10, files: ['a.js'], hints: ['Node'],
    effectiveMaxEntries: 1000, budgetMultiplied: false,
    recommendedFlow: ['relai_read'],
    operationJournal: { path: '/state/journal', recent: [] },
    writeGuidance: { flow: {}, modes: {} }
  };
  const compact = compactForConnector('relai_repo_snapshot', full, {});
  assert.equal(compact.manifestContents, undefined, 'manifest full text dropped');
  assert.equal(compact.toolMode, undefined, 'config constant dropped');
  assert.equal(compact.trustedLocalAgent, undefined, 'config constant dropped');
  assert.equal(compact.flow, undefined, 'prepared-workflow internals dropped');
  assert.equal(compact.operationJournal, undefined, 'journal dropped');
  assert.equal(compact.writeGuidance, undefined, 'static guidance blob dropped');
  assert.deepEqual(compact.manifests, ['package.json'], 'manifest names kept');
  assert.deepEqual(compact.hints, ['Node']);
}

// 8. relai_read strips the nested writeGuidance object; a normal file gets no
//    hint, a large/interpolation file gets a single writeHint string.
{
  const full = {
    ok: true, workspace: 'app',
    items: [
      { type: 'file', path: 'small.js', bytes: 40, content: 'export const x = 1;', cacheHit: false,
        writeGuidance: { recommendedMode: 'direct-write', reasons: ['normal-sized file'], localizedEdit: {}, multiFileChange: {} } },
      { type: 'file', path: 'big.dart', bytes: 90000, content: '...',
        writeGuidance: { recommendedMode: 'exact-replace', reasons: ['file is 90000 bytes'], wholeFileReplacement: {}, multiFileChange: {} } }
    ],
    skipped: []
  };
  const compact = compactForConnector('relai_read', full, {});
  assert.equal(compact.items[0].writeGuidance, undefined, 'nested guidance dropped');
  assert.equal(compact.items[0].cacheHit, undefined, 'cacheHit debug field dropped');
  assert.equal(compact.items[0].writeHint, undefined, 'normal file gets no hint');
  assert.equal(compact.items[1].writeGuidance, undefined, 'nested guidance dropped on large file');
  assert.match(compact.items[1].writeHint, /oldText\/newText/, 'large file gets a compact hint');
  assert.equal(compact.items[1].content, '...', 'file content preserved');
}

console.log('connector compaction unit tests passed.');
