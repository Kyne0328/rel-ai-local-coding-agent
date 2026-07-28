'use strict';

const { runProcess, summarizeCommand } = require('../process');
const { discoverCommands } = require('../commandDiscovery');
const { detectVerifyChecks } = require('./checkDetection');
const { normalizeCommandAlias } = require('../commandNormalizer');
const { selectValidationLevel } = require('../validationStrategy');
const { resolvePolicy } = require('../policyResolver');
const { clampNumber } = require('./limits');
const { getCurrentTaskAbortSignal, updateCurrentToolActivity } = require('../toolActivity');
const { sanitizeDisplayText } = require('../taskObservability');
const { combineAbortSignals } = require('../abortSignals');
const { finalizeValidationResult, normalizeCompletionSummary } = require('../tools/completion');
const { readValidationPlan } = require('./validationPlan');
const { workspaceGitStatus } = require('../repo/gitOps');
const { runSpan } = require('../telemetry');
const { operationTaskSignal } = require('../operationTasks');

const CHECK_OUTPUT_TAIL_DEFAULT = 4000;
const CHECK_OUTPUT_TAIL_FULL = 40000;

async function relaiVerify(workspace, config, args = {}) {
  let effectiveArgs = args;
  let validationPlan = null;
  let planSelection = '';
  if (args.planId) {
    validationPlan = readValidationPlan(config, args.planId, workspace);
    const current = await workspaceGitStatus(workspace, config, { maxBytes: 256 * 1024 });
    const expectedFiles = [...(validationPlan.changedFiles || [])].sort();
    const currentFiles = [...(current.changedFiles || [])].sort();
    if (JSON.stringify(expectedFiles) !== JSON.stringify(currentFiles)) {
      throw new Error('Validation plan is stale because the workspace changed. Create a new relai_validation_plan.');
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
    args._operationTaskId ? operationTaskSignal(config, args._operationTaskId) : undefined
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
    ? 'Completion is not automatic. If the task is finished, call relai_complete_task once; on future final validations, pass complete:true with summary to validate and close the session atomically.'
    : cancelled
      ? 'The validation was cancelled. Review partial results before starting a new task or rerunning validation.'
      : 'Fix the failing validation before reporting task completion.';
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

function publishValidationProgress({ checks, skippedChecks = [], results, currentCheck = '', currentIndex = 0, resultStatus = 'pending', final = false }) {
  const total = checks.length;
  const completed = Math.min(completedValidationUnits(results), total);
  const passed = results.filter(item => item.ok).length;
  const failed = results.filter(item => !item.ok && !item.cancelled).length;
  const cancelled = results.some(item => item.cancelled === true) || resultStatus === 'cancelled';
  const current = sanitizeDisplayText(currentCheck, 300);
  const stage = resultStatus === 'cancelled'
    ? 'Validation cancelled'
    : resultStatus === 'failed' || resultStatus === 'timed_out'
      ? 'Validation failed'
      : final && resultStatus === 'passed'
        ? 'Validation completed'
        : currentIndex > 0
          ? `Validating check ${currentIndex} of ${total}`
          : 'Preparing validation';
  const activity = current
    ? `${current}${resultStatus && resultStatus !== 'pending' ? ` — ${resultStatus.replaceAll('_', ' ')}` : ''}`
    : `${completed} of ${total} checks completed`;
  updateCurrentToolActivity({
    status: 'validating',
    operation: currentIndex > 0 ? `Running validation ${currentIndex}/${total}: ${current || 'check'}` : `Preparing ${total} validation checks`,
    detail: activity,
    currentStage: stage,
    currentActivity: activity,
    progress: {
      mode: 'determinate',
      completedUnits: completed,
      totalUnits: total,
      percentage: final && resultStatus !== 'passed' && completed === total ? 99 : Math.round((completed / total) * 100),
      source: 'validation',
      label: `${completed} of ${total} checks`
    },
    activity: {
      category: 'validation',
      status: 'running',
      title: 'Run repository validation',
      summary: activity,
      metadata: {
        checkCount: total,
        passedCount: passed,
        failedCount: failed,
        skippedCount: skippedChecks.length,
        currentCheck: current,
        currentIndex,
        resultStatus,
        failedCheck: failed ? current : '',
        cancelled
      }
    }
  });
}

function completedValidationUnits(results) {
  return results.filter(item => item.cancelled !== true).length;
}

function checkResultStatus(summary) {
  if (summary.cancelled) return 'cancelled';
  if (summary.timedOut) return 'timed_out';
  return summary.ok ? 'passed' : 'failed';
}

function tailString(text, maxChars) {
  const value = String(text);
  if (value.length <= maxChars) return value;
  return `[rel-ai-mcp kept last ${maxChars} of ${value.length} chars]\n${value.slice(value.length - maxChars)}`;
}

function boundCheckOutput(summary, maxChars) {
  const bounded = { ...summary };
  if (typeof bounded.stdout === 'string') bounded.stdout = tailString(bounded.stdout, maxChars);
  if (typeof bounded.stderr === 'string') bounded.stderr = tailString(bounded.stderr, maxChars);
  return bounded;
}

function hasRequestedChecks(args = {}) {
  return Boolean(args.verify || args.check || args.checks || args.checksText || args.command || args.commands || args.commandsText);
}

function normalizeVerifyChecks(args, root, level) {
  const discovered = discoverCommands(root);
  const aliasNormalizations = { count: 0 };
  const resolveAndTrack = makeResolver(discovered, aliasNormalizations);
  const explicit = collectExplicitChecks(args, resolveAndTrack);
  const candidates = explicit.length ? explicit : detectVerifyChecks(root, level);
  const checks = [];
  const skippedChecks = [];
  const seen = new Set();
  for (const item of candidates) {
    const command = String(item || '').trim();
    if (!command) {
      skippedChecks.push({ command: '', reason: 'empty' });
      continue;
    }
    if (seen.has(command)) {
      skippedChecks.push({ command, reason: 'duplicate' });
      continue;
    }
    seen.add(command);
    checks.push(command);
  }
  return { checks, skippedChecks, aliasNormalizations: aliasNormalizations.count };
}

function makeResolver(discovered, aliasNormalizations) {
  return raw => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return trimmed;
    const { command, normalized } = normalizeCommandAlias(trimmed, trimmed, discovered);
    if (normalized) aliasNormalizations.count += 1;
    return command;
  };
}

function collectExplicitChecks(args, resolveAndTrack) {
  const explicit = [];
  pushResolvedExplicit(explicit, args.check ?? args.command, resolveAndTrack);
  pushResolvedCommands(explicit, args.checks ?? args.commands, resolveAndTrack);
  pushResolvedCommandText(explicit, args.checksText ?? args.commandsText, resolveAndTrack);
  return explicit;
}

function pushResolvedExplicit(target, value, resolveAndTrack) {
  if (typeof value === 'string' && value.trim()) target.push(resolveAndTrack(value));
}

function pushResolvedCommands(target, commands, resolveAndTrack) {
  if (!Array.isArray(commands)) return;
  for (const item of commands) {
    const command = resolveAndTrack(String(item || ''));
    if (command) target.push(command);
  }
}

function pushResolvedCommandText(target, commandsText, resolveAndTrack) {
  if (typeof commandsText !== 'string' || !commandsText.trim()) return;
  for (const line of commandsText.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) target.push(resolveAndTrack(trimmedLine));
  }
}

module.exports = {
  relaiVerify,
  hasRequestedChecks,
  detectVerifyChecks,
  normalizeVerifyChecks,
  publishValidationProgress,
  checkResultStatus
};
