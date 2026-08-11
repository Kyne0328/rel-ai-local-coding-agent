import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import { buildCheckCatalog, selectChecksForPackages } from '../src/workflow/checkCatalog.js';
import { normalizeWorkflowSnapshot } from '../src/workflow/contracts.js';
import { decideWorkflow } from '../src/workflow/decision.js';
import { checkEvidenceReusable } from '../src/workflow/evidence.js';
import { buildWorkflowSnapshot } from '../src/workflow/runtime.js';
import { clearTopologyCache, discoverRepositoryTopology } from '../src/workflow/topology.js';
import { startManagedProcess, stopManagedProcess } from '../src/processManager.js';

const METRIC_PATHS = Object.freeze([
  'fixtures.rootNodePackages',
  'fixtures.hrisNestedPackages',
  'fixtures.largeRepoFiles',
  'fixtures.ambientDirtyFiles',
  'fixtures.taskOwnedFiles',
  'budgets.topologyColdMs',
  'budgets.topologyWarmMs',
  'budgets.decisionMedianMs',
  'budgets.workflowBytes',
  'budgets.postReadGitProcesses',
  'workAvoided.backendChecksSelectedForFrontend',
  'workAvoided.duplicateCheckExecutions',
  'workAvoided.duplicateProcessSpawns',
  'workAvoided.repeatedFailureActionChanged'
]);

const LIMITS = Object.freeze({
  topologyColdMs: 300,
  topologyWarmMs: 30,
  decisionMedianMs: 5,
  workflowBytes: 8 * 1024,
  postReadGitProcesses: 0
});

