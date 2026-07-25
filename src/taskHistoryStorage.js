'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_SESSIONS = 500;
const MIGRATION_MARKER = '.audit-history-migrated-v1';

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

function listSessions(directory, limit = MAX_SESSIONS) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => fileMetadata(path.join(directory, entry.name)))
    .filter(Boolean)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limit)
    .map(item => safeReadJson(item.file))
    .filter(session => session && session.id);
}

function readSession(directory, id) {
  return safeReadJson(sessionPath(directory, id));
}

function writeSession(directory, session) {
  if (!session?.id) return;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = sessionPath(directory, session.id);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(session), { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function removeSession(directory, id) {
  fs.rmSync(sessionPath(directory, id), { force: true });
}

function pruneSessions(directory, limit = MAX_SESSIONS) {
  if (!fs.existsSync(directory)) return;
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => fileMetadata(path.join(directory, entry.name)))
    .filter(Boolean)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const item of files.slice(limit)) fs.rmSync(item.file, { force: true });
}

function clearTaskHistory(config) {
  fs.rmSync(getTaskHistoryDir(config), { recursive: true, force: true });
}

function fileMetadata(file) {
  try {
    return { file, mtimeMs: fs.statSync(file).mtimeMs };
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

module.exports = {
  MAX_SESSIONS,
  clearTaskHistory,
  ensureMigrated,
  getTaskHistoryDir,
  listSessions,
  pruneSessions,
  readSession,
  removeSession,
  writeSession
};
