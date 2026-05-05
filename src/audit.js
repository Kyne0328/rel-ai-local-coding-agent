const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function defaultStateDir() {
  return path.join(os.homedir(), ".rel-ai-mcp");
}

function getStateDir(config = {}) {
  return config.stateDir || process.env.REL_AI_MCP_STATE_DIR || defaultStateDir();
}

function getAuditPath(config = {}) {
  return config.auditLogPath || path.join(getStateDir(config), "audit.jsonl");
}

function logAudit(config, event) {
  const auditPath = getAuditPath(config);
  const entry = {
    ts: new Date().toISOString(),
    pid: process.pid,
    ...redactEvent(event || {})
  };
  fs.mkdirSync(path.dirname(auditPath), { recursive: true, mode: 0o700 });
  fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return entry;
}

function readAudit(config, options = {}) {
  const auditPath = getAuditPath(config);
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 1000);
  if (!fs.existsSync(auditPath)) return { path: auditPath, entries: [] };
  const lines = fs.readFileSync(auditPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  const entries = lines.slice(-limit).map((line) => {
    try { return JSON.parse(line); } catch (_error) { return { malformed: line }; }
  });
  return { path: auditPath, entries };
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

module.exports = {
  getStateDir,
  getAuditPath,
  logAudit,
  readAudit
};
