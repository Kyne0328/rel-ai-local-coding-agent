import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { relaiSemanticSearch, SEMANTIC_SEARCH_TOTAL_TIMEOUT_MS } from '../src/bridge/semanticSearch.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-semantic-deadline-'));
const workspaceRoot = path.join(root, 'workspace');
const stateDir = path.join(root, 'state');
fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
for (let index = 0; index < 20; index += 1) {
  fs.writeFileSync(path.join(workspaceRoot, 'src', `module-${index}.js`), `export const semanticDeadlineMarker${index} = ${index};\n`);
}

const workspace = { alias: 'semantic-deadline', path: workspaceRoot, context: {}, testCommands: {}, commands: {} };
const config = { stateDir };

assert.equal(SEMANTIC_SEARCH_TOTAL_TIMEOUT_MS, 30_000,
  'normal semantic search must have one end-to-end 30 second deadline');

try {
  await assert.rejects(
    relaiSemanticSearch(workspace, config, { query: 'semantic deadline marker', maxResults: 5 }, {
      watch: false,
      semanticTimeoutMs: 1
    }),
    error => error?.code === 'QUERY_TIMEOUT' && /index readiness and query execution/.test(error.message),
    'the semantic deadline must include index readiness rather than starting only after indexing finishes'
  );
  await waitForIdle();

  const recovered = await relaiSemanticSearch(workspace, config, {
    query: 'semantic deadline marker',
    maxResults: 5
  }, {
    watch: false,
    semanticTimeoutMs: 10_000
  });
  assert.equal(recovered.ok, true);
  assert.ok(recovered.results.length > 0, 'semantic search must recover normally after a deadline cancellation');
} finally {
  await repositoryIntelligence.shutdown();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

async function waitForIdle() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!repositoryIntelligence.status(workspace, config).active) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Repository Intelligence did not settle after semantic search deadline cancellation.');
}

console.log('Semantic search end-to-end deadline and recovery tests passed.');
