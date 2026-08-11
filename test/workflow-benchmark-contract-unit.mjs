import assert from 'node:assert/strict';
import { assertWorkflowBenchmarkContract } from '../scripts/benchmark-workflow-intelligence.mjs';

const valid = {
  fixtures: { rootNodePackages: 1, hrisNestedPackages: 2, largeRepoFiles: 2000, ambientDirtyFiles: 150, taskOwnedFiles: 1 },
  budgets: { topologyColdMs: 1, topologyWarmMs: 1, decisionMedianMs: 0.01, workflowBytes: 1000, postReadGitProcesses: 0 },
  workAvoided: { backendChecksSelectedForFrontend: 0, duplicateCheckExecutions: 0, duplicateProcessSpawns: 0, repeatedFailureActionChanged: 1 }
};
assert.equal(assertWorkflowBenchmarkContract(valid), true);
const missing = structuredClone(valid);
delete missing.budgets.workflowBytes;
assert.throws(() => assertWorkflowBenchmarkContract(missing), /workflowBytes.*finite number/);
const nonNumeric = structuredClone(valid);
nonNumeric.workAvoided.duplicateCheckExecutions = '0';
assert.throws(() => assertWorkflowBenchmarkContract(nonNumeric), /duplicateCheckExecutions.*finite number/);

console.log('Workflow benchmark metric contract tests passed.');