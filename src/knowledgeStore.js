import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { statePath } from './stateLayout.js';
import { relevanceTerms } from './context/relevance.js';
import { skillMarkdown, validateSkillIdentity } from './skillValidation.js';

const KNOWLEDGE_SCHEMA_VERSION = 1;
const DEFAULT_BOOTSTRAP_BYTES = 4096;
const MAX_ITEM_CONTENT = 4000;
const MAX_PROCEDURE_STEPS = 12;

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
CREATE TABLE IF NOT EXISTS procedures(
  id TEXT PRIMARY KEY,
  signature TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  trigger_text TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','verified','rejected','superseded')),
  success_count INTEGER NOT NULL DEFAULT 1,
  workspace_count INTEGER NOT NULL DEFAULT 1,
  last_workspace TEXT NOT NULL DEFAULT '',
  last_work_id TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE VIRTUAL TABLE IF NOT EXISTS procedure_fts USING fts5(
  id UNINDEXED,
  name,
  description,
  trigger_text,
  tokenize='unicode61'
);
CREATE TABLE IF NOT EXISTS procedure_runs(
  procedure_id TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL,
  workspace TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY(procedure_id, work_id)
) WITHOUT ROWID, STRICT;
CREATE INDEX IF NOT EXISTS knowledge_scope_idx ON knowledge_items(status, scope, workspace, updated_at DESC);
CREATE INDEX IF NOT EXISTS procedure_status_idx ON procedures(status, success_count DESC, updated_at DESC);
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
  setMeta(db, 'schema_version', KNOWLEDGE_SCHEMA_VERSION);
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
    db.prepare(`INSERT INTO knowledge_items(id, scope, workspace, kind, content, source, status, confidence, work_id, repository_fingerprint, evidence_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET scope=excluded.scope, workspace=excluded.workspace, kind=excluded.kind, content=excluded.content,
        source=excluded.source, status=excluded.status, confidence=excluded.confidence, work_id=excluded.work_id,
        repository_fingerprint=excluded.repository_fingerprint, evidence_json=excluded.evidence_json, updated_at=excluded.updated_at`)
      .run(id, scope, workspace, kind, content, clean(input.source || 'user', 80) || 'user', 'active', boundedConfidence(input.confidence),
        clean(input.workId, 200), clean(input.repositoryFingerprint, 200), jsonArray(input.evidence), now, now);
    syncKnowledgeFts(db, id, content, kind);
    return knowledgeItem(db.prepare('SELECT * FROM knowledge_items WHERE id=?').get(id));
  } finally { db.close(); }
}

function deleteKnowledgeItem(config, id) {
  const key = clean(id, 160);
  if (!key) throw new Error('Knowledge id is required.');
  const db = openKnowledgeDatabase(config);
  try {
    db.prepare('DELETE FROM knowledge_fts WHERE id=?').run(key);
    const result = db.prepare('DELETE FROM knowledge_items WHERE id=?').run(key);
    return { ok: true, deleted: Number(result.changes || 0) > 0, id: key };
  } finally { db.close(); }
}

