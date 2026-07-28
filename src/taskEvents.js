

function cleanTaskId(value) {
  return String(value || '').trim();
}

function isCurrentTaskEvent(event) {
  return Boolean(
    event
    && typeof event === 'object'
    && cleanTaskId(event.taskId)
    && Number(event.taskIdentityVersion || 0) >= 2
    && event.taskIdExplicit === true
    && event.taskHistoryEligible !== false
    && event.eventType !== 'task.start.rejected'
  );
}

function operationForTool(tool, fallback = 'Rel.AI activity') {
  const value = String(tool || '').replace(/^relai_/, '').replaceAll('_', ' ');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : fallback;
}

function unique(values) {
  return [...new Set(values)];
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

function eventTime(value) {
  const timestamp = Date.parse(value?.endedAt || value?.completedAt || value?.ts || value?.startedAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export { clamp, cleanTaskId, eventTime, isCurrentTaskEvent, operationForTool, unique };
