import * as path from 'node:path';
import { runProcess, summarizeCommand } from '../process.js';
import { selectValidationLevel } from '../validationStrategy.js';
import { resolvePolicy } from '../policyResolver.js';
import { clampNumber } from './limits.js';
import { getCurrentTaskAbortSignal, getCurrentToolActivityContext } from '../toolActivity.js';
import { readTaskIntegrity, readWorkspaceIntegrity, taskOwnedChangedFiles } from '../taskIntegrity.js';
import { readRecentWorkflowEvidence, recordWorkflowEvidence } from '../taskHistoryStore.js';
import { buildWorkflowEvidenceReceipt, checkEvidenceReusable } from '../workflow/evidence.js';
import { sanitizeDisplayText } from '../taskObservability.js';
import { combineAbortSignals } from '../abortSignals.js';
import { finalizeValidationResult, normalizeCompletionSummary } from '../tools/completion.js';
import { createValidationFingerprint, createValidationPlan, readValidationPlan } from './validationPlan.js';
import { runSpan } from '../telemetry.js';
import { nativeToolTaskSignal } from '../mcp/nativeToolTasks.js';
import { parallel, runPlan, sequence, step } from '../executionPlan.js';
import { createExecutionPlanObserver, recordExecutionPlanMetrics } from '../executionObservability.js';
import { buildCheckExecutionStages } from '../workflow/checkExecution.js';
import { hasRequestedChecks, normalizeVerifyChecks } from './validationChecks.js';
import { noChecksValidationResult } from './validationNoChecks.js';
import {
  boundCheckOutput,
  checkResultStatus,
  completedValidationUnits,
  publishValidationProgress
} from './validationProgress.js';

