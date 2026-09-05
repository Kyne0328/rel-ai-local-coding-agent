import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { statePath } from './stateLayout.js';
import { relevanceTerms } from './context/relevance.js';

const KNOWLEDGE_SCHEMA_VERSION = 3;
const DEFAULT_BOOTSTRAP_BYTES = 4096;
const MAX_ITEM_CONTENT = 4000;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS knowledge_meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS knowledge_items(
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('global','workspace')),
  workspace TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','rejected')),
  confidence REAL NOT NULL DEFAULT 1,
  work_id TEXT NOT NULL DEFAULT '',
  repository_fingerprint TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  id UNINDEXED,
  content,
  kind,
  tokenize='unicode61'
);
CREATE TABLE IF NOT EXISTS validation_affinity(
  workspace TEXT NOT NULL,
  path_prefix TEXT NOT NULL,
  command TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(workspace, path_prefix, command)
) WITHOUT ROWID, STRICT;
CREATE INDEX IF NOT EXISTS knowledge_scope_idx ON knowledge_items(status, scope, workspace, updated_at DESC);
`;

function knowledgeSettings(config = {}) {
  const raw = config.knowledge && typeof config.knowledge === 'object' ? config.knowledge : {};
  return {
    enabled: raw.enabled !== false,
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
  setMeta(db, 'schema_version', KNOWLEDGE_SCHEMA_VERSION);
}

function removeLegacyProcedureLearning(db) {
  db.exec(`
    DROP TABLE IF EXISTS procedure_fts;
    DROP TABLE IF EXISTS procedure_runs;
    DROP TABLE IF EXISTS procedures;
  `);
}

function addKnowledgeItem(config, input = {}) {
  const settings = knowledgeSettings(config);
  if (!settings.enabled) throw new Error('Long-term knowledge is disabled.');
  const scope = input.scope === 'workspace' ? 'workspace' : 'global';
  const workspace = scope === 'workspace' ? clean(input.workspace, 120) : '';
  if (scope === 'workspace' && !workspace) throw new Error('Workspace-scoped knowledge requires a workspace.');
  const kind = clean(input.kind || 'note', 80) || 'note';
  const content = clean(input.content, MAX_ITEM_CONTENT);
  if (!content) throw new Error('Knowledge content is required.');
  const now = new Date().toISOString();
  const id = clean(input.id, 120) || `mem_${crypto.randomUUID()}`;
  const db = openKnowledgeDatabase(config);
  try {
    return withKnowledgeTransaction(db, () => {
      db.prepare(`INSERT INTO knowledge_items(id, scope, workspace, kind, content, source, status, confidence, work_id, repository_fingerprint, evidence_json, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET scope=excluded.scope, workspace=excluded.workspace, kind=excluded.kind, content=excluded.content,
          source=excluded.source, status=excluded.status, confidence=excluded.confidence, work_id=excluded.work_id,
          repository_fingerprint=excluded.repository_fingerprint, evidence_json=excluded.evidence_json, updated_at=excluded.updated_at`)
        .run(id, scope, workspace, kind, content, clean(input.source || 'user', 80) || 'user', 'active', boundedConfidence(input.confidence),
          clean(input.workId, 200), clean(input.repositoryFingerprint, 200), jsonArray(input.evidence), now, now);
      syncKnowledgeFts(db, id, content, kind);
      return knowledgeItem(db.prepare('SELECT * FROM knowledge_items WHERE id=?').get(id));
    });
  } finally { db.close(); }
}

function manageMemory(config, workspace, input = {}, context = {}) {
  const action = clean(input.action, 24).toLowerCase();
  const workspaceAlias = clean(workspace?.alias || workspace, 120);
  const taskId = clean(context.taskId || input.work_id, 200);
  if (!['save', 'update', 'delete'].includes(action)) throw new Error(`Unsupported memory action '${action}'.`);
  if (action !== 'delete' && !taskId) throw new Error('Saving or updating long-term memory requires the active work_id.');

  if (action === 'save') {
    const scope = input.scope === 'global' ? 'global' : 'workspace';
    const item = addKnowledgeItem(config, {
      content: input.content,
      scope,
      workspace: scope === 'workspace' ? workspaceAlias : '',
      kind: memoryKind(input.kind),
      source: 'agent',
      confidence: memoryConfidence(input.confidence),
      workId: taskId
    });
    return memoryActionResult(item, { action, created: true, workId: taskId });
  }

  const existing = getKnowledgeItem(config, input.id);
  if (!existing) throw new Error(`Unknown saved memory: ${clean(input.id, 160) || '(missing id)'}.`);
  assertMemoryVisible(existing, workspaceAlias);
  if (action === 'delete') {
    const deleted = deleteKnowledgeItem(config, existing.id);
    return { ok: true, workspace: workspaceAlias, action, id: existing.id, deleted: deleted.deleted };
  }

  const item = addKnowledgeItem(config, {
    id: existing.id,
    content: input.content,
    scope: existing.scope,
    workspace: existing.workspace,
    kind: input.kind ? memoryKind(input.kind) : existing.kind,
    source: 'agent',
    confidence: input.confidence == null ? existing.confidence : memoryConfidence(input.confidence),
    workId: taskId,
    repositoryFingerprint: existing.repositoryFingerprint,
    evidence: existing.evidence
  });
  return memoryActionResult(item, { action, updated: true, workId: taskId });
}

function getKnowledgeItem(config, id) {
  const key = clean(id, 160);
  if (!key) throw new Error('Knowledge id is required.');
  const db = openKnowledgeDatabase(config, { readonly: true });
  if (!db) return null;
  try { return knowledgeItem(db.prepare("SELECT * FROM knowledge_items WHERE id=? AND status='active'").get(key)); }
  finally { db.close(); }
}

function assertMemoryVisible(item, workspaceAlias) {
  if (item.scope === 'workspace' && item.workspace !== workspaceAlias) {
    throw new Error(`Saved memory '${item.id}' belongs to another project scope.`);
  }
}

function memoryKind(value) {
  const kind = clean(value || 'fact', 80).toLowerCase();
  if (!['fact', 'preference', 'note'].includes(kind)) throw new Error(`Unsupported memory kind '${kind}'.`);
  return kind;
}

function memoryConfidence(value) {
  if (value == null || value === '') return 1;
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0.8 || confidence > 1) throw new Error('Agent-saved memory confidence must be between 0.8 and 1.');
  return confidence;
}

function memoryActionResult(item, flags = {}) {
  return {
    ok: true,
    workspace: item.workspace,
    work_id: flags.workId || '',
    action: flags.action,
    id: item.id,
    content: item.content,
    kind: item.kind,
    scope: item.scope,
    confidence: item.confidence,
    created: flags.created === true,
    updated: flags.updated === true
  };
}

function deleteKnowledgeItem(config, id) {
  const key = clean(id, 160);
  if (!key) throw new Error('Knowledge id is required.');
  const db = openKnowledgeDatabase(config);
  try {
    return withKnowledgeTransaction(db, () => {
      db.prepare('DELETE FROM knowledge_fts WHERE id=?').run(key);
      const result = db.prepare('DELETE FROM knowledge_items WHERE id=?').run(key);
      return { ok: true, deleted: Number(result.changes || 0) > 0, id: key };
    });
  } finally { db.close(); }
}

function clearKnowledge(config) {
  const db = openKnowledgeDatabase(config);
  try {
    return withKnowledgeTransaction(db, () => {
      db.exec('DELETE FROM knowledge_fts; DELETE FROM knowledge_items; DELETE FROM validation_affinity;');
      return { ok: true, cleared: true };
    });
  } finally { db.close(); }
}

function listKnowledge(config, options = {}) {
  const db = openKnowledgeDatabase(config, { readonly: true });
  if (!db) return [];
  try {
    const limit = clamp(options.limit, 1, 200, 50);
    const workspace = clean(options.workspace, 120);
    const rows = workspace
      ? db.prepare(`SELECT * FROM knowledge_items WHERE status='active' AND (scope='global' OR workspace=?) ORDER BY updated_at DESC LIMIT ?`).all(workspace, limit)
      : db.prepare(`SELECT * FROM knowledge_items WHERE status='active' ORDER BY updated_at DESC LIMIT ?`).all(limit);
    return rows.map(knowledgeItem);
  } finally { db.close(); }
}

function searchKnowledge(config, query, options = {}) {
  const settings = knowledgeSettings(config);
  if (!settings.enabled) return [];
  const terms = relevanceTerms(query).slice(0, 12);
  if (!terms.length) return [];
  const db = openKnowledgeDatabase(config, { readonly: true });
  if (!db) return [];
  try {
    const workspace = clean(options.workspace, 120);
    const limit = clamp(options.limit, 1, 6, 3);
    const fts = terms.map(ftsToken).filter(Boolean).join(' OR ');
    if (!fts) return [];
    const rows = db.prepare(`SELECT k.*, bm25(knowledge_fts) AS rank
      FROM knowledge_fts JOIN knowledge_items k ON k.id=knowledge_fts.id
      WHERE knowledge_fts MATCH ? AND k.status='active' AND (k.scope='global' OR k.workspace=?)
      ORDER BY CASE WHEN k.scope='workspace' THEN 0 ELSE 1 END, k.confidence DESC, rank ASC, k.updated_at DESC LIMIT ?`).all(fts, workspace, Math.max(limit * 3, limit));
    return boundSerialized(rows.map(compactKnowledgeForBootstrap), clamp(options.maxBytes, 512, 8192, Math.floor(settings.maxBootstrapBytes / 2)), limit);
  } finally { db.close(); }
}

function recordTaskValidationAffinity(config, workspace, session = {}, completion = {}) {
  const settings = knowledgeSettings(config);
  if (!settings.enabled || completion.duplicate === true || String(completion.validationStatus || '') !== 'passed') return null;
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

function knowledgeSummary(config) {
  const settings = knowledgeSettings(config);
  const db = openKnowledgeDatabase(config, { readonly: true });
  if (!db) return { settings, knowledgeCount: 0 };
  try {
    return {
      settings,
      knowledgeCount: Number(db.prepare("SELECT count(*) AS count FROM knowledge_items WHERE status='active'").get().count || 0)
    };
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

function syncKnowledgeFts(db, id, content, kind) {
  db.prepare('DELETE FROM knowledge_fts WHERE id=?').run(id);
  db.prepare('INSERT INTO knowledge_fts(id, content, kind) VALUES(?,?,?)').run(id, content, kind);
}

function withKnowledgeTransaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function knowledgeItem(row) {
  if (!row) return null;
  return {
    id: String(row.id), scope: String(row.scope), workspace: String(row.workspace || ''), kind: String(row.kind), content: String(row.content),
    source: String(row.source), status: String(row.status), confidence: Number(row.confidence || 0), workId: String(row.work_id || ''),
    repositoryFingerprint: String(row.repository_fingerprint || ''), evidence: parseArray(row.evidence_json), createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function compactKnowledgeForBootstrap(item) {
  return {
    id: item.id,
    kind: item.kind,
    content: clean(item.content, 1000),
    scope: item.scope,
    ...(item.workspace ? { workspace: item.workspace } : {}),
    confidence: item.confidence
  };
}

function boundSerialized(values, maxBytes, limit) {
  const result = [];
  let bytes = 2;
  for (const value of values) {
    if (result.length >= limit) break;
    const itemBytes = Buffer.byteLength(JSON.stringify(value), 'utf8') + 1;
    if (result.length && bytes + itemBytes > maxBytes) break;
    if (!result.length && itemBytes > maxBytes) continue;
    result.push(value);
    bytes += itemBytes;
  }
  return result;
}

function ftsToken(value) {
  const token = String(value || '').replace(/[^\p{L}\p{N}_-]+/gu, '').trim();
  return token ? `"${token.replaceAll('"', '""')}"` : '';
}

function clean(value, limit) {
  const text = String(value || '').replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : text;
}

function boundedConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 1;
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function jsonArray(value) { return JSON.stringify(Array.isArray(value) ? value : []); }
function clamp(value, min, max, fallback) {
  const number = Number(value);
  const resolved = Number.isFinite(number) ? number : Number(fallback);
  return Math.min(max, Math.max(min, Math.floor(Number.isFinite(resolved) ? resolved : min)));
}
function setMeta(db, key, value) { db.prepare('INSERT INTO knowledge_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(String(key), String(value)); }
function metaValue(db, key, fallback = '') { try { return db.prepare('SELECT value FROM knowledge_meta WHERE key=?').get(String(key))?.value ?? fallback; } catch { return fallback; } }

export {
  addKnowledgeItem,
  clearKnowledge,
  deleteKnowledgeItem,
  knowledgeDatabasePath,
  knowledgeSettings,
  knowledgeSummary,
  learnedValidationChecks,
  listKnowledge,
  manageMemory,
  recordTaskValidationAffinity,
  searchKnowledge
};