function clearKnowledge(config) {
  const db = openKnowledgeDatabase(config);
  try {
    db.exec('DELETE FROM knowledge_fts; DELETE FROM knowledge_items; DELETE FROM procedure_fts; DELETE FROM procedure_runs; DELETE FROM procedures;');
    return { ok: true, cleared: true };
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
      ORDER BY rank ASC, k.updated_at DESC LIMIT ?`).all(fts, workspace, Math.max(limit * 3, limit));
    return boundSerialized(rows.map(compactKnowledgeForBootstrap), clamp(options.maxBytes, 512, 8192, Math.floor(settings.maxBootstrapBytes / 2)), limit);
  } finally { db.close(); }
}

function listProcedures(config, options = {}) {
  const db = openKnowledgeDatabase(config, { readonly: true });
  if (!db) return [];
  try {
    const limit = clamp(options.limit, 1, 100, 30);
    const status = ['candidate', 'verified', 'rejected', 'superseded'].includes(options.status) ? options.status : '';
    const rows = status
      ? db.prepare('SELECT * FROM procedures WHERE status=? ORDER BY success_count DESC, updated_at DESC LIMIT ?').all(status, limit)
      : db.prepare('SELECT * FROM procedures ORDER BY CASE status WHEN \'verified\' THEN 0 WHEN \'candidate\' THEN 1 ELSE 2 END, success_count DESC, updated_at DESC LIMIT ?').all(limit);
    return rows.map(procedureRecord);
  } finally { db.close(); }
}

function searchVerifiedProcedures(config, query, options = {}) {
  const settings = knowledgeSettings(config);
  if (!settings.enabled || !settings.proceduralLearning) return [];
  const terms = relevanceTerms(query).slice(0, 12);
  if (!terms.length) return [];
  const db = openKnowledgeDatabase(config, { readonly: true });
  if (!db) return [];
  try {
    const limit = clamp(options.limit, 1, 5, 3);
    const fts = terms.map(ftsToken).filter(Boolean).join(' OR ');
    if (!fts) return [];
    const rows = db.prepare(`SELECT p.*, bm25(procedure_fts) AS rank
      FROM procedure_fts JOIN procedures p ON p.id=procedure_fts.id
      WHERE procedure_fts MATCH ? AND p.status='verified'
      ORDER BY rank ASC, p.success_count DESC, p.updated_at DESC LIMIT ?`).all(fts, Math.max(limit * 3, limit));
    return boundSerialized(rows.map(compactProcedureForBootstrap), clamp(options.maxBytes, 700, 8192, Math.floor(settings.maxBootstrapBytes / 2)), limit);
  } finally { db.close(); }
}

function learnFromCompletedTask(config, workspace, session = {}, completion = {}) {
  const settings = knowledgeSettings(config);
  if (!settings.enabled || !settings.proceduralLearning || completion.duplicate === true) return null;
  const validationStatus = clean(completion.validationStatus || session.validation, 40);
  if (!['passed', 'not_required'].includes(validationStatus)) return null;
  const taskId = clean(completion.work_id || session.id || session.taskId, 200);
  if (!taskId) return null;
  const evidence = Array.isArray(session.workflowEvidence) ? session.workflowEvidence : [];
  const events = Array.isArray(session.events) ? session.events : [];
  const operationSequence = procedureOperations(events);
  if (operationSequence.length < 2) return null;
  const failures = [...new Set(evidence.map(item => clean(item?.failureSignature, 128)).filter(Boolean))].slice(0, 4);
  const checks = [...new Set(evidence.map(item => clean(item?.commandId || item?.command, 180)).filter(Boolean))].slice(-4);
  const changedFiles = [...new Set((completion.changedFiles || session.changedFiles || []).map(value => clean(value, 240)).filter(Boolean))].slice(0, 20);
  if (!changedFiles.length && !checks.length && !failures.length) return null;
  const signatureInput = {
    intent: clean(session.intent || session.workflow?.intent, 40),
    taskTerms: procedureTaskTerms(session),
    operations: operationSequence,
    failures,
    extensions: [...new Set(changedFiles.map(file => path.extname(file).toLowerCase()).filter(Boolean))].sort(),
    checks: checks.map(normalizeSignatureText)
  };
  const signature = crypto.createHash('sha256').update(JSON.stringify(signatureInput)).digest('hex');
  const triggerText = compactTrigger(session, failures, changedFiles);
  const name = procedureName(session, signature);
  const description = procedureDescription(session, operationSequence);
  const steps = operationSequence.map(operationStep).slice(0, MAX_PROCEDURE_STEPS);
  const now = new Date().toISOString();
  const db = openKnowledgeDatabase(config);
  try {
    const existing = db.prepare('SELECT * FROM procedures WHERE signature=?').get(signature);
    let id = existing?.id ? String(existing.id) : `proc_${crypto.randomUUID()}`;
    if (!existing) {
      db.prepare(`INSERT INTO procedures(id, signature, name, description, trigger_text, steps_json, status, success_count, workspace_count, last_workspace, last_work_id, evidence_json, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, signature, name, description, triggerText, JSON.stringify(steps), 'candidate', 1, 1, clean(workspace?.alias || workspace, 120), taskId,
          JSON.stringify(compactProcedureEvidence(session, completion, failures, checks)), now, now);
    } else {
      const independentRun = !db.prepare('SELECT 1 FROM procedure_runs WHERE procedure_id=? AND work_id=?').get(id, taskId);
      if (independentRun) {
        const workspaceAlias = clean(workspace?.alias || workspace, 120);
        const priorWorkspaces = new Set(db.prepare('SELECT workspace FROM procedure_runs WHERE procedure_id=?').all(id).map(row => String(row.workspace || '')));
        const workspaceCount = priorWorkspaces.has(workspaceAlias) ? Number(existing.workspace_count || 1) : Number(existing.workspace_count || 1) + 1;
        const successCount = Number(existing.success_count || 1) + 1;
        const nextStatus = existing.status === 'rejected' || existing.status === 'superseded' ? String(existing.status) : (successCount >= 2 ? 'verified' : String(existing.status || 'candidate'));
        db.prepare(`UPDATE procedures SET name=?, description=?, trigger_text=?, steps_json=?, status=?, success_count=?, workspace_count=?, last_workspace=?, last_work_id=?, evidence_json=?, updated_at=? WHERE id=?`)
          .run(name, description, triggerText, JSON.stringify(steps), nextStatus, successCount, workspaceCount, workspaceAlias, taskId,
            JSON.stringify(mergeEvidence(existing.evidence_json, compactProcedureEvidence(session, completion, failures, checks))), now, id);
      }
    }
    db.prepare('INSERT OR IGNORE INTO procedure_runs(procedure_id, work_id, workspace, validation_status, completed_at) VALUES(?,?,?,?,?)')
      .run(id, taskId, clean(workspace?.alias || workspace, 120), validationStatus, now);
    const row = db.prepare('SELECT * FROM procedures WHERE id=?').get(id);
    syncProcedureFts(db, row);
    return procedureRecord(row);
  } finally { db.close(); }
}

