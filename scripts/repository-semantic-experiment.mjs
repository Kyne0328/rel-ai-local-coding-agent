import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';

import { openIndexDatabase, repositoryIndexPath } from '../src/repository/intelligence/database.js';
import { rankWithGraphDiffusion } from '../src/repository/intelligence/graphDiffusion.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';

const noiseFiles = integerArg('--noise', 300, 0, 5000);
const json = process.argv.includes('--json');
const assertImprovement = process.argv.includes('--assert');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-semantic-experiment-'));
const workspaceRoot = path.join(root, 'workspace');
const stateDir = path.join(root, 'state');
const workspace = { alias: 'semantic-experiment', path: workspaceRoot, context: {}, testCommands: {}, commands: {} };
const config = { stateDir };

const cases = [
  {
    name: 'connection-recovery',
    query: 'recover connection after socket failure',
    anchor: 'src/signals/socketObserver.js',
    target: 'src/runtime/continuation.js'
  },
  {
    name: 'profile-persistence',
    query: 'save customer profile changes',
    anchor: 'src/features/profileController.js',
    target: 'src/storage/records.js'
  },
  {
    name: 'credential-refresh',
    query: 'refresh expired login credentials',
    anchor: 'src/security/sessionGuard.js',
    target: 'src/crypto/rotation.js'
  },
  {
    name: 'background-retry',
    query: 'retry failed background job',
    anchor: 'src/jobs/jobMonitor.js',
    target: 'src/runtime/timing.js'
  },
  {
    name: 'checkout-notification',
    query: 'tell customer after checkout succeeds',
    anchor: 'src/commerce/checkoutFlow.js',
    target: 'src/delivery/receiptWorker.js'
  },
  {
    name: 'service-record-retrieval',
    query: 'retrieve customer records from service',
    anchor: 'src/client/accountScreen.js',
    target: 'src/server/accountRoute.js'
  },
  {
    name: 'exact-control',
    query: 'calculate invoice tax',
    anchor: 'src/math/taxCalculator.js',
    target: 'src/math/taxCalculator.js',
    control: true
  }
];