const CHECK_OUTPUT_TAIL_DEFAULT = 4000;
const CHECK_OUTPUT_TAIL_FULL = 40000;
async function relaiVerify(workspace, config, args = {}, context = {}) {
  const currentTaskId = String(getCurrentToolActivityContext()?.taskId || context.taskId || args.work_id || '').trim();
  const logicalWorkspaceAlias = String(workspace.sourceAlias || workspace.alias || '').trim();
  const suppliedChangedFiles = Array.isArray(args.changedFiles)
    ? [...new Set(args.changedFiles.map(file => String(file || '').trim()).filter(Boolean))]
    : [];
  const ownedChangedFiles = currentTaskId ? taskOwnedChangedFiles(config, currentTaskId, logicalWorkspaceAlias) : [];
  const validationScope = suppliedChangedFiles.length ? suppliedChangedFiles : (ownedChangedFiles.length ? ownedChangedFiles : undefined);  let effectiveArgs = args;
  let validationPlan = null;
  let planSelection = '';
  if (!args.planId && !hasRequestedChecks(args)) {
    validationPlan = await createValidationPlan(workspace, config, {
      release: String(args.level || '').toLowerCase() === 'release',
      ...(validationScope ? { changedFiles: validationScope } : {})
    });
    planSelection = String(args.planLevel || args.level || validationPlan.recommended || 'focused').toLowerCase();
    const plannedChecks = validationPlan.checks?.[planSelection];
    if (!Array.isArray(plannedChecks)) throw new Error(`Validation plan has no '${planSelection}' check set.`);
    effectiveArgs = { ...args, checks: plannedChecks };
  } else if (args.planId) {
    validationPlan = readValidationPlan(config, args.planId, workspace);
    const current = await createValidationFingerprint(workspace, config);
    if (!validationPlan.workspaceFingerprint || validationPlan.workspaceFingerprint !== current.fingerprint) {
      throw new Error('Validation plan is stale because relevant workspace content changed. Run relai_validate with action "checks" again to generate a current internal plan.');
    }
    planSelection = String(args.planLevel || args.level || validationPlan.recommended || 'focused').toLowerCase();
    const plannedChecks = validationPlan.checks?.[planSelection];
    if (!Array.isArray(plannedChecks)) throw new Error(`Validation plan has no '${planSelection}' check set.`);
    effectiveArgs = { ...args, checks: plannedChecks };
  }

  const level = String(planSelection === 'focused' ? 'quick' : (args.level || planSelection || 'standard')).toLowerCase();
  const complete = args.complete === true;
  const completionSummary = complete ? normalizeCompletionSummary(args.summary) : '';
  const normalized = normalizeVerifyChecks(effectiveArgs, workspace.path, level);
  const { checks, checkUnits, skippedChecks, aliasNormalizations } = normalized;
  const { level: validationLevel, reason: validationLevelReason, changedFiles } = selectValidationLevel(workspace.path, workspace, args.validationLevel, validationScope);
  const policy = resolvePolicy(workspace, config);

  if (checks.length === 0) {
    return noChecksValidationResult(workspace, config, {
      level, skippedChecks, aliasNormalizations, validationLevel,
      validationLevelReason, changedFiles, policy
    });
  }

  const stopOnFailure = args.stopOnFailure !== false;
  const fullOutput = Boolean(args.fullOutput);
  const tailChars = fullOutput ? CHECK_OUTPUT_TAIL_FULL : CHECK_OUTPUT_TAIL_DEFAULT;
  const indexedResults = new Array(checks.length);
  const currentFingerprint = await createValidationFingerprint(workspace, config);
  const recentEvidence = currentTaskId ? readRecentWorkflowEvidence(config, currentTaskId, 100) : [];
  const reusedCheckIds = new Array(checks.length);
  let executedUnits = 0;
  let reusedUnits = 0;
  const signal = combineAbortSignals(
    getCurrentTaskAbortSignal(),
    args._operationTaskId ? nativeToolTaskSignal(args._operationTaskId) : undefined,
    context.signal
  );
  const effectiveUnits = checks.map((command, index) => checkUnits[index] || {
    id: `explicit:${index}`,
    command,
    cwd: '.',
    kind: 'other',
    scopeKey: 'repository'
  });
  const executionStages = buildCheckExecutionStages(effectiveUnits);
  const visibleResults = () => indexedResults.filter(Boolean);

  publishValidationProgress({ checks, skippedChecks, results: [], currentIndex: 0, resultStatus: 'pending' });

  const planStages = executionStages.map(stage => {
    const nodes = stage.items.map(({ unit, index, policy: executionPolicy }) => step(
      `validation ${index + 1}`,
      async () => {
        const command = unit.command;
        const reusable = recentEvidence.find(receipt => checkEvidenceReusable(receipt, {
          commandId: unit.id || `explicit:${index}`,
          command,
          cwd: unit.cwd || '.',
          repositoryFingerprint: currentFingerprint.fingerprint
        }));
        if (reusable) {
          const reusedSummary = { command, cwd: unit.cwd || '.', ok: true, reused: true };
          indexedResults[index] = reusedSummary;
          reusedUnits += 1;
          reusedCheckIds[index] = unit.id || command;
          publishValidationProgress({
            checks,
            skippedChecks,
            results: visibleResults(),
            currentCheck: sanitizeDisplayText(command, 300),
            currentIndex: index + 1,
            resultStatus: 'passed'
          });
          return reusedSummary;
        }

        const displayCommand = sanitizeDisplayText(command, 300) || `Check ${index + 1}`;
        publishValidationProgress({
          checks,
          skippedChecks,
          results: visibleResults(),
          currentCheck: displayCommand,
          currentIndex: index + 1,
          resultStatus: 'running'
        });
        const result = await runSpan(config, 'relai.validation.step', {
          'relai.workspace': workspace.alias,
          'relai.validation.command': displayCommand,
          'relai.validation.index': index + 1,
          'relai.validation.total': checks.length,
          'relai.validation.plan_id': String(args.planId || ''),
          'relai.validation.parallel_safe': executionPolicy.parallelSafe === true,
          'relai.validation.kind': executionPolicy.kind
        }, () => runProcess(command, [], {
          cwd: path.resolve(workspace.path, unit.cwd || '.'),
          shell: true,
          commandString: command,
          timeout: clampNumber(args.timeoutMs, 1000, 24 * 60 * 60 * 1000, 120000),
          signal,
          ...(fullOutput ? { maxOutputBytes: 16 * 1024 * 1024 } : {})
        }, config));
        const summary = boundCheckOutput({ command, cwd: unit.cwd || '.', ...summarizeCommand(result) }, tailChars);
        executedUnits += 1;
        indexedResults[index] = summary;
        if (summary.ok && currentTaskId) {
          const authority = readTaskIntegrity(config, currentTaskId, logicalWorkspaceAlias);
          const workspaceIntegrity = readWorkspaceIntegrity(config, logicalWorkspaceAlias);
          const receipt = buildWorkflowEvidenceReceipt({
            tool: 'relai_validate',
            args: { command, cwd: unit.cwd || '.' },
            result: { ok: true, exitCode: summary.exitCode, durationMs: summary.durationMs, validationStatus: 'passed' },
            auditEntry: {
              ts: new Date().toISOString(),
              taskMutationGeneration: authority?.mutationGeneration || 0,
              taskWorkspaceGeneration: workspaceIntegrity?.generation || 0
            },
            repositoryFingerprint: currentFingerprint.fingerprint,
            commandId: unit.id || `explicit:${index}`
          });
          if (receipt) recordWorkflowEvidence(config, currentTaskId, receipt, { defer: true });
        }
        publishValidationProgress({
          checks,
          skippedChecks,
          results: visibleResults(),
          currentCheck: displayCommand,
          currentIndex: index + 1,
          resultStatus: checkResultStatus(summary)
        });
        return summary;
      },
      {
        isSuccess: value => value?.ok === true,
        metadata: {
          index,
          kind: executionPolicy.kind,
          parallelSafe: executionPolicy.parallelSafe,
          resourceKey: executionPolicy.resourceKey,
          displayName: sanitizeDisplayText(unit.command, 120)
        }
      }
    ));
    return stage.parallel
      ? parallel(nodes, { maxConcurrency: 3, stopOnFailure })
      : sequence(nodes, { stopOnFailure });
  });
  const execution = await runPlan(sequence(planStages, { stopOnFailure }), {
    signal,
    onEvent: createExecutionPlanObserver({
      source: 'validation',
      title: 'Running repository validation',
      noun: 'checks',
      category: 'validation'
    })
  });
  recordExecutionPlanMetrics('validation', execution.metrics);
  const results = visibleResults();
  const reusedChecks = reusedCheckIds.filter(Boolean);

  const cancelled = signal?.aborted === true || results.some(item => item.cancelled === true);
  const ok = !cancelled && results.length === checks.length && results.every(item => item.ok);
  const failedCheck = results.find(item => !item.ok)?.command || '';
  const validationStatus = cancelled ? 'cancelled' : ok ? 'passed' : 'failed';
  publishValidationProgress({
    checks,
    skippedChecks,
    results,
    currentCheck: failedCheck ? sanitizeDisplayText(failedCheck, 300) : checks.at(-1),
    currentIndex: Math.min(results.length, checks.length),
    resultStatus: validationStatus,
    final: true
  });

  const nextAction = ok
    ? 'Validation is current for this work_id. Do not rerun unchanged checks; review task-owned changes if needed, then call relai_work with action "finish" once, or use complete:true on the validating call to close atomically.'
    : cancelled
      ? 'Validation was cancelled. Review the partial result and resume only the smallest still-relevant check.'
      : 'Fix or diagnose the failing check, then rerun only the smallest relevant validation unless workflow guidance widens the boundary.';
  const validationFingerprint = (await createValidationFingerprint(workspace, config)).fingerprint;
  const validationResult = {
    ok,
    workspace: workspace.alias,
    level,
    checks,
    commands: checks,
    results,
    skippedChecks,
    aliasNormalizations,
    validationLevel,
    validationLevelReason,
    changedFiles,
    policy,
    validated: results.length > 0,
    validationStatus,
    validationFingerprint,
    cancelled,
    completedUnits: completedValidationUnits(results),
    executedUnits,
    reusedUnits,
    reusedChecks,
    totalUnits: checks.length,
    execution: execution.metrics,
    ...(failedCheck ? { failedCheck } : {}),
    nextAction,
    ...(validationPlan ? { planId: validationPlan.planId, planSelection, planCreatedAt: validationPlan.createdAt } : {}),
    ...(fullOutput ? { fullOutput: true } : {})
  };
  if (!ok || !complete) return validationResult;
  return finalizeValidationResult(config, workspace, validationResult, completionSummary);
}

// Re-exported so config summaries, diagnostics, and tests keep a single import site.
export { relaiVerify, hasRequestedChecks };
