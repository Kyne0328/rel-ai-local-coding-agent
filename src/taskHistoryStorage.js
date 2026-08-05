import { getStateDir } from './statePaths.js';
import { readJsonFile, writeJsonAtomic } from './durableState.js';

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeTaskProgress, sanitizeTaskRecord } from './taskObservability.js';
const MAX_SESSIONS = 500;
const HISTORY_FORMAT_MARKER = '.task-history-v3';
const MAX_PARSED_CACHE_ENTRIES = 2 * MAX_SESSIONS;
const parsedCache = new Map();

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
  const names = sessionFileNames(directory);
  if (!names) return [];
  return sessionMetadata(directory, names)
    .slice(0, limit)
    .map(item => readCachedSession(item.file, item.identity))
    .filter(session => session && session.id);
}

function readSession(directory, id) {
  const file = sessionPath(directory, id);
  const metadata = fileMetadata(file, path.basename(file));
  return metadata ? readCachedSession(file, metadata.identity) : null;
}

function normalizeStoredSession(session) {
  const sanitized = sanitizeTaskRecord(session);
  if (!sanitized) return sanitized;
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
  const sanitized = normalizeStoredSession(session);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = sessionPath(directory, sanitized.id);
  writeJsonAtomic(target, sanitized, { mode: 0o600, spacing: 0 });
  parsedCache.delete(target);
}

function removeSession(directory, id) {
  const file = sessionPath(directory, id);
  fs.rmSync(file, { force: true });
  parsedCache.delete(file);
}

function pruneSessions(directory, limit = MAX_SESSIONS) {
  const names = sessionFileNames(directory);
  if (!names || names.length <= limit) return;
  for (const item of sessionMetadata(directory, names).slice(limit)) {
    fs.rmSync(item.file, { force: true });
    parsedCache.delete(item.file);
  }
}

function clearTaskHistory(config) {
  const directory = getTaskHistoryDir(config);
  fs.rmSync(directory, { recursive: true, force: true });
  clearCachedDirectory(directory);
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
  }
  return session;
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
}

export { MAX_SESSIONS, clearTaskHistory, ensureCurrentHistory, getTaskHistoryDir, listSessions, pruneSessions, readSession, removeSession, resetTaskHistoryCaches, writeSession };