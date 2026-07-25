export function activityEventId(entry = {}) {
  const identity = entry.id != null && String(entry.id)
    ? ['persisted', String(entry.id)]
    : [
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
      ];
  return `event:${fnv1a64(JSON.stringify(identity))}`;
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
