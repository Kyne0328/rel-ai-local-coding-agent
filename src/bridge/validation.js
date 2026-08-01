import { runProcess, summarizeCommand } from '../process.js';
import { detectVerifyChecks } from './checkDetection.js';
import { selectValidationLevel } from '../validationStrategy.js';
import { resolvePolicy } from '../policyResolver.js';
import { clampNumber } from './limits.js';
import { getCurrentTaskAbortSignal, updateCurrentToolActivity } from '../toolActivity.js';
import { sanitizeDisplayText } from '../taskObservability.js';
import { combineAbortSignals } from '../abortSignals.js';
import { finalizeValidationResult, normalizeCompletionSummary } from '../tools/completion.js';
import { createValidationFingerprint, createValidationPlan, readValidationPlan } from './validationPlan.js';
import { runSpan } from '../telemetry.js';
import { operationTaskSignal } from '../operationTasks.js';
import { hasRequestedChecks, normalizeVerifyChecks } from './validationChecks.js';
import {
  boundCheckOutput,
  checkResultStatus,
  completedValidationUnits,
  publishValidationProgress
} from './validationProgress.js';

const CHECK_OUTPUT_TAIL_DEFAULT = 4000;
const CHECK_OUTPUT_TAIL_FULL = 40000;
async function relaiVerify(workspace, config, args = {}, context = {}) {
  let effectiveArgs = args;
  let validationPlan = null;
  let planSelection = '';
  if (!args.planId && !hasRequestedChecks(args)) {
    validationPlan = await createValidationPlan(workspace, config, {
      release: String(args.level || '').toLowerCase() === 'release'
    });
    planSelection = String(args.planLevel || args.level || validationPlan.recommended || 'focused').toLowerCase();
    const plannedChecks = validationPlan.checks?.[planSelection];
    if (!Array.isArray(plannedChecks)) throw new Error(`Validation plan has no '${planSelection}' check set.`);
    effectiveArgs = { ...args, checks: plannedChecks };
  } else if (args.planId) {
    validationPlan = readValidationPlan(config, args.planId, workspace);
    const current = await createValidationFingerprint(workspace, config);
    if (!validationPlan.workspaceFingerprint || validationPlan.workspaceFingerprint !== current.fingerprint) {
      throw new Error('Validation plan is stale because relevant workspace content changed. Run relai_run_checks again to generate a current internal plan.');
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
  const { checks, skippedChecks, aliasNormalizations } = normalized;
  const { level: validationLevel, reason: validationLevelReason, changedFiles } = selectValidationLevel(workspace.path, workspace, args.validationLevel);
  const policy = resolvePolicy(workspace, config);

  if (checks.length === 0) {
    const validationFingerprint = (await createValidationFingerprint(workspace, config)).fingerprint;
    updateCurrentToolActivity({
      status: 'validating',
      operation: `No ${level} validation commands were detected`,
      currentStage: 'Validation not run',
      currentActivity: 'No validation checks were detected.',
      progress: { mode: 'indeterminate', label: 'No validation checks detected' },
      activity: {
        category: 'validation',
        status: 'running',
        summary: 'No validation checks were detected.',
        metadata: { checkCount: 0, skippedCount: skippedChecks.length }
      }
    });
    return {
      ok: false,
      workspace: workspace.alias,
      level,
      checks: [],
      commands: [],
      results: [],
      skippedChecks,
      aliasNormalizations,
      validationLevel,
      validationLevelReason,
      changedFiles,
      policy,
      validated: false,
      validationStatus: 'not_run',
      validationFingerprint,
      message: 'Validation status: NOT RUN. No validation checks were detected or executed. This is not a passed validation. Define a check/test/build script or pass an explicit check.'
    };
  }

  const stopOnFailure = args.stopOnFailure !== false;
  const fullOutput = Boolean(args.fullOutput);
  const runConfig = fullOutput
    ? { ...config, maxOutputBytes: Math.max(Number(config.maxOutputBytes) || 0, 16 * 1024 * 1024) }
    : config;
  const tailChars = fullOutput ? CHECK_OUTPUT_TAIL_FULL : CHECK_OUTPUT_TAIL_DEFAULT;
  const results = [];
  const signal = combineAbortSignals(
    getCurrentTaskAbortSignal(),
    args._operationTaskId ? operationTaskSignal(config, args._operationTaskId) : undefined,
    context.signal
  );

  publishValidationProgress({ checks, skippedChecks, results, currentIndex: 0, resultStatus: 'pending' });
  for (let index = 0; index < checks.length; index += 1) {
    if (signal?.aborted) break;
    const command = checks[index];
    const displayCommand = sanitizeDisplayText(command, 300) || `Check ${index + 1}`;
    publishValidationProgress({
      checks,
      skippedChecks,
      results,
      currentCheck: displayCommand,
      currentIndex: index + 1,
      resultStatus: 'running'
    });
    const result = await runSpan(config, 'relai.validation.step', {
      'relai.workspace': workspace.alias,
      'relai.validation.command': displayCommand,
      'relai.validation.index': index + 1,
      'relai.validation.total': checks.length,
      'relai.validation.plan_id': String(args.planId || '')
    }, () => runProcess(command, [], {
      cwd: workspace.path,
      shell: true,
      commandString: command,
      timeout: clampNumber(args.timeoutMs, 1000, 24 * 60 * 60 * 1000, 120000),
      signal
    }, runConfig));
    const summary = boundCheckOutput({ command, ...summarizeCommand(result) }, tailChars);
    results.push(summary);
    const status = checkResultStatus(summary);
    publishValidationProgress({
      checks,
      skippedChecks,
      results,
      currentCheck: displayCommand,
      currentIndex: index + 1,
      resultStatus: status
    });
    if (summary.cancelled) break;
    if (!summary.ok && stopOnFailure) break;
  }

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
    ? 'Completion is not automatic. If the work session is finished, call relai_finish_work once; on future final validations, pass complete:true with summary to validate and close the session atomically.'
    : cancelled
      ? 'The validation was cancelled. Review partial results before starting a new task or rerunning validation.'
      : 'Fix the failing validation before reporting task completion.';
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
    totalUnits: checks.length,
    ...(failedCheck ? { failedCheck } : {}),
    nextAction,
    ...(validationPlan ? { planId: validationPlan.planId, planSelection, planCreatedAt: validationPlan.createdAt } : {}),
    ...(fullOutput ? { fullOutput: true } : {})
  };
  if (!ok || !complete) return validationResult;
  return finalizeValidationResult(config, workspace, validationResult, completionSummary);
}

// Re-exported so config summaries, diagnostics, and tests keep a single import site.
export {
  relaiVerify,
  hasRequestedChecks,
  detectVerifyChecks,
  normalizeVerifyChecks,
  publishValidationProgress,
  checkResultStatus
};
