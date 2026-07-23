import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MAX_PROJECT_INSTRUCTION_BYTES,
  readProjectInstructions,
  resetProjectInstructionCacheForTests
} = require('../src/projectInstructions.js');
const { repoSnapshot, relaiRead } = require('../src/localRepoBridge.js');
const { workspaceInspect } = require('../src/tools/status.js');
const { compactForConnector } = require('../src/tools/connector.js');
const { publicConfigSummary } = require('../src/config.js');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-project-instructions-'));
const repo = path.join(temp, 'repo');
const stateDir = path.join(temp, 'state');
const workspace = { alias: 'app', path: repo, context: {}, commands: {}, testCommands: {} };
const config = {
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: { app: workspace },
  productUx: {},
  release: {},
  patch: {}
};

fs.mkdirSync(repo, { recursive: true });

try {
  resetProjectInstructionCacheForTests();
  const empty = readProjectInstructions(workspace);
  assert.deepEqual(empty.sources, []);
  assert.equal(empty.content, '');
  assert.equal(empty.truncated, false);

  fs.writeFileSync(path.join(repo, 'REL_AI.md'), 'Root architecture rule.\n', 'utf8');
  resetProjectInstructionCacheForTests();
  const rootOnly = readProjectInstructions(workspace);
  assert.deepEqual(rootOnly.sources, ['REL_AI.md']);
  assert.match(rootOnly.content, /^## REL_AI\.md/m);
  assert.match(rootOnly.content, /Root architecture rule/);

  fs.mkdirSync(path.join(repo, '.relai'), { recursive: true });
  fs.rmSync(path.join(repo, 'REL_AI.md'));
  fs.writeFileSync(path.join(repo, '.relai', 'instructions.md'), 'Nested-only rule.\n', 'utf8');
  const nestedOnly = readProjectInstructions(workspace);
  assert.deepEqual(nestedOnly.sources, ['.relai/instructions.md']);
  assert.match(nestedOnly.content, /Nested-only rule/);

  fs.writeFileSync(path.join(repo, 'REL_AI.md'), 'Root architecture rule.\n', 'utf8');
  fs.writeFileSync(path.join(repo, '.relai', 'instructions.md'), 'Nested style rule.\n', 'utf8');
  const both = readProjectInstructions(workspace);
  assert.deepEqual(both.sources, ['REL_AI.md', '.relai/instructions.md']);
  assert.ok(both.content.indexOf('Root architecture rule') < both.content.indexOf('Nested style rule'));
  assert.match(both.precedence, /Earlier sources override later sources/);

  const directRead = relaiRead(workspace, config, { paths: ['.relai/instructions.md'] });
  assert.match(directRead.items[0].content, /Nested style rule/, 'the explicit .relai instruction file must remain directly readable');

  const cachedFirst = readProjectInstructions(workspace);
  fs.writeFileSync(path.join(repo, 'REL_AI.md'), 'Fresh architecture rule.\n', 'utf8');
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(path.join(repo, 'REL_AI.md'), future, future);
  const refreshed = readProjectInstructions(workspace);
  assert.match(cachedFirst.content, /Root architecture rule/);
  assert.match(refreshed.content, /Fresh architecture rule/, 'mtime/size signature changes must invalidate the instruction cache');

  fs.writeFileSync(path.join(repo, '.relai', 'instructions.md'), Buffer.from([0, 1, 2, 3]));
  const binaryRejected = readProjectInstructions(workspace);
  assert.deepEqual(binaryRejected.sources, ['REL_AI.md']);
  assert.deepEqual(binaryRejected.rejectedSources, [{ path: '.relai/instructions.md', reason: 'binary-looking instruction file' }]);

  fs.writeFileSync(path.join(repo, 'REL_AI.md'), '🙂'.repeat(20000), 'utf8');
  fs.rmSync(path.join(repo, '.relai', 'instructions.md'), { force: true });
  const truncated = readProjectInstructions(workspace);
  assert.equal(truncated.truncated, true);
  assert.ok(truncated.totalBytes > MAX_PROJECT_INSTRUCTION_BYTES);
  assert.ok(Buffer.byteLength(truncated.content, 'utf8') <= MAX_PROJECT_INSTRUCTION_BYTES);
  assert.doesNotMatch(truncated.content, /\uFFFD/, 'UTF-8 truncation must not return a partial replacement character');
  const smaller = readProjectInstructions(workspace, { maxBytes: 1024 });
  assert.ok(Buffer.byteLength(smaller.content, 'utf8') <= 1024, 'cache entries must respect the requested payload limit');

  fs.writeFileSync(path.join(repo, 'REL_AI.md'), 'Snapshot instruction.\n', 'utf8');
  fs.writeFileSync(path.join(repo, '.relai', 'instructions.md'), 'Inspect instruction.\n', 'utf8');
  resetProjectInstructionCacheForTests();
  const snapshot = await repoSnapshot(workspace, config, { includeFiles: false });
  assert.deepEqual(snapshot.projectInstructions.sources, ['REL_AI.md', '.relai/instructions.md']);
  assert.match(snapshot.projectInstructions.content, /Snapshot instruction/);

  const compact = compactForConnector('relai_repo_snapshot', snapshot, {});
  assert.deepEqual(compact.projectInstructions, snapshot.projectInstructions, 'connector compaction must retain project instructions');

  const inspect = workspaceInspect(config, { workspace: 'app', maxEntries: 10 });
  assert.equal(inspect.ok, true);
  assert.match(inspect.projectInstructions.content, /Inspect instruction/);

  const summary = publicConfigSummary(config).workspaces[0].projectInstructions;
  assert.deepEqual(summary.sources, ['REL_AI.md', '.relai/instructions.md']);
  assert.equal(summary.configured, true);
  assert.equal(Object.hasOwn(summary, 'content'), false, 'dashboard/config summaries must not include full instruction content');

  console.log('Project instruction loading tests passed.');
} finally {
  resetProjectInstructionCacheForTests();
  fs.rmSync(temp, { recursive: true, force: true });
}
