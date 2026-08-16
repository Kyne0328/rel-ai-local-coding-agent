import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runRepositoryQuery } from '../src/repository/intelligence/queryWorkerClient.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-query-generation-'));
const workspaceRoot = path.join(root, 'workspace');
const stateDir = path.join(root, 'state');
fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(workspaceRoot, 'src', 'alpha.js'), 'export function alpha() { return 1; }\n');

const workspace = { alias: 'query-generation', path: workspaceRoot, context: {}, testCommands: {}, commands: {} };
const config = { stateDir };

try {
  const initial = await repositoryIntelligence.ensure(workspace, config, { force: true, watch: false });
  fs.writeFileSync(path.join(workspaceRoot, 'src', 'alpha.js'), 'export function alpha() { return 2; }\n');
  const rebuilt = await repositoryIntelligence.rebuild(workspace, config, { watch: false });
  assert.ok(rebuilt.generation > initial.generation);

  await assert.rejects(
    runRepositoryQuery('semanticSearch', workspace, config, {
      args: { query: 'alpha', maxResults: 5 },
      index: initial
    }, { watch: false }),
    error => error?.code === 'QUERY_INDEX_CHANGED',
    'query workers must reject metadata from an older generation instead of mixing it with newer SQLite facts'
  );

  const current = await repositoryIntelligence.semanticSearch(workspace, config, { query: 'alpha', maxResults: 5 }, { watch: false });
  assert.equal(current.fingerprint, rebuilt.fingerprint);
  assert.ok(current.results.some(item => item.path === 'src/alpha.js'));
} finally {
  await repositoryIntelligence.shutdown();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

console.log('Repository Intelligence query generation snapshot consistency test passed.');
