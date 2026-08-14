import { clearTaskHistory } from './taskHistoryStore.js';
import { recordTaskIntegrityEvent } from './taskIntegrity.js';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getStateDir } from './statePaths.js';

function getAuditPath(config = {}) {
  return config.auditLogPath || path.join(getStateDir(config), 'audit.jsonl');
}

const MAX_AUDIT_BYTES = 5 * 1024 * 1024;
const READ_TAIL_BYTES = 256 * 1024;
const AUDIT_FLUSH_DELAY_MS = 50;
const auditWriteStates = new Map();

function logAudit(config, event) {
  const auditPath = getAuditPath(config);
  const redacted = redactEvent(event || {});
  const entry = {
    ts: new Date().toISOString(),
    pid: process.pid,
    ...redacted,
    auditId: redacted.auditId || crypto.randomUUID()
  };
  const integrity = recordTaskIntegrityEvent(config, entry);
  if (integrity) Object.assign(entry, integrity);
  enqueueAuditWrite(auditPath, entry);
  return entry;
}

function safeLogAudit(config, event, options = {}) {
  try {
    return logAudit(config, event);
  } catch (error) {
    if (options.strictIntegrity === true && /^TASK_INTEGRITY_/.test(String(error?.code || ''))) throw error;
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] audit write:', error);
    return null;
  }
}

function enqueueAuditWrite(auditPath, entry) {
  let state = auditWriteStates.get(auditPath);
  if (!state) {
    state = { pending: [], inFlight: [], timer: null, promise: Promise.resolve(), clearing: false };
    auditWriteStates.set(auditPath, state);
  }
  if (state.clearing) return;
  state.pending.push(entry);
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushAuditState(auditPath, state);
  }, AUDIT_FLUSH_DELAY_MS);
  state.timer.unref?.();
}

function flushAuditState(auditPath, state) {
  if (!state || state.clearing || state.pending.length === 0) return state?.promise || Promise.resolve();
  const batch = state.pending.splice(0);
  state.inFlight.push(...batch);
  state.promise = state.promise
    .then(async () => {
      await fs.promises.mkdir(path.dirname(auditPath), { recursive: true, mode: 0o700 });
      await rotateIfNeededAsync(auditPath);
      await fs.promises.appendFile(auditPath, batch.map(entry => `${JSON.stringify(entry)}\n`).join(''), { mode: 0o600 });
      removeInFlight(state, batch);
    })
    .catch(error => {
      removeInFlight(state, batch);
      state.pending.unshift(...batch);
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] deferred audit write:', error);
      if (!state.clearing && !state.timer) {
        state.timer = setTimeout(() => {
          state.timer = null;
          void flushAuditState(auditPath, state);
        }, 500);
        state.timer.unref?.();
      }
    });
  return state.promise;
}

function removeInFlight(state, batch) {
  const ids = new Set(batch.map(entry => entry.auditId));
  state.inFlight = state.inFlight.filter(entry => !ids.has(entry.auditId));
}

async function rotateIfNeededAsync(auditPath) {
  try {
    const stat = await fs.promises.stat(auditPath);
    if (stat.size <= MAX_AUDIT_BYTES) return;
    await fs.promises.rm(`${auditPath}.1`, { force: true });
    await fs.promises.rename(auditPath, `${auditPath}.1`);
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error?.code) && process.env.REL_AI_MCP_DEBUG) {
      console.error('[rel-ai-mcp] audit rotation:', error);
    }
  }
}

async function flushAuditWrites(auditPath = '') {
  const targets = auditPath
    ? [[auditPath, auditWriteStates.get(auditPath)]]
    : [...auditWriteStates.entries()];
  for (const [target, state] of targets) {
    if (!state) continue;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    await flushAuditState(target, state);
    await state.promise;
  }
}

function readAuditTail(auditPath) {
  const stat = fs.statSync(auditPath);
  const start = Math.max(0, stat.size - READ_TAIL_BYTES);
  const fd = fs.openSync(auditPath, 'r');
  try {
    const length = stat.size - start;
    const buf = Buffer.allocUnsafe(length);
    fs.readSync(fd, buf, 0, length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function readAudit(config, options = {}) {
  const auditPath = getAuditPath(config);
  const taskId = String(options.taskId || '').trim();
  const workspace = String(options.workspace || '').trim();
  const fullScan = Boolean(options.fullScan || taskId || workspace);
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), fullScan ? 10000 : 1000);
  let persistedEntries = [];
  if (fs.existsSync(auditPath)) {
    const text = fullScan ? readAuditGenerations(auditPath) : readAuditTail(auditPath);
    persistedEntries = text.trim().split(/\r?\n/).filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return { malformed: true, message: 'Unreadable audit entry omitted.' }; }
    });
  }
  const state = auditWriteStates.get(auditPath);
  const queuedEntries = state ? [...state.inFlight, ...state.pending] : [];
  const entries = dedupeAuditEntries([...persistedEntries, ...queuedEntries])
    .filter(entry => (!taskId || entry.taskId === taskId) && (!workspace || entry.workspace === workspace))
    .slice(-limit);
  return { path: auditPath, entries };
}

function dedupeAuditEntries(entries) {
  const seen = new Set();
  return entries.filter(entry => {
    const id = String(entry?.auditId || '');
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function readAuditGenerations(auditPath) {
  const files = [`${auditPath}.1`, auditPath].filter(file => fs.existsSync(file));
  return files.map(file => fs.readFileSync(file, 'utf8')).join('');
}

async function clearAuditHistory(config) {
  const auditPath = getAuditPath(config);
  const state = auditWriteStates.get(auditPath);
  if (state) {
    state.clearing = true;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.pending = [];
    await state.promise.catch(() => {});
    auditWriteStates.delete(auditPath);
  }
  const files = [`${auditPath}.1`, auditPath];
  let removedFiles = 0;
  let removedBytes = 0;
  for (const file of files) {
    try {
      const stat = await fs.promises.stat(file);
      removedBytes += stat.size;
      await fs.promises.rm(file, { force: true });
      removedFiles += 1;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  await fs.promises.mkdir(path.dirname(auditPath), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(auditPath, '', { mode: 0o600 });
  try { clearTaskHistory(config); } catch {}
  return { auditPath, removedFiles, removedBytes };
}

function redactEvent(value) {
  if (Array.isArray(value)) return value.map(redactEvent);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|authorization|api[_-]?key/i.test(key)) {
      out[key] = '[redacted]';
    } else if (typeof item === 'string' && item.length > 12000) {
      out[key] = `${item.slice(0, 12000)}\n[rel-ai-mcp audit truncated ${item.length - 12000} chars]`;
    } else {
      out[key] = redactEvent(item);
    }
  }
  return out;
}

export { getAuditPath, safeLogAudit, readAudit, clearAuditHistory, flushAuditWrites };