async function runWorkflowBenchmark() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-workflow-benchmark-'));
  const stateDir = path.join(temp, 'state');
  const processes = [];
  try {
    const fixtures = createFixtures(temp);
    clearTopologyCache();
    const coldStarted = performance.now();
    const largeTopology = discoverRepositoryTopology(fixtures.large.path);
    const topologyColdMs = performance.now() - coldStarted;
    const warmSamples = [];
    for (let index = 0; index < 10; index += 1) {
      const started = performance.now();
      discoverRepositoryTopology(fixtures.large.path);
      warmSamples.push(performance.now() - started);
    }
    const topologyWarmMs = median(warmSamples);

    const decisionSamples = [];
    for (let index = 0; index < 1000; index += 1) {
      const started = performance.now();
      decideWorkflow({
        intent: 'bugfix',
        boundary: { level: 'package', packageIds: ['npm:front-end'], changedFiles: ['front-end/src/app.js'], affectedTests: ['front-end/test/app.test.js'] },
        risk: { level: 'medium', reasons: ['source edit'] },
        completion: { hardReady: false, blockers: ['validation'] },
        evidence: { fresh: 0, stale: 0, reusable: 0 },
        repeatCount: 0
      });
      decisionSamples.push(performance.now() - started);
    }
    const decisionMedianMs = median(decisionSamples);

    const compact = normalizeWorkflowSnapshot({
      stage: 'verify', intent: 'bugfix', confidence: 'high',
      boundary: { level: 'package', packageIds: ['npm:front-end'], changedFiles: Array.from({ length: 50 }, (_, index) => `front-end/src/${index}.js`), impactedPaths: [], affectedTests: ['front-end/test/app.test.js'] },
      risk: { level: 'medium', reasons: ['behavior-changing source edit'] },
      evidence: { fresh: 2, stale: 1, reusable: 1, lastMutationGeneration: 3, lastValidatedMutationGeneration: 2 },
      recommendedActions: Array.from({ length: 5 }, (_, index) => ({ tool: 'relai_validate', action: 'checks', priority: index + 1, reason: `Run focused check ${index}`, args: { check: `check-${index}` } })),
      avoidActions: [{ action: 'release validation', reason: 'Package-local boundary.' }],
      completion: { hardReady: false, blockers: ['current validation'] }
    });
    const workflowBytes = Buffer.byteLength(JSON.stringify(compact));

    let postReadGitProcesses = 0;
    await buildWorkflowSnapshot({
      workspace: { alias: 'large', path: fixtures.large.path },
      taskId: 'benchmark-task',
      taskIntegrity: { taskOwnedChangedFiles: [], mutationGeneration: 0, latestValidatedMutationGeneration: 0, validationResult: 'not_run', hasPassedValidation: false, externalChangedFiles: [] },
      recentEvidence: [],
      currentResult: { ok: true, items: [{ path: 'package-a/src/0.js', sha256: 'abc' }] },
      hardCompletion: { hardReady: true, blockers: [] },
      hooks: { gitStatus: () => { postReadGitProcesses += 1; return []; } }
    });

    const hrisTopology = discoverRepositoryTopology(fixtures.hris.path);
    const hrisCatalog = buildCheckCatalog(hrisTopology);
    const frontendChecks = selectChecksForPackages(hrisCatalog, ['npm:front-end']);
    const backendChecksSelectedForFrontend = frontendChecks.filter(unit => unit.packageId === 'npm:back-end').length;

    const reusable = checkEvidenceReusable({
      kind: 'check', outcome: 'passed', commandId: 'npm:front-end:test', command: 'npm test', cwd: 'front-end', repositoryFingerprint: 'same-fingerprint'
    }, {
      commandId: 'npm:front-end:test', command: 'npm test', cwd: 'front-end', repositoryFingerprint: 'same-fingerprint'
    });
    const duplicateCheckExecutions = reusable ? 0 : 1;

    const processConfig = { stateDir, processEnvironment: { allow: [] } };
    const processWorkspace = { alias: 'root', path: fixtures.root.path };
    const command = `node -e "setInterval(()=>{},1000)"`;
    const first = await startManagedProcess(processWorkspace, processConfig, { command, kind: 'service', purpose: 'workflow benchmark', startupWaitMs: 20 }, { taskId: 'benchmark-task', principal: 'benchmark' });
    processes.push(first.processId);
    const second = await startManagedProcess(processWorkspace, processConfig, { command, kind: 'service', purpose: 'workflow benchmark', startupWaitMs: 20 }, { taskId: 'benchmark-task', principal: 'benchmark' });
    const duplicateProcessSpawns = second.reused === true && second.processId === first.processId ? 0 : 1;

    const beforeFailure = decideWorkflow({
      intent: 'bugfix', boundary: { level: 'package', changedFiles: ['front-end/src/app.js'], affectedTests: ['front-end/test/app.test.js'] },
      risk: { level: 'medium', reasons: [] }, completion: { hardReady: false, blockers: ['validation'] },
      evidence: { fresh: 0, stale: 0, reusable: 0 }, repeatCount: 0
    });
    const afterFailure = decideWorkflow({
      intent: 'bugfix', boundary: { level: 'package', changedFiles: ['front-end/src/app.js'], affectedTests: ['front-end/test/app.test.js'] },
      risk: { level: 'medium', reasons: [] }, completion: { hardReady: false, blockers: ['validation'] },
      evidence: { fresh: 2, stale: 0, reusable: 0 }, repeatCount: 2
    });
    const repeatedFailureActionChanged = beforeFailure.recommendedActions[0]?.tool !== afterFailure.recommendedActions[0]?.tool ? 1 : 0;

    const result = {
      environment: { platform: process.platform, node: process.version },
      fixtures: {
        rootNodePackages: 1,
        hrisNestedPackages: hrisTopology.packages.length,
        largeRepoFiles: fixtures.large.fileCount,
        ambientDirtyFiles: fixtures.ambient.ambientDirtyFiles,
        taskOwnedFiles: fixtures.ambient.taskOwnedFiles
      },
      budgets: {
        topologyColdMs: round(topologyColdMs),
        topologyWarmMs: round(topologyWarmMs),
        decisionMedianMs: round(decisionMedianMs),
        workflowBytes,
        postReadGitProcesses
      },
      workAvoided: {
        backendChecksSelectedForFrontend,
        duplicateCheckExecutions,
        duplicateProcessSpawns,
        repeatedFailureActionChanged
      },
      observed: { largePackages: largeTopology.packages.length }
    };
    assertWorkflowBenchmarkContract(result);
    enforceBudgets(result);
    return result;
  } finally {
    for (const processId of [...new Set(processes)]) {
      try { await stopManagedProcess({ stateDir }, { processId, graceMs: 50 }, { internal: true }); } catch {}
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function createFixtures(temp) {
  const root = path.join(temp, 'root-node');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'root-node', scripts: { test: 'node --test' } }));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const app = true;\n');

  const hris = path.join(temp, 'hris');
  for (const name of ['front-end', 'back-end']) {
    fs.mkdirSync(path.join(hris, name, 'src'), { recursive: true });
    fs.mkdirSync(path.join(hris, name, 'test'), { recursive: true });
    fs.writeFileSync(path.join(hris, name, 'package.json'), JSON.stringify({ name, scripts: { test: 'node --test', build: 'node -e "void 0"' } }));
  }

  const large = path.join(temp, 'large');
  let fileCount = 0;
  for (const packageName of ['package-a', 'package-b', 'package-c', 'package-d']) {
    const source = path.join(large, packageName, 'src');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(large, packageName, 'package.json'), JSON.stringify({ name: packageName, scripts: { test: 'node --test' } }));
    for (let index = 0; index < 500; index += 1) {
      fs.writeFileSync(path.join(source, `${index}.js`), `export const value${index} = ${index};\n`);
      fileCount += 1;
    }
  }

  const ambient = path.join(temp, 'ambient');
  fs.mkdirSync(path.join(ambient, 'src'), { recursive: true });
  fs.writeFileSync(path.join(ambient, 'package.json'), JSON.stringify({ name: 'ambient' }));
  for (let index = 0; index < 150; index += 1) fs.writeFileSync(path.join(ambient, 'src', `ambient-${index}.js`), `export const ambient${index} = true;\n`);
  fs.writeFileSync(path.join(ambient, 'src', 'task-owned.js'), 'export const taskOwned = true;\n');

  return {
    root: { path: root },
    hris: { path: hris },
    large: { path: large, fileCount },
    ambient: { path: ambient, ambientDirtyFiles: 150, taskOwnedFiles: 1 }
  };
}

function assertWorkflowBenchmarkContract(result) {
  for (const metricPath of METRIC_PATHS) {
    const value = readPath(result, metricPath);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Workflow benchmark metric '${metricPath}' must be a finite number.`);
  }
  return true;
}

function enforceBudgets(result) {
  for (const [name, limit] of Object.entries(LIMITS)) {
    const value = result.budgets[name];
    if (value > limit) throw new Error(`Workflow benchmark budget exceeded: ${name}=${value} > ${limit}.`);
  }
  for (const [name, value] of Object.entries(result.workAvoided)) {
    const expected = name === 'repeatedFailureActionChanged' ? 1 : 0;
    if (value !== expected) throw new Error(`Workflow work-avoided contract failed: ${name}=${value}, expected ${expected}.`);
  }
}

function readPath(value, dotted) { return dotted.split('.').reduce((current, key) => current?.[key], value); }
function median(values) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function round(value) { return Math.round(Number(value) * 100) / 100; }

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const result = await runWorkflowBenchmark();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export { LIMITS, METRIC_PATHS, assertWorkflowBenchmarkContract, runWorkflowBenchmark };