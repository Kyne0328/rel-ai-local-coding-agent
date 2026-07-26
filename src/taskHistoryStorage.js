'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_SESSIONS = 500;
const MIGRATION_MARKER = '.audit-history-migrated-v1';
const MAX_PARSED_CACHE_ENTRIES = 2 * MAX_SESSIONS;

// Parsed JSON is cached only while the file's high-resolution modification time and
// size remain identical. File metadata is re-read for every listing so a desktop app,
// connector server, or secondary process cannot leave task history stale indefinitely.
const parsedCache = new Map();

function getTaskHistoryDir(config = {}) {
  const { getStateDir } = require('./audit');
  return path.join(getStateDir(config), 'sessions');
}

function ensureMigrated(config) {
  const directory = getTaskHistoryDir(config);
  const marker = path.join(directory, MIGRATION_MARKER);
  if (fs.existsSync(marker)) return;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    const { readAudit } = require('./audit');
    const { buildTaskHistory } = require('./taskHistory');
    const audit = readAudit(config, { limit: 10000, fullScan: true });
    const sessions = buildTaskHistory(audit.entries, {}, { limit: MAX_SESSIONS });
    for (const session of sessions) writeSession(directory, session);
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] session history migration:', error);
  }
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

function writeSession(directory, session) {
  if (!session?.id) return;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = sessionPath(directory, session.id);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(session), { mode: 0o600 });
  fs.renameSync(temporary, target);
  // The caller still owns `session`, so do not cache a reference that could be
  // mutated behind the cache's back.
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
  for (const file of parsedCache.keys()) {
    if (file.startsWith(directory + path.sep)) parsedCache.delete(file);
  }
}

function readCachedSession(file, identity) {
  const cached = parsedCache.get(file);
  if (cached?.identity === identity) return cached.session;
  const session = safeReadJson(file);
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
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Test-only: drop every in-memory cache so a suite can rewrite the store on disk and
// observe the new state without restarting the process.
function resetTaskHistoryCaches() {
  parsedCache.clear();
}

module.exports = {
  MAX_SESSIONS,
  clearTaskHistory,
  ensureMigrated,
  getTaskHistoryDir,
  listSessions,
  pruneSessions,
  readSession,
  removeSession,
  resetTaskHistoryCaches,
  writeSession
};
