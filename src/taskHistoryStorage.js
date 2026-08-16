import { getStateDir } from './statePaths.js';
import { readJsonFile, writeJsonAtomic, writeJsonAtomicAsync } from './durableState.js';

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeTaskProgress, sanitizeTaskRecord } from './taskObservability.js';
import { isTerminalTaskStatus } from './taskState.js';
import { watchPathFor } from './watchPath.js';
const MAX_SESSIONS = 500;
const TASK_HISTORY_VERSION = 3;
const HISTORY_FORMAT_MARKER = '.task-history-v3';
const MAX_PARSED_CACHE_ENTRIES = 2 * MAX_SESSIONS;
const DIRECTORY_METADATA_RESCAN_MS = 5000;
const parsedCache = new Map();
const directoryMetadataCache = new Map();

function getTaskHistoryDir(config = {}) {
  return path.join(getStateDir(config), 'sessions');
}

function ensureCurrentHistory(config) {
  const directory = getTaskHistoryDir(config);
  const marker = path.join(path.dirname(directory), HISTORY_FORMAT_MARKER);
  if (fs.existsSync(marker)) return;
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(marker, `${new Date().toISOString()}\n`, { mode: 0o600 });
}

function sessionFileNames(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name);
  } catch {
    return null;
  }
}

function sessionMetadata(directory, names) {
  const metadata = [];
  for (const name of names) {
    const item = fileMetadata(path.join(directory, name), name);
    if (item) metadata.push(item);
  }
  metadata.sort((left, right) => {
    if (left.mtimeNs === right.mtimeNs) return left.name.localeCompare(right.name);
    return left.mtimeNs > right.mtimeNs ? -1 : 1;
  });
  return metadata;
}

function listSessions(directory, limit = MAX_SESSIONS) {
  return cachedSessionMetadata(directory)
    .slice(0, limit)
    .map(item => readCachedSession(item.file, item.identity))
    .filter(session => session && session.id);
}

function readSession(directory, id) {
  const file = sessionPath(directory, id);
  const metadata = fileMetadata(file, path.basename(file));
  return metadata ? readCachedSession(file, metadata.identity) : null;
}

function removeSession(directory, id) {
  const file = sessionPath(directory, id);
  fs.rmSync(file, { force: true });
  parsedCache.delete(file);
  const cached = directoryMetadataCache.get(directory);
  if (cached) {
    cached.items.delete(path.basename(file));
    cached.checkedAt = Date.now();
  }
}

function normalizeStoredSession(session, { forWrite = false } = {}) {
  if (!session || typeof session !== 'object') return null;
  const id = String(session.id || '').trim();
  if (!id) return null;
  if (!forWrite) {
    if (Number(session.version || 0) !== TASK_HISTORY_VERSION) return null;
    if (String(session.taskId || '') !== id || String(session.sessionId || '') !== id) return null;
  }
  const current = forWrite
    ? { ...session, id, taskId: id, sessionId: id, version: TASK_HISTORY_VERSION }
    : session;
  const sanitized = sanitizeTaskRecord(current);
  if (!sanitized) return null;
  const resultSummary = sanitized.resultSummary
    || (sanitized.status === 'completed' ? sanitized.summary || '' : '');
  return {
    ...sanitized,
    ...(resultSummary ? { resultSummary } : {}),
    progress: normalizeTaskProgress(sanitized.progress, sanitized.status)
  };
}

