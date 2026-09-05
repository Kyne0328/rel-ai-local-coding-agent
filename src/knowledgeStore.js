import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { statePath } from './stateLayout.js';

const KNOWLEDGE_SCHEMA_VERSION = 4;
const DEFAULT_BOOTSTRAP_BYTES = 4096;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS knowledge_meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS validation_affinity(
  workspace TEXT NOT NULL,
  path_prefix TEXT NOT NULL,
  command TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(workspace, path_prefix, command)
) WITHOUT ROWID, STRICT;
`;

function knowledgeSettings(config = {}) {
  const raw = config.knowledge && typeof config.knowledge === 'object' ? config.knowledge : {};
  return {
    proceduralLearning: raw.proceduralLearning !== false,
    maxBootstrapBytes: clamp(raw.maxBootstrapBytes, 1024, 16384, DEFAULT_BOOTSTRAP_BYTES)
  };
}

function knowledgeDatabasePath(config = {}) {
  return statePath(config, 'knowledge', 'knowledge.sqlite');
}

function openKnowledgeDatabase(config = {}, { readonly = false } = {}) {
  const file = knowledgeDatabasePath(config);
  if (!readonly) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (readonly && !fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: readonly, timeout: 3000 });
  try {
    db.enableLoadExtension(false);
    db.exec('PRAGMA foreign_keys=ON');
    if (!readonly) {
      db.exec('PRAGMA journal_mode=WAL');
      db.exec('PRAGMA synchronous=NORMAL');
      ensureKnowledgeSchema(db);
      try { fs.chmodSync(file, 0o600); } catch {}
    }
    return db;
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
}

function ensureKnowledgeSchema(db) {
  const current = Number(metaValue(db, 'schema_version', 0));
  if (current > KNOWLEDGE_SCHEMA_VERSION) throw new Error(`Knowledge schema ${current} is newer than supported schema ${KNOWLEDGE_SCHEMA_VERSION}.`);
  db.exec(SCHEMA_SQL);
  if (current < 3) removeLegacyProcedureLearning(db);
  if (current < 4) removeLegacyGenericMemory(db);
  setMeta(db, 'schema_version', KNOWLEDGE_SCHEMA_VERSION);
}

function removeLegacyProcedureLearning(db) {
  db.exec(`
    DROP TABLE IF EXISTS procedure_fts;
    DROP TABLE IF EXISTS procedure_runs;
    DROP TABLE IF EXISTS procedures;
  `);
}

function removeLegacyGenericMemory(db) {
  db.exec(`
    DROP TABLE IF EXISTS knowledge_fts;
    DROP TABLE IF EXISTS knowledge_items;
  `);
}

function ensureLearningState(config) {
  const db = openKnowledgeDatabase(config);
  try { return { ok: true }; }
  finally { db.close(); }
}

function clearLearningState(config) {
  const db = openKnowledgeDatabase(config);
  try {
    db.exec('DELETE FROM validation_affinity;');
    return { ok: true, clearedValidationAffinity: true };
  } finally { db.close(); }
}

function recordTaskValidationAffinity(config, workspace, session = {}, completion = {}) {
  if (completion.duplicate === true || String(completion.validationStatus || '') !== 'passed') return null;
  const workspaceAlias = clean(workspace?.alias || workspace, 120);
  const changedFiles = [...new Set((completion.changedFiles || session.changedFiles || []).map(file => clean(file, 500)).filter(Boolean))];
  const evidence = Array.isArray(session.workflowEvidence) ? session.workflowEvidence : [];
  const checks = [...new Set(evidence
    .filter(item => item?.kind === 'check' || item?.command || item?.commandId)
    .map(item => clean(item?.command || item?.commandId, 180))
    .filter(Boolean))].slice(-6);
  if (!workspaceAlias || !changedFiles.length || !checks.length) return null;
  const db = openKnowledgeDatabase(config);
  try {
    learnValidationAffinity(db, workspaceAlias, changedFiles, checks, new Date().toISOString());
    return { ok: true, workspace: workspaceAlias, pathCount: changedFiles.length, checkCount: checks.length };
  } finally { db.close(); }
}

function learnedValidationChecks(config, workspace, paths = [], options = {}) {
  const workspaceAlias = clean(workspace?.alias || workspace, 120);
  if (!workspaceAlias) return [];
  const prefixes = [...new Set((paths || []).map(validationPathPrefix).filter(Boolean))];
  if (!prefixes.length) return [];
  const db = openKnowledgeDatabase(config, { readonly: true });
  if (!db) return [];
  try {
    const scores = new Map();
    const statement = db.prepare('SELECT command, success_count FROM validation_affinity WHERE workspace=? AND path_prefix=?');
    for (const prefix of prefixes) {
      for (const row of statement.all(workspaceAlias, prefix)) {
        const command = String(row.command || '');
        scores.set(command, Number(scores.get(command) || 0) + Number(row.success_count || 0));
      }
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, clamp(options.limit, 1, 20, 8))
      .map(([command, successCount]) => ({ command, successCount, source: 'learned-validation-affinity' }));
  } finally { db.close(); }
}

function learnValidationAffinity(db, workspace, changedFiles, checks, now) {
  const statement = db.prepare(`INSERT INTO validation_affinity(workspace, path_prefix, command, success_count, last_seen_at)
    VALUES(?,?,?,?,?) ON CONFLICT(workspace,path_prefix,command) DO UPDATE SET success_count=success_count+1,last_seen_at=excluded.last_seen_at`);
  for (const prefix of [...new Set(changedFiles.map(validationPathPrefix).filter(Boolean))]) {
    for (const command of checks) statement.run(workspace, prefix, command, 1, now);
  }
}

function validationPathPrefix(file) {
  const normalized = String(file || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized) return '';
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  return parts.slice(0, Math.min(3, parts.length - 1)).join('/');
}

function clean(value, limit) {
  const text = String(value || '').replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : text;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  const resolved = Number.isFinite(number) ? number : Number(fallback);
  return Math.min(max, Math.max(min, Math.floor(Number.isFinite(resolved) ? resolved : min)));
}
function setMeta(db, key, value) { db.prepare('INSERT INTO knowledge_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(String(key), String(value)); }
function metaValue(db, key, fallback = '') { try { return db.prepare('SELECT value FROM knowledge_meta WHERE key=?').get(String(key))?.value ?? fallback; } catch { return fallback; } }

export {
  clearLearningState,
  ensureLearningState,
  knowledgeDatabasePath,
  knowledgeSettings,
  learnedValidationChecks,
  recordTaskValidationAffinity
};