function setProcedureStatus(config, id, status) {
  if (!['candidate', 'verified', 'rejected', 'superseded'].includes(status)) throw new Error('Invalid procedure status.');
  const db = openKnowledgeDatabase(config);
  try {
    const result = db.prepare('UPDATE procedures SET status=?, updated_at=? WHERE id=?').run(status, new Date().toISOString(), clean(id, 160));
    if (!Number(result.changes || 0)) throw new Error('Unknown procedure.');
    return procedureRecord(db.prepare('SELECT * FROM procedures WHERE id=?').get(clean(id, 160)));
  } finally { db.close(); }
}

function promoteProcedureToSkill(config, id, options = {}) {
  const db = openKnowledgeDatabase(config, { readonly: true });
  if (!db) throw new Error('No learned procedures are available.');
  let procedure;
  try { procedure = procedureRecord(db.prepare('SELECT * FROM procedures WHERE id=?').get(clean(id, 160))); }
  finally { db.close(); }
  if (!procedure) throw new Error('Unknown procedure.');
  if (procedure.status !== 'verified') throw new Error('Only verified procedures can be promoted to a skill.');
  const proposedName = options.name
    ? skillName(options.name)
    : learnedSkillName(procedure);
  const description = fitSkillDescription(options.description || procedure.description || `Use this learned procedure for tasks matching: ${procedure.trigger}.`);
  const identity = validateSkillIdentity({ name: proposedName, description });
  if (!identity.ok) throw new Error(identity.errors.join(' '));
  const root = path.resolve(options.userRoot || path.join(os.homedir(), '.agents', 'skills'));
  const directory = path.join(root, identity.name);
  const file = path.join(directory, 'SKILL.md');
  if (fs.existsSync(directory) && options.overwrite !== true) throw new Error(`Skill '${identity.name}' already exists.`);
  const numbered = procedure.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
  const body = `# ${titleCase(identity.name)}\n\nUse this procedure when the current task matches the trigger below. Re-check current repository evidence before applying it.\n\n## Trigger\n\n${procedure.trigger || procedure.description}\n\n## Procedure\n\n${numbered}\n\n## Verification rule\n\nTreat current repository state and current validation as authoritative. Do not reuse stale evidence from the task that taught this procedure.`;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, skillMarkdown({ name: identity.name, description: identity.description, body }), { mode: 0o600 });
  fs.writeFileSync(path.join(directory, 'PROVENANCE.md'), `# Rel.AI learned-skill provenance\n\n- Procedure ID: ${procedure.id}\n- Signature: ${procedure.signature}\n- Successful runs: ${procedure.successCount}\n- Promoted: ${new Date().toISOString()}\n- Last work ID: ${procedure.lastWorkId || 'unknown'}\n\nThis skill was promoted from locally verified Rel.AI procedural evidence.\n`, { mode: 0o600 });
  return { ok: true, name: identity.name, path: `user:${identity.name}`, procedureId: procedure.id };
}

