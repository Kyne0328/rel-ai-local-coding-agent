import { isTerminalTaskStatus } from '../taskState.js';

const DEFAULT_LIMIT = 4;

function compactActiveRelatedWork(activity = {}, currentTask = {}, options = {}) {
  const currentId = taskId(currentTask);
  const workspace = String(currentTask.workspace || '').trim();
  const principalFingerprint = String(currentTask.principalFingerprint || '').trim();
  if (!currentId || !workspace || !principalFingerprint) return [];

  const limit = Math.max(1, Math.min(8, Number(options.limit || DEFAULT_LIMIT)));
  return (Array.isArray(activity.tasks) ? activity.tasks : [])
    .filter(task => taskId(task) !== currentId)
    .filter(task => String(task?.workspace || '').trim() === workspace)
    .filter(task => String(task?.principalFingerprint || '').trim() === principalFingerprint)
    .filter(task => !isTerminalTaskStatus(task?.status) && String(task?.status || '').toLowerCase() !== 'inactive')
    .sort((left, right) => taskTime(right) - taskTime(left))
    .slice(0, limit)
    .map(compactActiveTask);
}

function compactActiveTask(task = {}) {
  const changes = uniqueStrings(task.changedFiles).slice(0, 8);
  const stage = cleanText(task.currentStage, 160);
  const activity = cleanText(task.currentActivity || task.operation || task.lastOperation, 260);
  const current = prune({
    ...(stage ? { stage } : {}),
    ...(activity ? { activity } : {})
  });
  return prune({
    goal: cleanText(task.objective || task.title, 500),
    status: cleanText(task.status || task.state, 80),
    ...(Object.keys(current).length ? { current } : {}),
    ...(changes.length ? { changes } : {}),
    validation: cleanText(task.validation || task.validationStatus, 80)
  });
}

function taskId(task = {}) {
  return String(task.id || task.taskId || task.sessionId || '').trim();
}

function taskTime(task = {}) {
  const updated = Date.parse(String(task.updatedAt || ''));
  if (Number.isFinite(updated)) return updated;
  return Math.max(0, Number(task.lastActivityAt || task.startedAt || 0));
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

function cleanText(value, limit) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : text;
}

function prune(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== '' && item !== null));
}

export { compactActiveRelatedWork };
