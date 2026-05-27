const MAX_ENTRIES = 200;
const MAX_BYTES_PER_ENTRY = 1024 * 1024;

const cache = new Map();

function getCachedRead(alias, absPath, currentMtimeMs) {
  const key = `${alias}::${absPath}`;
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.mtimeMs !== currentMtimeMs) { cache.delete(key); return null; }
  entry.lastAccessMs = Date.now();
  return entry.content;
}

function setCachedRead(alias, absPath, mtimeMs, content) {
  const bytes = Buffer.byteLength(String(content || ''), 'utf8');
  if (bytes > MAX_BYTES_PER_ENTRY) return;
  const key = `${alias}::${absPath}`;
  cache.set(key, { mtimeMs, content, lastAccessMs: Date.now(), bytes });
  if (cache.size > MAX_ENTRIES) evictLru();
}

function invalidatePath(alias, absPath) {
  cache.delete(`${alias}::${absPath}`);
}

function invalidateAlias(alias) {
  const prefix = `${alias}::`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

function invalidateAll() {
  cache.clear();
}

function cacheStats() {
  return { entries: cache.size };
}

function evictLru() {
  let oldestKey = null;
  let oldestAccess = Infinity;
  for (const [k, v] of cache.entries()) {
    if (v.lastAccessMs < oldestAccess) { oldestAccess = v.lastAccessMs; oldestKey = k; }
  }
  if (oldestKey) cache.delete(oldestKey);
}

module.exports = { getCachedRead, setCachedRead, invalidatePath, invalidateAlias, invalidateAll, cacheStats };
