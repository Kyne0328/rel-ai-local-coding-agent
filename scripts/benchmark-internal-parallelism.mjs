import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';

import { relaiSearch } from '../src/bridge/search.js';
import { relaiSemanticSearch } from '../src/bridge/semanticSearch.js';
import { relaiVerify } from '../src/bridge/validation.js';
import { planEdit } from '../src/executionPlanner.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';
import { buildCheckCatalog } from '../src/workflow/checkCatalog.js';
import { discoverRepositoryTopology } from '../src/workflow/topology.js';

function round(value) {
  return Math.round(value * 10) / 10;
}

async function timed(run) {
  const started = performance.now();
  const value = await run();
  return { wallMs: round(performance.now() - started), value };
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function initializeRepo(root) {
  git(root, ['init']);
  git(root, ['config', 'user.email', 'benchmark@example.com']);
  git(root, ['config', 'user.name', 'Rel.AI Benchmark']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'benchmark fixture']);
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-internal-parallelism-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'relai-internal-parallelism-fixture',
    private: true,
    scripts: {
      lint: 'node -e "setTimeout(() => process.exit(0), 140)"',
      typecheck: 'node -e "setTimeout(() => process.exit(0), 140)"'
    }
  }, null, 2));
  for (let index = 1; index <= 4; index += 1) {
    fs.writeFileSync(path.join(root, 'src', `feature-${index}.js`), `export const feature${index} = 'benchmarkTerm${index} sharedFeature';\n`);
  }
  initializeRepo(root);
  return root;
}

function createEditFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-edit-integrity-benchmark-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'relai-edit-integrity-fixture',
    private: true,
    scripts: {
      lint: 'node -e "setTimeout(() => require(\'fs\').appendFileSync(\'generated.txt\', \'validated\\n\'), 80)"'
    }
  }, null, 2));
  fs.writeFileSync(path.join(root, 'app.js'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(root, 'generated.txt'), 'baseline\n');
  initializeRepo(root);
  return root;
}

const root = createFixture();
const editRoot = createEditFixture();
const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-internal-parallelism-state-'));
const workspace = { alias: 'benchmark', path: root, context: {}, commands: {}, testCommands: {} };
const config = { stateDir: stateRoot };

try {
  const lexicalTerms = ['benchmarkTerm1', 'benchmarkTerm2', 'benchmarkTerm3', 'benchmarkTerm4'];
  const lexicalSerial = await timed(async () => {
    for (const pattern of lexicalTerms) await relaiSearch(workspace, config, { pattern, fixed: true, mode: 'compact', maxResults: 1 });
  });
  const lexicalBatch = await timed(() => relaiSearch(workspace, config, {
    queries: lexicalTerms,
    fixed: true,
    mode: 'compact',
    maxResults: 4
  }));

  await relaiSemanticSearch(workspace, config, { query: 'warm repository index', maxResults: 2 }, { watch: false });
  const semanticTerms = ['shared feature one', 'shared feature two'];
  const semanticSerial = await timed(async () => {
    for (const query of semanticTerms) {
      await relaiSemanticSearch(workspace, config, { query, maxResults: 3, maxBytes: 6000 }, { watch: false });
    }
  });
  const semanticBatch = await timed(() => relaiSemanticSearch(workspace, config, {
    queries: semanticTerms,
    maxResults: 6,
    maxBytes: 12000
  }, { watch: false }));
  assert.equal(semanticBatch.value.execution.maxConcurrentSteps, 2,
    'semantic batch metrics must match the bounded repository query read pool');

  const catalog = buildCheckCatalog(discoverRepositoryTopology(root));
  const lint = catalog.find(item => item.id.endsWith(':lint'));
  const typecheck = catalog.find(item => item.id.endsWith(':typecheck'));
  assert.ok(lint && typecheck);
  const validationSerial = await timed(async () => {
    await relaiVerify(workspace, config, { checks: [lint.id], timeoutMs: 10000 });
    await relaiVerify(workspace, config, { checks: [typecheck.id], timeoutMs: 10000 });
  });
  const validationBatch = await timed(() => relaiVerify(workspace, config, {
    checks: [lint.id, typecheck.id],
    timeoutMs: 10000
  }));
  assert.equal(validationBatch.value.execution.maxConcurrentSteps, 2,
    'the integration benchmark must exercise actual parallel validation subprocesses');

  const editWorkspace = { alias: 'edit-benchmark', path: editRoot, context: {}, commands: {}, testCommands: {} };
  const editPostActions = await timed(() => planEdit(editWorkspace, { stateDir: path.join(stateRoot, 'edit') }, {
    path: 'app.js',
    oldText: 'value = 1',
    newText: 'value = 2',
    runChecks: true,
    returnDiff: true
  }));
  const finalDiff = git(editRoot, ['diff', '--', 'app.js', 'generated.txt']).trim();
  const returnedDiff = String(editPostActions.value.diff?.diff || '').trim();
  assert.equal(editPostActions.value.execution.mode, 'serial');
  assert.equal(returnedDiff, finalDiff, 'edit benchmark must prove diff capture reflects validation side effects');

  const payload = {
    benchmark: 'internal-parallelism-integration',
    purpose: 'Measure real Rel.AI one-call fan-out paths and verify execution metrics describe the underlying execution model.',
    scenarios: {
      lexicalSearch: {
        serialWallMs: lexicalSerial.wallMs,
        batchWallMs: lexicalBatch.wallMs,
        wallDeltaMs: round(lexicalSerial.wallMs - lexicalBatch.wallMs),
        execution: lexicalBatch.value.execution
      },
      semanticSearch: {
        serialWallMs: semanticSerial.wallMs,
        batchWallMs: semanticBatch.wallMs,
        wallDeltaMs: round(semanticSerial.wallMs - semanticBatch.wallMs),
        execution: semanticBatch.value.execution,
        workerModel: 'two-reader-pool-per-repository'
      },
      validation: {
        serialWallMs: validationSerial.wallMs,
        batchWallMs: validationBatch.wallMs,
        wallDeltaMs: round(validationSerial.wallMs - validationBatch.wallMs),
        execution: validationBatch.value.execution
      },
      editPostActions: {
        wallMs: editPostActions.wallMs,
        mode: editPostActions.value.execution.mode,
        finalDiffMatches: returnedDiff === finalDiff
      }
    }
  };

  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    console.log('Internal parallelism integration benchmark');
    console.log('ChatGPT Web target: one MCP call -> bounded internal work -> one truthful result.');
    console.log(`Lexical search: serial ${payload.scenarios.lexicalSearch.serialWallMs} ms, batch ${payload.scenarios.lexicalSearch.batchWallMs} ms, delta ${payload.scenarios.lexicalSearch.wallDeltaMs} ms`);
    console.log(`Semantic search: serial ${payload.scenarios.semanticSearch.serialWallMs} ms, batch ${payload.scenarios.semanticSearch.batchWallMs} ms, worker ${payload.scenarios.semanticSearch.workerModel}`);
    console.log(`Validation: serial ${payload.scenarios.validation.serialWallMs} ms, batch ${payload.scenarios.validation.batchWallMs} ms, delta ${payload.scenarios.validation.wallDeltaMs} ms`);
    console.log(`Edit post-actions: ${payload.scenarios.editPostActions.mode}, final diff matches=${payload.scenarios.editPostActions.finalDiffMatches}`);
  }
} finally {
  repositoryIntelligence.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(editRoot, { recursive: true, force: true });
  fs.rmSync(stateRoot, { recursive: true, force: true });
}
