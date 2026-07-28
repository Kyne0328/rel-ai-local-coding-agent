const { runProcess, summarizeCommand } = require("../process");
const { discoverCommands } = require("../commandDiscovery");
const { detectVerifyChecks } = require("./checkDetection");
const { normalizeCommandAlias } = require("../commandNormalizer");
const { selectValidationLevel } = require("../validationStrategy");
const { resolvePolicy } = require("../policyResolver");
const { clampNumber } = require("./limits");
const { updateCurrentToolActivity } = require("../toolActivity");
const { finalizeValidationResult, normalizeCompletionSummary } = require("../tools/completion");
const { readValidationPlan } = require('./validationPlan');
const { workspaceGitStatus } = require('../repo/gitOps');
const { runSpan } = require('../telemetry');
const { operationTaskSignal } = require('../operationTasks');
const CHECK_OUTPUT_TAIL_DEFAULT = 4000, CHECK_OUTPUT_TAIL_FULL = 40000;
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
  const level = String(planSelection === 'focused' ? 'quick' : (args.level || planSelection || "standard")).toLowerCase();
  const complete = args.complete === true, completionSummary = complete ? normalizeCompletionSummary(args.summary) : '';
  const { checks, aliasNormalizations } = normalizeVerifyChecks(effectiveArgs, workspace.path, level);
  const { level: validationLevel, reason: validationLevelReason, changedFiles } = selectValidationLevel(workspace.path, workspace, args.validationLevel);
  const policy = resolvePolicy(workspace, config);
  if (checks.length === 0) {
    updateCurrentToolActivity({ operation: `No ${level} validation commands were detected` });
    return {
    ok: false,
    workspace: workspace.alias,
    level,
    checks: [],
    commands: [],
    results: [],
    aliasNormalizations: 0,
    validationLevel,
    validationLevelReason,
    changedFiles,
    policy,
    validated: false,
    validationStatus: "not_run",
    message: "Validation status: NOT RUN. No validation checks were detected or executed. This is not a passed validation. Define a check/test/build script or pass an explicit check."
    };
  }
  const stopOnFailure = args.stopOnFailure !== false, fullOutput = Boolean(args.fullOutput);
  const runConfig = fullOutput
    ? { ...config, maxOutputBytes: Math.max(Number(config.maxOutputBytes) || 0, 16 * 1024 * 1024) }
    : config;
  const tailChars = fullOutput ? CHECK_OUTPUT_TAIL_FULL : CHECK_OUTPUT_TAIL_DEFAULT;
  const results = [];
  const signal = args._operationTaskId ? operationTaskSignal(config, args._operationTaskId) : undefined;
  for (let index = 0; index < checks.length; index += 1) {
    const command = checks[index];
    updateCurrentToolActivity({
      operation: `Running validation ${index + 1}/${checks.length}: ${command}`,
      detail: command
    });
    const result = await runSpan(config, 'relai.validation.step', {
      'relai.workspace': workspace.alias,
      'relai.validation.command': command.slice(0, 300),
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
    if (!summary.ok && stopOnFailure) break;
  }
  const ok = results.length === checks.length && results.every((item) => item.ok);
  const nextAction = ok
    ? "Completion is not automatic. If the task is finished, call relai_complete_task once; on future final validations, pass complete:true with summary to validate and close the session atomically."
    : "Fix the failing validation before reporting task completion.";
  const validationResult = {
    ok,
    workspace: workspace.alias,
    level,
    checks,
    commands: checks,
    results,
    aliasNormalizations,
    validationLevel,
    validationLevelReason,
    changedFiles,
    policy,
    validated: results.length > 0,
    validationStatus: ok ? "passed" : "failed",
    nextAction,
    ...(validationPlan ? { planId: validationPlan.planId, planSelection, planCreatedAt: validationPlan.createdAt } : {}),
    ...(fullOutput ? { fullOutput: true } : {})
  };
  if (!ok || !complete) return validationResult;
  return finalizeValidationResult(config, workspace, validationResult, completionSummary);
}
// Keep the last maxChars of a command stream so the failing tail survives the
// server-level result cap. Prepends a marker noting how much was dropped.
function tailString(text, maxChars) {
  const value = String(text);
  if (value.length <= maxChars) return value;
  return `[rel-ai-mcp kept last ${maxChars} of ${value.length} chars]\n` + value.slice(value.length - maxChars);
}

function boundCheckOutput(summary, maxChars) {
  const bounded = { ...summary };
  if (typeof bounded.stdout === "string") bounded.stdout = tailString(bounded.stdout, maxChars);
  if (typeof bounded.stderr === "string") bounded.stderr = tailString(bounded.stderr, maxChars);
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
  if (explicit.length) return { checks: [...new Set(explicit)], aliasNormalizations: aliasNormalizations.count };
  return { checks: detectVerifyChecks(root, level), aliasNormalizations: aliasNormalizations.count };
}

function makeResolver(discovered, aliasNormalizations) {
  return (raw) => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return trimmed;
    const { command, normalized } = normalizeCommandAlias(trimmed, trimmed, discovered);
    if (normalized) aliasNormalizations.count++;
    return command;
  };
}

function collectExplicitChecks(args, resolveAndTrack) {
  const explicit = [];
  pushResolvedExplicit(explicit, args.check, resolveAndTrack);
  pushResolvedExplicit(explicit, args.command, resolveAndTrack);
  pushResolvedCommands(explicit, args.commands, resolveAndTrack);
  pushResolvedCommandText(explicit, args.commandsText, resolveAndTrack);
  return explicit;
}

function pushResolvedExplicit(target, value, resolveAndTrack) {
  if (typeof value === "string" && value.trim()) target.push(resolveAndTrack(value));
}

function pushResolvedCommands(target, commands, resolveAndTrack) {
  if (!Array.isArray(commands)) return;
  for (const item of commands) {
    const command = resolveAndTrack(String(item || ""));
    if (command) target.push(command);
  }
}

function pushResolvedCommandText(target, commandsText, resolveAndTrack) {
  if (typeof commandsText !== "string" || !commandsText.trim()) return;
  for (const line of commandsText.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith("#")) {
      target.push(resolveAndTrack(trimmedLine));
    }
  }
}

// detectVerifyChecks moved to checkDetection.js; re-exported here so config summaries,
// code-intelligence diagnostics, and tests keep a single import site.
module.exports = { relaiVerify, hasRequestedChecks, detectVerifyChecks };