function writeSession(directory, session) {
  if (!session?.id) return;
  const sanitized = normalizeStoredSession(session, { forWrite: true });
  if (!sanitized) throw new Error('Task history writes require a current session record.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = sessionPath(directory, sanitized.id);
  writeJsonAtomic(target, sanitized, { mode: 0o600, spacing: 0 });
  rememberWrittenSession(directory, target, sanitized);
}

async function writeSessionAsync(directory, session) {
  if (!session?.id) return;
  const sanitized = normalizeStoredSession(session, { forWrite: true });
  if (!sanitized) throw new Error('Task history writes require a current session record.');
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  const target = sessionPath(directory, sanitized.id);
  await writeJsonAtomicAsync(target, sanitized, { mode: 0o600, spacing: 0, durable: false });
  rememberWrittenSession(directory, target, sanitized);
}

function pruneSessions(directory, limit = MAX_SESSIONS) {
  const metadata = cachedSessionMetadata(directory);
  if (metadata.length <= limit) return;
  const cached = directoryMetadataCache.get(directory);
  let retained = metadata.length;
  for (const item of [...metadata].reverse()) {
    if (retained <= limit) break;
    const session = readCachedSession(item.file, item.identity);
    if (!session || !isTerminalTaskStatus(session.status)) continue;
    fs.rmSync(item.file, { force: true });
    parsedCache.delete(item.file);
    cached?.items.delete(item.name);
    retained -= 1;
  }
}

function clearTaskHistory(config) {
  const directory = getTaskHistoryDir(config);
  fs.rmSync(directory, { recursive: true, force: true });
  clearCachedDirectory(directory);
  closeDirectoryMetadataCache(directory);
}

function clearCachedDirectory(directory) {
  for (const file of parsedCache.keys()) {
    if (file.startsWith(directory + path.sep)) parsedCache.delete(file);
  }
}

function readCachedSession(file, identity) {
  const cached = parsedCache.get(file);
  if (cached?.identity === identity) return cached.session;
  const parsed = safeReadJson(file);
  const session = parsed ? normalizeStoredSession(parsed) : null;
  if (session) {
    parsedCache.set(file, { identity, session });
    trimParsedCache();
  } else {
    parsedCache.delete(file);
    if (parsed && typeof parsed === 'object') fs.rmSync(file, { force: true });
  }
  return session;
}

function cachedSessionMetadata(directory) {
  let cached = directoryMetadataCache.get(directory);
  if (cached && !cached.dirty && Date.now() - cached.checkedAt < DIRECTORY_METADATA_RESCAN_MS) return orderedMetadata(cached.items.values());
  const names = sessionFileNames(directory);
  if (!names) return [];
  const items = new Map(sessionMetadata(directory, names).map(item => [item.name, item]));
  if (!cached) {
    cached = { items, dirty: false, watcher: null, checkedAt: Date.now() };
    directoryMetadataCache.set(directory, cached);
    watchSessionDirectory(directory, cached);
  } else {
    cached.items = items;
    cached.dirty = false;
    cached.checkedAt = Date.now();
  }
  return orderedMetadata(items.values());
}

function orderedMetadata(items) {
  return [...items].sort((left, right) => {
    if (left.mtimeNs === right.mtimeNs) return left.name.localeCompare(right.name);
    return left.mtimeNs > right.mtimeNs ? -1 : 1;
  });
}

function watchSessionDirectory(directory, cached) {
  try {
    const watchDirectory = watchPathFor(directory);
    cached.watcher = fs.watch(watchDirectory, { persistent: false }, (_event, filename) => {
      const name = String(filename || '');
      if (!name || name.endsWith('.tmp') || name.endsWith('.old')) return;
      cached.dirty = true;
    });
    cached.watcher.on('error', () => { cached.dirty = true; });
  } catch {
    cached.watcher = null;
    cached.dirty = true;
  }
}

function rememberWrittenSession(directory, target, session) {
  const metadata = fileMetadata(target, path.basename(target));
  if (!metadata) {
    parsedCache.delete(target);
    const cached = directoryMetadataCache.get(directory);
    if (cached) cached.dirty = true;
    return;
  }
  parsedCache.set(target, { identity: metadata.identity, session });
  trimParsedCache();
  const cached = directoryMetadataCache.get(directory);
  if (cached) {
    cached.items.set(metadata.name, metadata);
    cached.checkedAt = Date.now();
  }
}

function closeDirectoryMetadataCache(directory) {
  const cached = directoryMetadataCache.get(directory);
  try { cached?.watcher?.close(); } catch {}
  directoryMetadataCache.delete(directory);
}

function trimParsedCache() {
  if (parsedCache.size <= MAX_PARSED_CACHE_ENTRIES) return;
  const overflow = parsedCache.size - MAX_PARSED_CACHE_ENTRIES;
  let removed = 0;
  for (const key of parsedCache.keys()) {
    parsedCache.delete(key);
    if (++removed >= overflow) return;
  }
}

function fileMetadata(file, name) {
  try {
    const stat = fs.statSync(file, { bigint: true });
    return {
      file,
      name,
      mtimeNs: stat.mtimeNs,
      size: stat.size,
      identity: `${stat.mtimeNs}:${stat.size}`
    };
  } catch {
    return null;
  }
}

function sessionPath(directory, id) {
  const digest = crypto.createHash('sha256').update(String(id)).digest('hex');
  return path.join(directory, `${digest}.json`);
}

function safeReadJson(file) {
  return readJsonFile(file, { fallback: null });
}

function resetTaskHistoryCaches() {
  parsedCache.clear();
  for (const directory of [...directoryMetadataCache.keys()]) closeDirectoryMetadataCache(directory);
}

export { MAX_SESSIONS, clearTaskHistory, ensureCurrentHistory, getTaskHistoryDir, listSessions, pruneSessions, readSession, removeSession, resetTaskHistoryCaches, writeSession, writeSessionAsync };