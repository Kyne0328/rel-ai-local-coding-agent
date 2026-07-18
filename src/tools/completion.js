'use strict';

const { readAudit } = require('../audit');
const { resolveWorkspace } = require('../config');
const { clearSessionPolicy } = require('../policyResolver');
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

function completeTask(config, args = {}) {
  const workspace = resolveWorkspace(config, args.workspace);
  const summary = String(args.summary || '').trim();
  if (!summary) throw new Error('summary is required to report task completion.');
  if (summary.length > 2000) throw new Error('summary must be 2000 characters or fewer.');

  const context = getCurrentToolActivityContext();
  if (!context?.taskId) {
    throw new Error('Task completion requires an active Rel.AI work session.');
  }

  const taskEvents = readAudit(config, { limit: 10000, taskId: context.taskId }).entries
    .filter(entry => entry && entry.taskId === context.taskId)
    .filter(entry => !entry.workspace || entry.workspace === workspace.alias)
    .sort((left, right) => eventTime(left) - eventTime(right));

  const validation = findLatestPassedValidation(taskEvents);
  if (!validation) {
    throw new Error('Cannot report completion: this session has no successful final validation. Run relai_run_checks and call relai_complete_task only after it passes.');
  }

  const validationIndex = taskEvents.lastIndexOf(validation);
  const changedAfterValidation = taskEvents.slice(validationIndex + 1).filter(entry =>
    entry.ok !== false &&
    CODE_MUTATING_TOOLS.has(String(entry.tool || ''))
  );
  if (changedAfterValidation.length) {
    const tools = [...new Set(changedAfterValidation.map(entry => String(entry.tool || 'edit')))];
    throw new Error(`Cannot report completion: code changed after the last passed validation (${tools.join(', ')}). Run final validation again first.`);
  }

  const changedFiles = unique(taskEvents.flatMap(eventChangedFiles));
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
    changedFiles,
    message: 'Task completion accepted. Rel.AI will close this work session when this final tool call returns.'
  };
}

function findLatestPassedValidation(events) {
  return [...events].reverse().find(entry =>
    entry.tool === 'relai_run_checks' &&
    entry.ok !== false &&
    entry.validationStatus === 'passed'
  ) || null;
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

module.exports = { completeTask, CODE_MUTATING_TOOLS };
