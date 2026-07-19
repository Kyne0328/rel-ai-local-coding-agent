'use strict';

const { readAudit } = require('../audit');
const { resolveWorkspace } = require('../config');
const { clearSessionPolicy, readSessionPolicy } = require('../policyResolver');
const {
  getCurrentToolActivityContext,
  requestCurrentTaskCompletion
} = require('../toolActivity');

const CODE_MUTATING_TOOLS = new Set([
  'relai_write',
  'relai_replace',
  'relai_edit',
  'relai_tidy_run',
  'relai_restore_changes'
]);
const COMPLETION_VALIDATION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function completeTask(config, args = {}) {
  const workspace = resolveWorkspace(config, args.workspace);
  const summary = String(args.summary || '').trim();
  if (!summary) throw new Error('summary is required to report task completion.');
  if (summary.length > 2000) throw new Error('summary must be 2000 characters or fewer.');

  const context = getCurrentToolActivityContext();
  if (!context?.taskId) {
    throw new Error('Task completion requires an active Rel.AI work session.');
  }

  const sessionPolicy = readSessionPolicy(config, workspace.alias);
  const preferredTaskIds = unique([
    context.taskId,
    String(sessionPolicy?.taskId || '').trim()
  ].filter(Boolean));
  const workspaceEvents = readAudit(config, { limit: 10000, workspace: workspace.alias }).entries
    .filter(entry => entry && (!entry.workspace || entry.workspace === workspace.alias))
    .sort((left, right) => eventTime(left) - eventTime(right));
  const preferredEvents = workspaceEvents.filter(entry => preferredTaskIds.includes(String(entry.taskId || '')));

  let validation = findLatestPassedValidation(preferredEvents);
  let recoveredValidationSession = false;
  if (!validation) {
    const latestWorkspaceValidation = findLatestPassedValidation(workspaceEvents);
    if (latestWorkspaceValidation && isRecentValidation(latestWorkspaceValidation)) {
      validation = latestWorkspaceValidation;
      recoveredValidationSession = true;
    }
  }
  if (!validation) {
    throw new Error('Cannot report completion: no successful final validation could be linked to this workspace session. Run relai_run_checks now, then call relai_complete_task again.');
  }

  const validationAtMs = eventTime(validation);
  const changedAfterValidation = workspaceEvents.filter(entry =>
    eventTime(entry) > validationAtMs &&
    entry.ok !== false &&
    CODE_MUTATING_TOOLS.has(String(entry.tool || ''))
  );
  if (changedAfterValidation.length) {
    const tools = [...new Set(changedAfterValidation.map(entry => String(entry.tool || 'edit')))];
    throw new Error(`Cannot report completion: code changed after the last passed validation (${tools.join(', ')}). Run final validation again first.`);
  }

  const validationTaskId = String(validation.taskId || '').trim();
  const relatedTaskIds = unique([...preferredTaskIds, validationTaskId].filter(Boolean));
  const relatedEvents = workspaceEvents.filter(entry => relatedTaskIds.includes(String(entry.taskId || '')));
  const changedFiles = unique(relatedEvents.flatMap(eventChangedFiles));
  const completion = requestCurrentTaskCompletion({
    summary,
    validationStatus: 'passed',
    validationLevel: validation.validationLevel || '',
    validationAt: validation.ts || '',
    changedFiles
  });
  clearSessionPolicy(config, workspace.alias);

  return {
    ok: true,
    workspace: workspace.alias,
    taskId: completion.taskId,
    completionKnown: true,
    endReason: 'explicit_completion',
    summary,
    validationStatus: 'passed',
    validationLevel: validation.validationLevel || '',
    validationAt: validation.ts || '',
    validationTaskId,
    relatedTaskIds,
    recoveredValidationSession: recoveredValidationSession || Boolean(validationTaskId && validationTaskId !== context.taskId),
    changedFiles,
    message: recoveredValidationSession
      ? 'Task completion accepted using the latest safe passed validation for this workspace. Rel.AI will close this work session when this final tool call returns.'
      : 'Task completion accepted. Rel.AI will close this work session when this final tool call returns.'
  };
}

function findLatestPassedValidation(events) {
  return [...events].reverse().find(entry =>
    entry.tool === 'relai_run_checks' &&
    entry.ok !== false &&
    entry.validationStatus === 'passed'
  ) || null;
}

function isRecentValidation(entry) {
  const timestamp = eventTime(entry);
  return timestamp > 0 && Date.now() - timestamp <= COMPLETION_VALIDATION_MAX_AGE_MS;
}

function eventChangedFiles(entry) {
  const values = [];
  if (Array.isArray(entry.changedFiles)) values.push(...entry.changedFiles);
  if (Array.isArray(entry.sessionChangedFiles)) values.push(...entry.sessionChangedFiles);
  if (entry.filePath) values.push(entry.filePath);
  return values.map(String).filter(Boolean);
}

function eventTime(entry) {
  const value = Date.parse(entry?.ts || entry?.at || entry?.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function unique(values) {
  return [...new Set(values)];
}

module.exports = { completeTask, CODE_MUTATING_TOOLS, COMPLETION_VALIDATION_MAX_AGE_MS };
