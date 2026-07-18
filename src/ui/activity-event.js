export function activityEventId(entry = {}) {
  if (entry.id != null && String(entry.id)) return `id:${String(entry.id)}`;
  return [
    entry.ts || entry.at || entry.createdAt || '',
    entry.tool || entry.type || '',
    entry.workspace || '',
    entry.taskId || '',
    entry.operationId || '',
    entry.sessionId || '',
    entry.path || entry.filePath || '',
    entry.operation || entry.message || entry.error || '',
    entry.ms ?? '',
    entry.ok === false ? 'error' : 'ok'
  ].map(value => String(value ?? '')).join('\u001f');
}