try {
  createFixture(workspaceRoot, noiseFiles);
  const git = spawnSync('git', ['init'], { cwd: workspaceRoot, encoding: 'utf8', windowsHide: true });
  if (git.status !== 0) throw new Error(`git init failed: ${git.stderr || git.stdout}`);

  const indexStarted = performance.now();
  const index = await repositoryIntelligence.ensure(workspace, config, { force: true });
  const indexMs = performance.now() - indexStarted;
  const databaseFile = repositoryIndexPath(config, workspace);
  const graphBytesBefore = fs.statSync(databaseFile).size;
  const rssAfterIndex = process.memoryUsage().rss;
  const db = openIndexDatabase(databaseFile, { readonly: true });
  const rows = [];
  try {
    for (const item of cases) {
      const baselineStarted = performance.now();
      const baseline = await repositoryIntelligence.semanticSearch(workspace, config, { query: item.query, maxResults: 8 }, { graphDiffusion: false });
      const baselineMs = performance.now() - baselineStarted;

      const prototypeStarted = performance.now();
      const prototype = rankWithGraphDiffusion(db, baseline.results, { query: item.query, maxResults: 8, maxSeeds: 8, maxEdges: 20000 });
      const prototypeMs = performance.now() - prototypeStarted;
      const baselinePaths = baseline.results.map(result => result.path);
      const prototypePaths = prototype.results.map(result => result.path);
      rows.push({
        name: item.name,
        query: item.query,
        target: item.target,
        control: item.control === true,
        baselineRank: rankOf(baselinePaths, item.target),
        prototypeRank: rankOf(prototypePaths, item.target),
        baselineTop3: baselinePaths.slice(0, 3),
        prototypeTop3: prototypePaths.slice(0, 3),
        baselineMs: rounded(baselineMs),
        prototypeMs: rounded(prototypeMs),
        expandedCandidates: prototype.expandedCandidateCount,
        analyzedEdges: prototype.analyzedEdgeCount
      });
    }
  } finally {
    db.close();
  }

  const graphBytesAfter = fs.statSync(databaseFile).size;
  const rssAfterQueries = process.memoryUsage().rss;
  const hidden = rows.filter(row => !row.control);
  const controls = rows.filter(row => row.control);
  const report = {
    noiseFiles,
    indexedFiles: index.sourceFileCount,
    indexMs: rounded(indexMs),
    hiddenQueries: hidden.length,
    baselineTargetRecallAt3: recallAt(hidden, 'baselineRank', 3),
    prototypeTargetRecallAt3: recallAt(hidden, 'prototypeRank', 3),
    baselineTargetRecallAt5: recallAt(hidden, 'baselineRank', 5),
    prototypeTargetRecallAt5: recallAt(hidden, 'prototypeRank', 5),
    baselineTargetMrr: mrr(hidden, 'baselineRank'),
    prototypeTargetMrr: mrr(hidden, 'prototypeRank'),
    exactControlPreserved: controls.every(row => row.prototypeRank <= row.baselineRank),
    baselineMedianMs: rounded(median(rows.map(row => row.baselineMs))),
    prototypeMedianMs: rounded(median(rows.map(row => row.prototypeMs))),
    prototypeP95Ms: rounded(percentile(rows.map(row => row.prototypeMs), 0.95)),
    graphDbBytesBefore: graphBytesBefore,
    graphDbBytesAfter: graphBytesAfter,
    addedPersistentBytes: graphBytesAfter - graphBytesBefore,
    rssAfterIndexBytes: rssAfterIndex,
    rssAfterQueriesBytes: rssAfterQueries,
    rows
  };
  report.absoluteRecallGainAt3 = rounded(report.prototypeTargetRecallAt3 - report.baselineTargetRecallAt3);
  report.absoluteRecallGainAt5 = rounded(report.prototypeTargetRecallAt5 - report.baselineTargetRecallAt5);
  report.recommendation = recommendation(report);

  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else printReport(report);

  if (assertImprovement) {
    if (report.absoluteRecallGainAt5 < 0.25) throw new Error(`Prototype recall@5 gain ${report.absoluteRecallGainAt5} is below the 0.25 experiment gate.`);
    if (!report.exactControlPreserved) throw new Error('Prototype regressed the exact-match control.');
    if (report.addedPersistentBytes !== 0) throw new Error(`Prototype changed the persistent graph by ${report.addedPersistentBytes} bytes.`);
    if (report.prototypeP95Ms > 25) throw new Error(`Prototype p95 query overhead ${report.prototypeP95Ms} ms exceeds the 25 ms experiment gate.`);
  }
} finally {
  await repositoryIntelligence.shutdown();
  if (process.env.REL_AI_MCP_BENCHMARK_KEEP !== '1') fs.rmSync(root, { recursive: true, force: true });
  else console.error(`Semantic experiment fixture kept at ${root}`);
}