function knowledgeSummary(config) {
  const settings = knowledgeSettings(config);
  const db = openKnowledgeDatabase(config, { readonly: true });
  if (!db) return { settings, knowledgeCount: 0, candidateCount: 0, verifiedProcedureCount: 0 };
  try {
    return {
      settings,
      knowledgeCount: Number(db.prepare("SELECT count(*) AS count FROM knowledge_items WHERE status='active'").get().count || 0),
      candidateCount: Number(db.prepare("SELECT count(*) AS count FROM procedures WHERE status='candidate'").get().count || 0),
      verifiedProcedureCount: Number(db.prepare("SELECT count(*) AS count FROM procedures WHERE status='verified'").get().count || 0)
    };
  } finally { db.close(); }
}

function syncKnowledgeFts(db, id, content, kind) {
  db.prepare('DELETE FROM knowledge_fts WHERE id=?').run(id);
  db.prepare('INSERT INTO knowledge_fts(id, content, kind) VALUES(?,?,?)').run(id, content, kind);
}

function syncProcedureFts(db, row) {
  if (!row) return;
  db.prepare('DELETE FROM procedure_fts WHERE id=?').run(row.id);
  db.prepare('INSERT INTO procedure_fts(id, name, description, trigger_text) VALUES(?,?,?,?)').run(row.id, row.name, row.description, row.trigger_text);
}

