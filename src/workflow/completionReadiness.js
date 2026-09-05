import { classifyWorkflowRisk } from './risk.js';

function taskMutationRequiresValidation(authority = {}) {
  const changedFiles = normalizeChangedFiles(authority.taskOwnedChangedFiles);
  if (!changedFiles.length) return true;
  return classifyWorkflowRisk({ changedFiles }).risk.level !== 'low';
}

function taskValidationReadiness(authority = {}, changedFilesOverride) {
  const changedFiles = changedFilesOverride == null
    ? normalizeChangedFiles(authority.taskOwnedChangedFiles)
    : normalizeChangedFiles(changedFilesOverride);
  const mutationGeneration = Number(authority.mutationGeneration || 0);
  const validatedMutationGeneration = Number(authority.latestValidatedMutationGeneration || 0);
  const validationRequired = mutationGeneration > 0 && taskMutationRequiresValidation({
    ...authority,
    taskOwnedChangedFiles: changedFiles
  });
  const knownValidationFailure = mutationGeneration > 0 && authority.validationResult === 'failed';
  const currentValidation = mutationGeneration > 0
    && authority.validationResult === 'passed'
    && validatedMutationGeneration === mutationGeneration;
  const ready = mutationGeneration <= 0
    || (!validationRequired && !knownValidationFailure)
    || currentValidation;
  return {
    changedFiles,
    mutationGeneration,
    validatedMutationGeneration,
    validationRequired,
    knownValidationFailure,
    currentValidation,
    ready
  };
}

function normalizeChangedFiles(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(file => String(file || '').trim().replaceAll('\\', '/'))
    .filter(Boolean))];
}

export { taskValidationReadiness };
