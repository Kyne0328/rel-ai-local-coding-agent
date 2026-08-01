import { clearTaskHistory, recordTaskHistoryEvent } from './taskHistoryStore.js';
import { recordTaskIntegrityEvent } from './taskIntegrity.js';
import * as fs from "node:fs";
import * as path from 'node:path';
import { getStateDir } from './statePaths.js';

function getAuditPath(config = {}) {
  return config.auditLogPath || path.join(getStateDir(config), "audit.jsonl");
}

const MAX_AUDIT_BYTES = 5 * 1024 * 1024;   // rotate past 5 MB
const READ_TAIL_BYTES = 256 * 1024;        // only the recent tail is ever needed

// Keep one rotated generation (audit.jsonl.1) so the live file never grows without
// bound. Called before each append.
function rotateIfNeeded(auditPath) {
  try {
    const stat = fs.statSync(auditPath);
    if (stat.size > MAX_AUDIT_BYTES) {
      fs.renameSync(auditPath, `${auditPath}.1`);
    }
  } catch { /* missing file or rename race — nothing to rotate */ }
}

function logAudit(config, event) {
  const auditPath = getAuditPath(config);
  const entry = {
    ts: new Date().toISOString(),
    pid: process.pid,
    ...redactEvent(event || {})
  };
  const integrity = recordTaskIntegrityEvent(config, entry);
  if (integrity) Object.assign(entry, integrity);
  fs.mkdirSync(path.dirname(auditPath), { recursive: true, mode: 0o700 });
  rotateIfNeeded(auditPath);
  fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  try {
    recordTaskHistoryEvent(config, entry);
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] session history write:', error);
  }
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

// Read only the last READ_TAIL_BYTES instead of the whole file — the dashboard polls
// this every few seconds and only ever wants the most recent entries.
function readAuditTail(auditPath) {
  const stat = fs.statSync(auditPath);
  const start = Math.max(0, stat.size - READ_TAIL_BYTES);
  const fd = fs.openSync(auditPath, "r");
  try {
    const length = stat.size - start;
    const buf = Buffer.allocUnsafe(length);
    fs.readSync(fd, buf, 0, length, start);
    let text = buf.toString("utf8");
    // Drop a leading partial line when we started mid-file.
    if (start > 0) text = text.slice(text.indexOf("\n") + 1);
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
  if (!fs.existsSync(auditPath)) return { path: auditPath, entries: [] };
  const text = fullScan ? readAuditGenerations(auditPath) : readAuditTail(auditPath);
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const entries = lines.map((line) => {
    try { return JSON.parse(line); } catch { return { malformed: true, message: 'Unreadable audit entry omitted.' }; }
  }).filter(entry => (!taskId || entry.taskId === taskId) && (!workspace || entry.workspace === workspace)).slice(-limit);
  return { path: auditPath, entries };
}

function readAuditGenerations(auditPath) {
  const files = [`${auditPath}.1`, auditPath].filter(file => fs.existsSync(file));
  return files.map(file => fs.readFileSync(file, 'utf8')).join('');
}

function clearAuditHistory(config) {
  const auditPath = getAuditPath(config);
  const files = [`${auditPath}.1`, auditPath];
  let removedFiles = 0;
  let removedBytes = 0;
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      removedBytes += stat.size;
      fs.rmSync(file, { force: true });
      removedFiles += 1;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  fs.mkdirSync(path.dirname(auditPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(auditPath, '', { mode: 0o600 });
  try { clearTaskHistory(config); } catch {}
  return { auditPath, removedFiles, removedBytes };
}

function redactEvent(value) {
  if (Array.isArray(value)) return value.map(redactEvent);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|authorization|api[_-]?key/i.test(key)) {
      out[key] = "[redacted]";
    } else if (typeof item === "string" && item.length > 12000) {
      out[key] = `${item.slice(0, 12000)}\n[rel-ai-mcp audit truncated ${item.length - 12000} chars]`;
    } else {
      out[key] = redactEvent(item);
    }
  }
  return out;
}

export { getAuditPath, logAudit, safeLogAudit, readAudit, clearAuditHistory };