function knowledgeItem(row) {
  if (!row) return null;
  return {
    id: String(row.id), scope: String(row.scope), workspace: String(row.workspace || ''), kind: String(row.kind), content: String(row.content),
    source: String(row.source), status: String(row.status), confidence: Number(row.confidence || 0), workId: String(row.work_id || ''),
    repositoryFingerprint: String(row.repository_fingerprint || ''), evidence: parseArray(row.evidence_json), createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function procedureRecord(row) {
  if (!row) return null;
  return {
    id: String(row.id), signature: String(row.signature), name: String(row.name), description: String(row.description), trigger: String(row.trigger_text),
    steps: parseArray(row.steps_json).map(String).slice(0, MAX_PROCEDURE_STEPS), status: String(row.status), successCount: Number(row.success_count || 0),
    workspaceCount: Number(row.workspace_count || 0), lastWorkspace: String(row.last_workspace || ''), lastWorkId: String(row.last_work_id || ''),
    evidence: parseArray(row.evidence_json), createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function compactKnowledgeForBootstrap(row) {
  const item = knowledgeItem(row);
  if (!item) return null;
  return {
    scope: item.scope,
    kind: item.kind,
    content: item.content,
    source: item.source,
    confidence: item.confidence
  };
}

function compactProcedureForBootstrap(row) {
  const procedure = procedureRecord(row);
  if (!procedure) return null;
  return {
    name: procedure.name,
    description: procedure.description,
    trigger: procedure.trigger,
    steps: procedure.steps,
    status: procedure.status,
    successCount: procedure.successCount
  };
}

function procedureOperations(events) {
  const operations = [];
  for (const event of events) {
    const operation = clean(event?.metadata?.internalOperation || event?.operation || event?.tool, 80);
    if (!operation || operation === 'work.begin' || operation === 'work.status' || operation === 'work.finish') continue;
    if (operations.at(-1) !== operation) operations.push(operation);
  }
  return operations.slice(-MAX_PROCEDURE_STEPS);
}

function operationStep(operation) {
  const text = String(operation).replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)} using current repository evidence.` : 'Continue using current repository evidence.';
}

function compactTrigger(session, failures, changedFiles) {
  return clean([session.objective || session.title, failures.length ? `failure signatures ${failures.length}` : '', changedFiles.length ? `affected ${fileCategories(changedFiles).join(', ')}` : ''].filter(Boolean).join('; '), 700);
}

function procedureTaskTerms(session) {
  const terms = relevanceTerms(session.objective || session.title).slice(0, 12);
  if (terms.length) return [...new Set(terms)].sort();
  const fallback = normalizeSignatureText(session.objective || session.title);
  return fallback ? [fallback] : [];
}

function procedureName(session, signature) {
  const base = relevanceTerms(session.objective || session.title).slice(0, 5).join('-');
  return skillName(base || `learned-procedure-${signature.slice(0, 8)}`);
}

function procedureDescription(session, operations) {
  const goal = clean(session.objective || session.title || 'repository task', 260);
  return clean(`Verified Rel.AI procedure for ${goal}. Successful path: ${operations.map(item => item.replace(/[._]/g, ' ')).join(' -> ')}.`, 480);
}

function compactProcedureEvidence(session, completion, failures, checks) {
  return [{
    workId: clean(completion.work_id || session.id, 200), workspace: clean(session.workspace, 120), validation: clean(completion.validationStatus || session.validation, 40),
    completedAt: clean(session.completedAt || completion.validationAt || new Date().toISOString(), 80), failures, checks
  }];
}

function mergeEvidence(existingJson, next) {
  return [...parseArray(existingJson), ...next].slice(-20);
}

function fileCategories(files) {
  return [...new Set(files.map(file => path.extname(file).toLowerCase() || path.basename(file)).filter(Boolean))].slice(0, 5);
}

function fitSkillDescription(value) {
  let text = clean(value, 500);
  if (text.length < 40) text = `${text} Use current repository evidence and validation before applying this procedure.`;
  return text.slice(0, 500);
}

function skillName(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-').slice(0, 64).replace(/-+$/g, '');
  return normalized || 'relai-learned-procedure';
}

function learnedSkillName(procedure) {
  const suffix = String(procedure?.signature || '').slice(0, 8).toLowerCase();
  const base = skillName(procedure?.name || 'relai-learned-procedure');
  if (!suffix) return base;
  const prefix = base.slice(0, 64 - suffix.length - 1).replace(/-+$/g, '') || 'relai';
  return `${prefix}-${suffix}`;
}

function titleCase(value) {
  return String(value || '').split('-').filter(Boolean).map(part => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function normalizeSignatureText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
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
  learnFromCompletedTask,
  listKnowledge,
  listProcedures,
  promoteProcedureToSkill,
  searchKnowledge,
  searchVerifiedProcedures,
  setProcedureStatus
};
