const MAX_ENTRIES = 200;
const MAX_METADATA_ENTRIES = 500;
const MAX_BYTES_PER_ENTRY = 1024 * 1024;

const cache = new Map();
const metadataCache = new Map();

function cacheKey(alias, absPath) {
  return `${alias}::${absPath}`;
}

function getCachedReadEntry(alias, absPath, currentMtimeMs) {
  const key = cacheKey(alias, absPath);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.mtimeMs !== currentMtimeMs) {
    cache.delete(key);
    metadataCache.delete(key);
    return null;
  }
  entry.lastAccessMs = Date.now();
  return {
    content: entry.content,
    sha256: entry.sha256 || null,
    bytes: entry.sourceBytes ?? entry.bytes
  };
}

function getCachedRead(alias, absPath, currentMtimeMs) {
  return getCachedReadEntry(alias, absPath, currentMtimeMs)?.content ?? null;
}

function setCachedRead(alias, absPath, mtimeMs, content, metadata = {}) {
  const bytes = Buffer.byteLength(String(content || ''), 'utf8');
  if (bytes > MAX_BYTES_PER_ENTRY) return;
  const key = cacheKey(alias, absPath);
  cache.set(key, {
    mtimeMs,
    content,
    sha256: metadata.sha256 || null,
    sourceBytes: Number.isFinite(metadata.bytes) ? metadata.bytes : bytes,
    lastAccessMs: Date.now(),
    bytes
  });
  if (cache.size > MAX_ENTRIES) evictLru(cache, MAX_ENTRIES);
}

function getCachedFileMetadata(alias, absPath, currentMtimeMs, currentSize) {
  const key = cacheKey(alias, absPath);
  const entry = metadataCache.get(key);
  if (!entry) return null;
  if (entry.mtimeMs !== currentMtimeMs || entry.bytes !== currentSize) {
    metadataCache.delete(key);
    return null;
  }
  entry.lastAccessMs = Date.now();
  return { sha256: entry.sha256, totalLines: entry.totalLines, bytes: entry.bytes };
}

function setCachedFileMetadata(alias, absPath, mtimeMs, metadata = {}) {
  const bytes = Number(metadata.bytes);
  const totalLines = Number(metadata.totalLines);
  const sha256 = String(metadata.sha256 || '');
  if (!Number.isFinite(bytes) || bytes < 0 || !Number.isFinite(totalLines) || totalLines < 0 || !sha256) return;
  const key = cacheKey(alias, absPath);
  metadataCache.set(key, { mtimeMs, bytes, totalLines, sha256, lastAccessMs: Date.now() });
  if (metadataCache.size > MAX_METADATA_ENTRIES) evictLru(metadataCache, MAX_METADATA_ENTRIES);
}

function invalidatePath(alias, absPath) {
  const key = cacheKey(alias, absPath);
  cache.delete(key);
  metadataCache.delete(key);
}

function invalidateAlias(alias) {
  const prefix = `${alias}::`;
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
  for (const key of metadataCache.keys()) if (key.startsWith(prefix)) metadataCache.delete(key);
}

function invalidateAll() {
  cache.clear();
  metadataCache.clear();
}

function cacheStats() {
  return { entries: cache.size, metadataEntries: metadataCache.size };
}

function evictLru(target, limit) {
  if (target.size <= limit) return;
  let oldestKey = null;
  let oldestAccess = Infinity;
  for (const [key, value] of target.entries()) {
    if (value.lastAccessMs < oldestAccess) {
      oldestAccess = value.lastAccessMs;
      oldestKey = key;
    }
  }
  if (oldestKey) target.delete(oldestKey);
}

export {
  getCachedFileMetadata,
  getCachedRead,
  getCachedReadEntry,
  setCachedFileMetadata,
  setCachedRead,
  invalidatePath,
  invalidateAlias,
  invalidateAll,
  cacheStats
};