function createFixture(rootDir, noiseCount) {
  const files = {
    'src/signals/socketObserver.js': `import { scheduleResume } from '../runtime/continuation.js';\nexport function observeSocketFailure(error) {\n  // recover connection after socket failure\n  return scheduleResume(error);\n}\n`,
    'src/runtime/continuation.js': `export function scheduleResume(error) { return waitWindow(error); }\nfunction waitWindow(error) { return error ? 200 : 0; }\n`,
    'src/features/profileController.js': `import { commitRecord } from '../storage/records.js';\nexport function submitProfile(input) {\n  // save customer profile changes\n  return commitRecord(input);\n}\n`,
    'src/storage/records.js': `export function commitRecord(value) { return { ...value, stored: true }; }\n`,
    'src/security/sessionGuard.js': `import { rotateSecret } from '../crypto/rotation.js';\nexport function inspectSession(session) {\n  // refresh expired login credentials\n  return rotateSecret(session);\n}\n`,
    'src/crypto/rotation.js': `export function rotateSecret(session) { return { ...session, nonce: Date.now() }; }\n`,
    'src/jobs/jobMonitor.js': `import { scheduleAgain } from '../runtime/timing.js';\nexport function observeTask(task) {\n  // retry failed background job\n  return scheduleAgain(task);\n}\n`,
    'src/runtime/timing.js': `export function scheduleAgain(task) { return { task, delay: 500 }; }\n`,
    'src/commerce/checkoutFlow.js': `export function finishPurchase(order) {\n  // tell customer after checkout succeeds\n  bus.emit('order:completed', order);\n}\n`,
    'src/delivery/receiptWorker.js': `export function deliverReceipt(order) { return order.id; }\nbus.on('order:completed', deliverReceipt);\n`,
    'src/client/accountScreen.js': `export async function openDirectory() {\n  // retrieve customer records from service\n  return fetch('/v1/accounts');\n}\n`,
    'src/server/accountRoute.js': `export function listRows() { return []; }\nrouter.get('/v1/accounts', listRows);\n`,
    'src/math/taxCalculator.js': `export function calculateInvoiceTax(total, rate) { return total * rate; }\n`
  };
  for (const [relativePath, source] of Object.entries(files)) write(rootDir, relativePath, source);
  const vocabulary = ['recover', 'connection', 'socket', 'failure', 'save', 'customer', 'profile', 'changes', 'refresh', 'expired', 'login', 'credentials', 'retry', 'failed', 'background', 'job', 'checkout', 'succeeds', 'retrieve', 'records', 'service', 'invoice', 'tax'];
  for (let index = 0; index < noiseCount; index += 1) {
    const word = vocabulary[index % vocabulary.length];
    write(rootDir, `src/noise/noise-${index}.js`, `export function unrelated${index}() { return '${word}'; }\n`);
  }
}

function write(rootDir, relativePath, source) {
  const file = path.join(rootDir, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, 'utf8');
}

function rankOf(paths, target) {
  const index = paths.indexOf(target);
  return index === -1 ? null : index + 1;
}

function recallAt(rows, key, k) {
  if (!rows.length) return 0;
  return rounded(rows.filter(row => row[key] != null && row[key] <= k).length / rows.length);
}

function mrr(rows, key) {
  if (!rows.length) return 0;
  return rounded(rows.reduce((sum, row) => sum + (row[key] ? 1 / row[key] : 0), 0) / rows.length);
}

function median(values) {
  return percentile(values, 0.5);
}

function percentile(values, fraction) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function recommendation(report) {
  if (report.absoluteRecallGainAt5 >= 0.25 && report.exactControlPreserved && report.addedPersistentBytes === 0 && report.prototypeP95Ms <= 25) {
    return 'promising: graph diffusion clears the experiment gate; evaluate on real repositories before production integration';
  }
  return 'do-not-integrate: the lightweight prototype did not clear the quality/cost gate';
}

function printReport(report) {
  console.log('Repository semantic retrieval experiment');
  console.log(`  Indexed files:             ${report.indexedFiles}`);
  console.log(`  Hidden target recall@3:    baseline ${report.baselineTargetRecallAt3} -> prototype ${report.prototypeTargetRecallAt3}`);
  console.log(`  Hidden target recall@5:    baseline ${report.baselineTargetRecallAt5} -> prototype ${report.prototypeTargetRecallAt5}`);
  console.log(`  Hidden target MRR:         baseline ${report.baselineTargetMrr} -> prototype ${report.prototypeTargetMrr}`);
  console.log(`  Exact control preserved:   ${report.exactControlPreserved}`);
  console.log(`  Prototype median / p95:    ${report.prototypeMedianMs} ms / ${report.prototypeP95Ms} ms`);
  console.log(`  Added persistent bytes:    ${report.addedPersistentBytes}`);
  console.log(`  Recommendation:            ${report.recommendation}`);
  for (const row of report.rows) {
    console.log(`  - ${row.name}: target rank ${row.baselineRank ?? '-'} -> ${row.prototypeRank ?? '-'}; prototype ${row.prototypeMs} ms`);
  }
}

function integerArg(name, fallback, min, max) {
  const index = process.argv.indexOf(name);
  const parsed = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return parsed;
}

function rounded(value) {
  return Number(Number(value).toFixed(4));
}
