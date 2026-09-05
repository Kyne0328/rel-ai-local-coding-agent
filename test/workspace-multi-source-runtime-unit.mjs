import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { repoSnapshot, relaiReadAsync } from '../src/localRepoBridge.js';
import { relaiSearch } from '../src/bridge/search.js';
import { repositoryQueryWorkerStats } from '../src/repository/intelligence/queryWorkerClient.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';
import { repositoryIndexPath } from '../src/repository/intelligence/database.js';
import { sourceWorkspace, workspaceSourceEntries } from '../src/workspaceSources.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-multi-source-'));
const primary = path.join(root, 'primary');
const secondary = path.join(root, 'secondary');
const stateDir = path.join(root, 'state');
fs.mkdirSync(path.join(primary, 'src'), { recursive: true });
fs.mkdirSync(path.join(secondary, 'src'), { recursive: true });
fs.writeFileSync(path.join(primary, 'src', 'primary.js'), "export const primaryMarker = 'primary-only-marker';\n");
fs.writeFileSync(path.join(secondary, 'src', 'secondary.js'), [
  "export function secondaryMarker() {",
  "  return 'secondary-only-marker connection recovery';",
  "}",
  ''
].join('\n'));

const workspace = {
  alias: 'multi-source',
  path: primary,
  sourcePaths: [primary, secondary],
  context: {},
  commands: {},
  testCommands: {}
};
const config = { stateDir };

try {
  const snapshot = await repoSnapshot(workspace, config, { includeFiles: true });
  assert.ok(snapshot.files.includes('src/primary.js'));
  assert.ok(snapshot.files.includes('source:2/src/secondary.js'), 'snapshot must expose secondary roots with an unambiguous virtual prefix');

  const read = await relaiReadAsync(workspace, config, {
    paths: ['source:2/src/secondary.js'], guidanceMode: 'compact'
  }, { connector: true });
  assert.equal(read.ok, true);
  assert.equal(read.items[0].path, 'source:2/src/secondary.js');
  assert.match(read.items[0].content, /secondary-only-marker/);
  assert.match(read.items[0].writeHint, /read-only context/i);

  const directory = await relaiReadAsync(workspace, config, {
    paths: ['source:2'], guidanceMode: 'none'
  }, { connector: true });
  assert.equal(directory.items[0].type, 'directory');
  assert.ok(directory.items[0].files.includes('source:2/src/secondary.js'));

  const lexical = await relaiSearch(workspace, config, {
    pattern: 'secondary-only-marker', fixed: true, mode: 'context', maxResults: 10
  });
  assert.equal(lexical.matchCount, 1);
  assert.equal(lexical.matches[0].path, 'source:2/src/secondary.js');
  assert.equal(lexical.files[0].path, 'source:2/src/secondary.js');

  const semantic = await repositoryIntelligence.semanticSearch(workspace, config, {
    query: 'secondary connection recovery marker', maxResults: 10, maxBytes: 32000
  }, { watch: false });
  assert.ok(semantic.results.some(item => item.path === 'source:2/src/secondary.js'),
    'semantic search must fan out across attached source roots');
  assert.equal(Array.isArray(semantic.retrieval?.sources), true,
    'multi-source semantic search must preserve per-source retrieval degradation metadata');
  assert.ok(repositoryQueryWorkerStats().liveWorkerCount <= 4,
    'attached source roots must share the global query worker budget');

  const symbol = await repositoryIntelligence.codeInspect(workspace, config, {
    action: 'symbol', symbol: 'secondaryMarker', maxResults: 20
  }, { watch: false });
  assert.ok(symbol.definitions.some(item => item.path === 'source:2/src/secondary.js'),
    'structural symbol lookup must retain the secondary source identity');

  const architecture = await repositoryIntelligence.architecture(workspace, config, { maxResults: 20 }, { watch: false });
  assert.equal(architecture.architecture.strategy, 'multi-source-bounded-file-graph');
  assert.ok(architecture.entryPoints.every(item => !path.isAbsolute(item.path)), 'multi-source architecture must return virtual repository paths, not host paths');

  const sourceWorkspaces = workspaceSourceEntries(workspace).map(source => sourceWorkspace(workspace, source));
  for (const scopedWorkspace of sourceWorkspaces) {
    await repositoryIntelligence.ensure(scopedWorkspace, config);
    assert.equal(repositoryIntelligence.status(scopedWorkspace, config).watching, true,
      'attached source roots must have a live watcher after normal intelligence startup');
    assert.equal(fs.existsSync(path.dirname(repositoryIndexPath(config, scopedWorkspace))), true);
  }
  const disposed = await repositoryIntelligence.dispose(workspace, config, { removeCache: true });
  assert.equal(disposed.ok, true);
  for (const scopedWorkspace of sourceWorkspaces) {
    assert.equal(repositoryIntelligence.status(scopedWorkspace, config).watching, false,
      'workspace disposal must detach every source-root watcher');
    assert.equal(fs.existsSync(path.dirname(repositoryIndexPath(config, scopedWorkspace))), false,
      'delete-style disposal must remove the source-root intelligence cache');
  }
} finally {
  await repositoryIntelligence.shutdown();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

console.log('Multi-source snapshot, read, lexical search, semantic search, structural inspect, and architecture paths passed.');
