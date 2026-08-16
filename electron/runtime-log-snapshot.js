function applyRuntimeLogChange(snapshot = {}, change = {}) {
  const current = cloneRuntimeLogSnapshot(snapshot);
  if (!change || typeof change !== 'object') return current;

  const currentRevision = Math.max(0, Number(current.revision || 0));
  const requestedRevision = Number(change.revision ?? currentRevision);
  const hasRevision = change.revision != null && Number.isFinite(requestedRevision);
  const revision = Number.isFinite(requestedRevision) ? Math.max(0, requestedRevision) : currentRevision;
  if (hasRevision && revision <= currentRevision) return current;
  if (change.type === 'reset') {
    return { ...current, revision, count: 0, entries: [] };
  }
  if (change.type === 'persistence' && change.persistence && typeof change.persistence === 'object') {
    return { ...current, revision, persistence: { ...change.persistence } };
  }
  if (change.type === 'replace' && change.entry && typeof change.entry === 'object') {
    const entries = [...current.entries];
    const index = Number.isInteger(Number(change.index)) ? Number(change.index) : entries.length - 1;
    if (index >= 0 && index < entries.length) entries[index] = cloneLogEntry(change.entry);
    return {
      ...current,
      revision,
      count: Number.isFinite(Number(change.count)) ? Math.max(0, Number(change.count)) : current.count,
      entries
    };
  }
  if (change.type !== 'append' || !change.entry || typeof change.entry !== 'object') return current;

  const requestedMaxEntries = Number(change.maxEntries || current.entries.length || change.count || 1);
  const maxEntries = Number.isFinite(requestedMaxEntries) ? Math.max(1, requestedMaxEntries) : Math.max(1, current.entries.length || 1);
  const entries = [...current.entries, cloneLogEntry(change.entry)];
  if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
  const count = Number.isFinite(Number(change.count)) ? Math.max(0, Number(change.count)) : entries.length;
  return { ...current, revision, count, entries };
}

function cloneRuntimeLogSnapshot(snapshot = {}) {
  return {
    ...snapshot,
    entries: Array.isArray(snapshot.entries) ? snapshot.entries.map(cloneLogEntry) : []
  };
}

function cloneLogEntry(entry = {}) {
  return {
    ...entry,
    ...(entry.details && typeof entry.details === 'object'
      ? { details: JSON.parse(JSON.stringify(entry.details)) }
      : {})
  };
}

export { applyRuntimeLogChange };
